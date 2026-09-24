import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import prisma from './prisma.js';
import multer from 'multer';
import forge from 'node-forge';
import { statusFromDays, calcRisk, recommendationFor, expandTargets, scanMany, parseCertFile, dnsMatches, evaluateCrypto } from './utils.js';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'certrecord-dev-secret';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));

const STATUS_LABEL = { OK: 'В норме', INFO: 'Информация', WARNING: 'Предупреждение', CRITICAL: 'Критично', EXPIRED: 'Истёк', UNKNOWN: '—' };
const DEF_THRESHOLDS = [60, 30, 14, 7, 1];

// ---------- helpers ----------
const auth = async (req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Токен мог остаться от старой БД (файл) — такого пользователя в Postgres нет.
    // Раньше это роняло сервер с P2003 и давало пустой 500. Проверяем явно.
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) return res.status(401).json({ error: 'сессия устарела, войди заново' });
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    next();
  }
  catch {
    return res.status(401).json({ error: 'invalid token' });
  }
};

async function audit(action, user, details = '') {
  try { await prisma.auditLog.create({ data: { action, user: user || 'system', details: String(details).slice(0, 500) } }); } catch {}
}

async function getApp() {
  let s = await prisma.appSettings.findUnique({ where: { id: 'global' } });
  if (!s) {
    s = await prisma.appSettings.create({
      data: {
        id: 'global',
        statusThresholds: { info: 60, warning: 30, critical: 14 },
        riskWeights: { daysLeft: 0.4, criticality: 0.3, chain: 0.2, owner: 0.1 },
        scheduler: { defaultPort: 443, timeoutMs: 6000, concurrency: 20, fullScanHours: 24 }
      }
    });
  }
  return s;
}

async function getUserSetting(userId) {
  let s = await prisma.notificationSetting.findUnique({ where: { userId } });
  if (!s) s = await prisma.notificationSetting.create({ data: { userId } });
  return s;
}

function settingView(s) {
  return {
    thresholds: s.thresholds?.length ? s.thresholds : DEF_THRESHOLDS,
    channels: {
      emailEnabled: s.emailEnabled,
      telegramEnabled: s.telegramEnabled,
      email: s.email || '',
      telegramUsername: s.telegramUsername || '',
      telegramChatId: s.telegramChatId || '',
      telegramStatus: s.telegramStatus || 'idle'
    }
  };
}

function enrich(cert) {
  return {
    ...cert,
    statusLabel: STATUS_LABEL[cert.status] || cert.status,
    recommendations: recommendationFor(cert),
    problems: detectProblems(cert)
  };
}

// Выявляемые проблемы (ТЗ 3.6 + слабый крипто из 3.2/3.9)
function detectProblems(c) {
  const out = [];
  if (!c) return out;
  if (c.daysLeft != null && c.daysLeft < 0) {
    out.push({ code: 'EXPIRED', label: 'Истёкший сертификат', detail: `истёк ${Math.abs(c.daysLeft)} дн. назад` });
  } else if (c.daysLeft != null && c.daysLeft <= 30) {
    out.push({ code: 'EXPIRING_SOON', label: 'Скоро истекает', detail: `осталось ${c.daysLeft} дн.` });
  }
  if (c.selfSigned) out.push({ code: 'SELF_SIGNED', label: 'Self-signed', detail: 'нет доверенного издателя' });
  else if (c.chainValid === false) {
    out.push({ code: 'CHAIN_ERROR', label: 'Ошибка цепочки доверия', detail: c.chainError || 'цепочка не проверена' });
  }
  if (c.dnsMatch === false) {
    out.push({ code: 'DNS_MISMATCH', label: 'DNS не совпадает с CN/SAN', detail: `${c.host} нет в CN/SAN` });
  }
  if (c.weakCrypto) {
    out.push({ code: 'WEAK_CRYPTO', label: 'Слабые криптопараметры', detail: (c.weakCryptoReasons || []).slice(0, 2).join('; ') || 'см. детали' });
  }
  return out;
}

function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------- Email (общий сервис mail.ru, письма — людям) ----------
function mailer() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.mail.ru',
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendMail(to, subject, text) {
  const t = mailer();
  if (!t) throw new Error('SMTP не настроен на сервере');
  if (!to) throw new Error('не указан адрес получателя');
  await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text });
}

// ---------- Telegram (по нику, через getUpdates) ----------
async function tgApi(token, method, payload = {}) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  return r.json();
}

// Telegram не умеет писать по нику напрямую: человек сначала пишет боту,
// потом находим его chat_id в getUpdates по username.
async function resolveTelegramChat(token, username) {
  const u = String(username || '').replace(/^@/, '').toLowerCase().trim();
  if (!u) return { chatId: null, error: 'укажи ник' };
  if (!token) return { chatId: null, error: 'укажи токен бота' };
  try {
    const j = await tgApi(token, 'getUpdates', { limit: 100, timeout: 0 });
    if (!j.ok) {
      const d = String(j.description || '');
      if (d.includes('Unauthorized')) return { chatId: null, error: 'неверный токен бота' };
      return { chatId: null, error: 'Bot API не отвечает: ' + d };
    }
    for (let i = (j.result || []).length - 1; i >= 0; i--) {
      const up = j.result[i];
      const m = up.message || up.edited_message;
      const from = m?.from;
      if ((from?.username || '').toLowerCase() === u && m?.chat?.id) {
        return { chatId: String(m.chat.id), error: null };
      }
      if ((m?.chat?.username || '').toLowerCase() === u && m?.chat?.id) {
        return { chatId: String(m.chat.id), error: null };
      }
    }
    return { chatId: null, error: null }; // бот человека ещё не видел
  } catch (e) {
    return { chatId: null, error: 'сеть: ' + String(e.message || e) };
  }
}

async function tryLinkTelegram(userId) {
  const st = await getUserSetting(userId);
  if (!st.telegramUsername || !st.telegramBotToken) return st;
  const { chatId, error } = await resolveTelegramChat(st.telegramBotToken, st.telegramUsername);
  if (error) return { ...st, linkError: error };
  if (chatId) {
    return prisma.notificationSetting.update({
      where: { userId }, data: { telegramChatId: chatId, telegramStatus: 'linked' }
    });
  }
  if (st.telegramStatus !== 'pending' || !st.telegramChatId) {
    await prisma.notificationSetting.update({ where: { userId }, data: { telegramStatus: 'pending' } });
  }
  return { ...st, telegramStatus: 'pending' };
}

// ---------- Уведомления (у каждого пользователя — свои пороги и каналы) ----------
async function checkForUser(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return [];
  const st = await getUserSetting(userId);
  const th = st.thresholds?.length ? st.thresholds : DEF_THRESHOLDS;
  const certs = await prisma.certificate.findMany();
  const since = new Date(Date.now() - 86400000);
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const rows = [];
  for (const c of certs) {
    // Слабые криптопараметры — отдельное уведомление, не чаще раза в неделю
    if (c.weakCrypto) {
      const wkey = `${c.id}:weak`;
      const wseen = await prisma.notification.findFirst({ where: { userId, key: wkey, sentAt: { gte: weekAgo } } });
      if (!wseen) {
        rows.push({
          userId, key: wkey, type: 'WEAK_CRYPTO', channel: 'APP',
          subject: `${c.host} — слабые криптопараметры`,
          body: `Сертификат ${c.host}:${c.port} (${c.issuer || '—'}): ${(c.weakCryptoReasons || []).join('; ')}. Риск ${c.riskScore}/100.`,
          certId: c.id
        });
      }
    }
    if (c.daysLeft == null) continue;
    if (!(th.includes(c.daysLeft) || (c.daysLeft <= 14 && c.daysLeft >= 0) || c.daysLeft < 0)) continue;
    const key = `${c.id}:${c.daysLeft}`;
    const already = await prisma.notification.findFirst({ where: { userId, key, sentAt: { gte: since } } });
    if (already) continue;
    const type = c.daysLeft < 0 ? 'EXPIRED' : c.selfSigned ? 'SELF_SIGNED' : c.chainValid === false ? 'CHAIN_ERROR' : c.dnsMatch === false ? 'DNS_MISMATCH' : 'EXPIRING';
    rows.push({
      userId, key, type, channel: 'APP',
      subject: `${c.host} — осталось ${c.daysLeft} дн.`,
      body: `Сертификат ${c.host}:${c.port} (${c.issuer || '—'}) истекает ${c.validTo ? String(c.validTo).slice(0, 10) : '—'}. Статус: ${STATUS_LABEL[c.status] || c.status}. Риск ${c.riskScore}/100.`,
      certId: c.id
    });
  }
  if (!rows.length) return [];
  await prisma.notification.createMany({ data: rows });
  const text = rows.map((n) => `${n.subject}\n${n.body}`).join('\n\n');
  if (st.emailEnabled) {
    try { await sendMail(st.email || user.email, `CertRecord: уведомлений — ${rows.length}`, text); }
    catch (e) { console.error('[notify email]', e.message); }
  }
  if (st.telegramEnabled && st.telegramChatId && st.telegramBotToken) {
    try {
      for (const n of rows.slice(0, 5)) {
        await tgApi(st.telegramBotToken, 'sendMessage', { chat_id: st.telegramChatId, text: `🔐 CertRecord: ${n.subject}\n${n.body}` });
      }
    } catch (e) { console.error('[notify telegram]', e.message); }
  }
  return rows;
}

// ---------- Auth ----------
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email и пароль обязательны' });
  if (await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } })) {
    return res.status(409).json({ error: 'пользователь уже существует' });
  }
  const hash = await bcrypt.hash(String(password), 10);
  const count = await prisma.user.count();
  const user = await prisma.user.create({
    data: { email: String(email).toLowerCase(), password: hash, name: name || '', role: count ? 'USER' : 'ADMIN' }
  });
  await prisma.notificationSetting.create({ data: { userId: user.id } });
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  await audit('register', user.email);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = await prisma.user.findUnique({ where: { email: String(email || '').toLowerCase() } });
  if (!user || !(await bcrypt.compare(String(password || ''), user.password))) {
    return res.status(401).json({ error: 'неверный email или пароль' });
  }
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  await audit('login', user.email);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

app.get('/api/auth/me', auth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  const user = await prisma.user.findUnique({ where: { email: String(email || '').toLowerCase() } });
  if (!user) return res.json({ ok: true });
  const temp = Math.random().toString(36).slice(2, 10);
  await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(temp, 10) } });
  try {
    await sendMail(user.email, 'CertRecord — сброс пароля', `Временный пароль: ${temp}\nСмени его после входа.`);
  } catch (e) { console.error('[smtp]', e.message); }
  await audit('forgot-password', user.email);
  res.json({ ok: true });
});

// ---------- Certificates ----------
const SORT_MAP = { host: 'host', issuer: 'issuer', validTo: 'validTo', daysLeft: 'daysLeft', riskScore: 'riskScore', status: 'status' };

app.get('/api/certificates', auth, async (req, res) => {
  const { status, issuer, owner, search, daysLeft, problem, weak, sort, order, page = '1', perPage = '50' } = req.query;
  const where = {};
  if (status) where.status = String(status);
  if (issuer) where.issuer = { contains: String(issuer), mode: 'insensitive' };
  if (owner === '__none') where.owner = null;
  else if (owner) where.owner = { contains: String(owner), mode: 'insensitive' };
  if (daysLeft !== undefined && daysLeft !== '') where.daysLeft = { lte: Number(daysLeft) };
  if (weak === '1' || weak === 'true') where.weakCrypto = true;
  // Фильтр по выявляемым проблемам (ТЗ 3.6)
  if (problem) {
    if (problem === 'EXPIRED') where.status = 'EXPIRED';
    else if (problem === 'EXPIRING_SOON') where.daysLeft = { gte: 0, lte: 30 };
    else if (problem === 'SELF_SIGNED') where.selfSigned = true;
    else if (problem === 'CHAIN_ERROR') where.chainValid = false;
    else if (problem === 'DNS_MISMATCH') where.dnsMatch = false;
    else if (problem === 'WEAK_CRYPTO') where.weakCrypto = true;
  }
  if (search) {
    const q = String(search);
    where.OR = [
      { host: { contains: q, mode: 'insensitive' } },
      { cn: { contains: q, mode: 'insensitive' } },
      { issuer: { contains: q, mode: 'insensitive' } },
      { owner: { contains: q, mode: 'insensitive' } }
    ];
  }
  const key = SORT_MAP[String(sort)] || 'daysLeft';
  const dir = order === 'desc' ? 'desc' : 'asc';
  const p = Math.max(1, Number(page)), pp = Math.max(1, Math.min(200, Number(perPage)));
  const [total, list] = await Promise.all([
    prisma.certificate.count({ where }),
    prisma.certificate.findMany({
      where, orderBy: key === 'daysLeft' ? [{ daysLeft: { sort: dir, nulls: 'last' } }] : [{ [key]: dir }],
      skip: (p - 1) * pp, take: pp
    })
  ]);
  res.json({ total, page: p, perPage: pp, data: list.map(enrich) });
});

app.get('/api/certificates/stats', auth, async (req, res) => {
  const [total, groups, noOwner] = await Promise.all([
    prisma.certificate.count(),
    prisma.certificate.groupBy({ by: ['status'], _count: { status: true } }),
    prisma.certificate.count({ where: { owner: null } })
  ]);
  const counts = { TOTAL: total, OK: 0, INFO: 0, WARNING: 0, CRITICAL: 0, EXPIRED: 0, NOOWNER: noOwner };
  for (const g of groups) if (counts[g.status] != null) counts[g.status] = g._count.status;
  res.json(counts);
});

app.get('/api/certificates/attention', auth, async (req, res) => {
  const list = await prisma.certificate.findMany({
    where: { daysLeft: { not: null, lte: 30 } },
    orderBy: [{ daysLeft: { sort: 'asc', nulls: 'last' } }],
    take: 50
  });
  res.json(list.map(enrich));
});

// Ручной ввод одного сертификата (сюда же сохраняет страница «Создать»)
app.post('/api/certificates', auth, async (req, res) => {
  const { host, port, cn, san, issuer, thumbprint, validFrom, validTo, daysLeft: daysRaw, owner, critical, chainValid, chainError, dnsMatch, selfSigned, keyAlgo, keySize, tlsVersion, cipher, sigAlgo, weakCrypto, weakCryptoReasons, source } = req.body || {};
  if (!host || !String(host).trim()) return res.status(400).json({ error: 'поле host обязательно (DNS / IP)' });
  const appCfg = await getApp();
  const th = appCfg.statusThresholds;
  let daysLeft = daysRaw != null && daysRaw !== '' ? Number(daysRaw) : null;
  let vTo = toDate(validTo);
  if ((daysLeft == null || Number.isNaN(daysLeft)) && vTo) daysLeft = Math.floor((vTo - Date.now()) / 86400000);
  if (daysLeft != null && !vTo) vTo = new Date(Date.now() + Number(daysLeft) * 86400000);
  if (daysLeft == null || Number.isNaN(daysLeft)) daysLeft = 60;
  const status = statusFromDays(daysLeft, th);
  const weak = !!weakCrypto;
  const weakReasons = Array.isArray(weakCryptoReasons) ? weakCryptoReasons : [];
  const { score, reasons } = calcRisk({
    daysLeft, critical: !!critical,
    chainValid: chainValid !== undefined ? !!chainValid : true,
    selfSigned: !!selfSigned, dnsMatch: dnsMatch !== undefined ? !!dnsMatch : true,
    hasOwner: !!(owner && String(owner).trim()),
    weakCrypto: weak, weakCryptoReasons: weakReasons
  }, appCfg.riskWeights);
  const cert = await prisma.certificate.create({
    data: {
      host: String(host).trim(), port: Number(port) || 443,
      cn: cn || String(host).trim(),
      san: Array.isArray(san) ? san : (san ? String(san).split(/[,\s;]+/).filter(Boolean) : [String(host).trim()]),
      issuer: issuer || 'Manual', thumbprint: thumbprint || '',
      validFrom: toDate(validFrom), validTo: vTo,
      daysLeft, chainValid: chainValid !== undefined ? !!chainValid : true,
      chainError: chainError || null,
      dnsMatch: dnsMatch !== undefined ? !!dnsMatch : true,
      selfSigned: !!selfSigned, keyAlgo: keyAlgo || 'RSA', keySize: keySize != null ? Number(keySize) : 2048,
      tlsVersion: tlsVersion || null, cipher: cipher || null, sigAlgo: sigAlgo || null,
      weakCrypto: weak, weakCryptoReasons: weakReasons,
      status, riskScore: score, riskReasons: reasons,
      owner: owner ? String(owner).trim() : null, critical: !!critical,
      source: ['scan', 'manual', 'file', 'generated'].includes(source) ? source : 'manual',
      lastScannedAt: new Date()
    }
  });
  await audit('cert.create', req.user.email, cert.host);
  res.status(201).json(enrich(cert));
});

app.get('/api/certificates/:id', auth, async (req, res) => {
  const c = await prisma.certificate.findUnique({ where: { id: req.params.id } });
  if (!c) return res.status(404).json({ error: 'not found' });
  res.json(enrich(c));
});

// Загрузка файлов сертификатов (.pem/.crt/.cer/.der, 1 или несколько):
// всё извлекается из файла автоматически, host берётся из CN/SAN.
const uploadMw = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 10 } }).array('files', 10);

app.post('/api/certificates/upload', auth, (req, res, next) => {
  uploadMw(req, res, async (err) => {
    if (err) return res.status(400).json({ error: 'файл слишком большой (макс. 2 МБ, до 10 файлов)' });
    try {
      const { port, owner, critical } = req.body || {};
      const files = req.files || [];
      if (!files.length) return res.status(400).json({ error: 'приложи файл .pem / .crt / .cer / .der' });
      const appCfg = await getApp();
      const th = appCfg.statusThresholds;
      const defaultOwner = owner && String(owner).trim() ? String(owner).trim() : null;
      const scanPort = Number(port) || 443;
      let added = 0, updated = 0;
      const failed = [], items = [];
      for (const f of files) {
        try {
          const p = parseCertFile(f.buffer);
          const vTo = toDate(p.validTo);
          const vFrom = toDate(p.validFrom);
          const daysLeft = vTo ? Math.floor((vTo - Date.now()) / 86400000) : null;
          const san = (p.san || []).filter(Boolean);
          const host = (p.cn && !p.cn.startsWith('*') ? p.cn : null)
            || san.find((s) => !s.startsWith('*'))
            || (p.cn || null)
            || String(f.originalname).replace(/\.(pem|crt|cer|der)$/i, '');
          if (!host) throw new Error('в сертификате нет CN/SAN — не на что сослаться');
          const crypto = evaluateCrypto({ keyAlgo: p.keyAlgo, keyBits: p.keySize, sigAlgo: p.sigAlgo, tlsVersion: null, cipher: null });
          const status = statusFromDays(daysLeft, th);
          const existing = await prisma.certificate.findFirst({ where: { host, port: scanPort } });
          const finalOwner = defaultOwner || existing?.owner || null;
          const finalCritical = critical === true || critical === 'true' ? true : !!existing?.critical;
          const { score, reasons } = calcRisk({
            daysLeft, critical: finalCritical, chainValid: !p.selfSigned,
            selfSigned: p.selfSigned, dnsMatch: dnsMatches(host, p.cn, san), hasOwner: !!finalOwner,
            weakCrypto: crypto.weak, weakCryptoReasons: crypto.reasons
          }, appCfg.riskWeights);
          const data = {
            cn: p.cn || host, san, issuer: p.issuer, thumbprint: p.thumbprint,
            validFrom: vFrom, validTo: vTo, daysLeft,
            chainValid: !p.selfSigned, chainError: p.selfSigned ? 'self-signed' : null,
            dnsMatch: dnsMatches(host, p.cn, san), selfSigned: p.selfSigned,
            keyAlgo: p.keyAlgo || 'RSA', keySize: p.keySize,
            tlsVersion: null, cipher: null, sigAlgo: p.sigAlgo,
            weakCrypto: crypto.weak, weakCryptoReasons: crypto.reasons,
            status, riskScore: score, riskReasons: reasons,
            owner: finalOwner, critical: finalCritical, source: 'file', lastScannedAt: new Date()
          };
          if (existing) {
            const c = await prisma.certificate.update({ where: { id: existing.id }, data });
            updated++; items.push(enrich(c));
          } else {
            const c = await prisma.certificate.create({ data: { host, port: scanPort, ...data } });
            added++; items.push(enrich(c));
          }
        } catch (e) {
          failed.push({ file: f.originalname, error: String(e.message || e) });
        }
      }
      await audit('cert.upload', req.user.email, `файлов ${files.length}: +${added}, обновлено ${updated}`);
      await checkForUser(req.user.id);
      res.status(201).json({ added, updated, failed, items });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });
});

// Генерация самоподписанного сертификата (страница «Создать»).
// Возвращает данные + PEM (сертификат и ключ) БЕЗ сохранения;
// сохранение — отдельным POST /api/certificates, скачивание — на клиенте.
app.post('/api/certificates/generate', auth, async (req, res) => {
  try {
    const { host, san, days, keySize, org } = req.body || {};
    const cn = String(host || '').trim();
    if (!cn) return res.status(400).json({ error: 'укажи CN (DNS-имя)' });
    const bits = Number(keySize) === 4096 ? 4096 : 2048;
    const daysNum = Math.min(825, Math.max(1, Number(days) || 365));
    const sanList = [...new Set([
      cn,
      ...String(san || '').split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean)
    ])].slice(0, 20);
    const keys = forge.pki.rsa.generateKeyPair({ bits });
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0') + Date.now().toString(16).slice(-8);
    const now = new Date();
    cert.validity.notBefore = now;
    cert.validity.notAfter = new Date(now.getTime() + daysNum * 86400000);
    const attrs = [{ name: 'commonName', value: cn }];
    if (org && String(org).trim()) attrs.push({ name: 'organizationName', value: String(org).trim() });
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: sanList.map((v) => (/^\d+\.\d+\.\d+\.\d+$/.test(v) ? { type: 7, ip: v } : { type: 2, value: v })) }
    ]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const certPem = forge.pki.certificateToPem(cert);
    const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
    const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const sha1 = forge.md.sha1.create();
    sha1.update(derBytes);
    const thumb = sha1.digest().toHex().toUpperCase().match(/../g).join(':');
    const crypto = evaluateCrypto({ keyAlgo: 'rsa', keyBits: bits, sigAlgo: 'sha256WithRSAEncryption', tlsVersion: null, cipher: null });
    res.json({
      host: cn, port: 443, cn, san: sanList, issuer: cn, thumbprint: thumb,
      validFrom: now.toISOString(), validTo: cert.validity.notAfter.toISOString(), daysLeft: daysNum,
      chainValid: false, chainError: 'self-signed', dnsMatch: true, selfSigned: true,
      keyAlgo: 'RSA', keySize: bits, tlsVersion: null, cipher: null, sigAlgo: 'sha256WithRSAEncryption',
      weakCrypto: crypto.weak, weakCryptoReasons: crypto.reasons,
      certPem, privateKeyPem: keyPem
    });
  } catch (e) {
    res.status(500).json({ error: 'не удалось сгенерировать: ' + String(e.message || e) });
  }
});

// Импорт списком: DNS / IP / URL / host:port. Издатель, даты, self-signed,
// цепочка, DNS-соответствие определяются автоматически реальным TLS.
app.post('/api/certificates/import', auth, async (req, res) => {
  const { targets, port, owner, critical } = req.body || {};
  const lines = Array.isArray(targets) ? targets : String(targets || '').split(/[\n,;]+/);
  const expanded = expandTargets(lines);
  if (!expanded.length) return res.status(400).json({ error: 'пустой список целей. Формат: DNS / IP / URL / host:port, по одному на строку' });
  if (expanded.length > 50) return res.status(400).json({ error: 'не больше 50 целей за раз' });
  const appCfg = await getApp();
  const th = appCfg.statusThresholds;
  const cfg = appCfg.scheduler || {};
  const scanPort = Number(port) || cfg.defaultPort || 443;
  const defaultOwner = owner && String(owner).trim() ? String(owner).trim() : null;
  let results;
  try {
    results = await scanMany(expanded, {
      port: scanPort, timeoutMs: cfg.timeoutMs || 6000,
      concurrency: Math.min(cfg.concurrency || 20, 10)
    });
  } catch (e) {
    return res.status(500).json({ error: 'ошибка сканирования: ' + String(e.message || e) });
  }
  let added = 0, updated = 0;
  const failed = [], items = [];
  for (const r of results) {
    if (!r.ok) { failed.push({ host: r.host, port: r.port, error: r.error }); continue; }
    const status = statusFromDays(r.daysLeft, th);
    const existing = await prisma.certificate.findFirst({ where: { host: r.host, port: r.port } });
    const finalOwner = defaultOwner || existing?.owner || null;
    const finalCritical = critical === true ? true : !!existing?.critical;
    const { score, reasons } = calcRisk({
      daysLeft: r.daysLeft, critical: finalCritical, chainValid: r.chainValid,
      selfSigned: !!r.selfSigned, dnsMatch: r.dnsMatch, hasOwner: !!finalOwner,
      weakCrypto: !!r.weakCrypto, weakCryptoReasons: r.weakCryptoReasons || []
    }, appCfg.riskWeights);
    const data = {
      cn: r.cn, san: r.san, issuer: r.issuer, thumbprint: r.thumbprint,
      validFrom: toDate(r.validFrom), validTo: toDate(r.validTo), daysLeft: r.daysLeft,
      chainValid: r.chainValid, chainError: r.chainError || null,
      dnsMatch: r.dnsMatch, selfSigned: !!r.selfSigned,
      keyAlgo: r.keyAlgo, keySize: r.keySize,
      tlsVersion: r.tlsVersion || null, cipher: r.cipher || null, sigAlgo: r.sigAlgo || null,
      weakCrypto: !!r.weakCrypto, weakCryptoReasons: r.weakCryptoReasons || [],
      status,
      riskScore: score, riskReasons: reasons,
      owner: finalOwner, critical: finalCritical, lastScannedAt: new Date()
    };
    if (existing) {
      const c = await prisma.certificate.update({ where: { id: existing.id }, data });
      updated++; items.push(enrich(c));
    } else {
      const c = await prisma.certificate.create({ data: { host: r.host, port: r.port, source: 'scan', ...data } });
      added++; items.push(enrich(c));
    }
  }
  await audit('cert.import', req.user.email, `+${added} обновлено ${updated}, ошибок ${failed.length}`);
  await checkForUser(req.user.id);
  res.status(201).json({ added, updated, failed, items });
});

app.patch('/api/certificates/:id', auth, async (req, res) => {
  const c = await prisma.certificate.findUnique({ where: { id: req.params.id } });
  if (!c) return res.status(404).json({ error: 'not found' });
  const { owner, critical } = req.body || {};
  const appCfg = await getApp();
  const newOwner = owner !== undefined ? (owner ? String(owner).trim() || null : null) : c.owner;
  const newCritical = critical !== undefined ? !!critical : c.critical;
  const { score, reasons } = calcRisk({
    daysLeft: c.daysLeft, critical: newCritical, chainValid: c.chainValid,
    selfSigned: c.selfSigned, dnsMatch: c.dnsMatch, hasOwner: !!newOwner,
    weakCrypto: !!c.weakCrypto, weakCryptoReasons: c.weakCryptoReasons || []
  }, appCfg.riskWeights);
  const upd = await prisma.certificate.update({
    where: { id: c.id }, data: { owner: newOwner, critical: newCritical, riskScore: score, riskReasons: reasons }
  });
  await audit('cert.update', req.user.email, c.host);
  res.json(enrich(upd));
});

app.delete('/api/certificates/:id', auth, async (req, res) => {
  await prisma.certificate.delete({ where: { id: req.params.id } }).catch(() => null);
  await audit('cert.delete', req.user.email, req.params.id);
  res.json({ ok: true });
});

// ---------- Scanning ----------
const jobs = new Map();

app.post('/api/scanning/start', auth, async (req, res) => {
  const { targets = [], port, timeoutMs, concurrency } = req.body || {};
  const appCfg = await getApp();
  const cfg = appCfg.scheduler || {};
  const lines = Array.isArray(targets) ? targets : String(targets || '').split(/[\n,;]+/);
  const expanded = expandTargets(lines);
  if (!expanded.length) return res.status(400).json({ error: 'пустой список целей. Формат: DNS / IP / URL / host:port' });
  const row = await prisma.scanJob.create({
    data: {
      userId: req.user.id,
      targets: expanded.map((t) => (t.port ? `${t.host}:${t.port}` : t.host)),
      status: 'RUNNING', total: expanded.length, processed: 0
    }
  });
  const job = { ...row, targets: row.targets };
  jobs.set(row.id, job);
  await audit('scan.start', req.user.email, `${expanded.length} целей`);
  res.json({ jobId: row.id, total: row.total });

  const scanPort = port || cfg.defaultPort || 443;
  const th = appCfg.statusThresholds;
  try {
    const results = await scanMany(expanded, {
      port: scanPort, timeoutMs: timeoutMs || cfg.timeoutMs || 6000,
      concurrency: concurrency || cfg.concurrency || 20,
      onProgress: (done) => {
        job.processed = done;
        if (done % 5 === 0 || done === expanded.length) {
          prisma.scanJob.update({ where: { id: row.id }, data: { processed: done } }).catch(() => {});
        }
      }
    });
    for (const r of results) {
      if (!r.ok) {
        await prisma.certificate.create({
          data: {
            host: r.host, port: r.port, cn: '', san: [], issuer: '—', thumbprint: '',
            daysLeft: null, chainValid: false, dnsMatch: false, selfSigned: false,
            status: 'UNKNOWN', riskScore: 50,
            riskReasons: [`не удалось подключиться: ${r.error}`],
            owner: null, source: 'scan', lastScannedAt: new Date()
          }
        });
        continue;
      }
      const status = statusFromDays(r.daysLeft, th);
      const { score, reasons } = calcRisk({
        daysLeft: r.daysLeft, critical: false, chainValid: r.chainValid,
        selfSigned: !!r.selfSigned, dnsMatch: r.dnsMatch, hasOwner: false,
        weakCrypto: !!r.weakCrypto, weakCryptoReasons: r.weakCryptoReasons || []
      }, appCfg.riskWeights);
      const existing = await prisma.certificate.findFirst({ where: { host: r.host, port: r.port } });
      const data = {
        cn: r.cn, san: r.san, issuer: r.issuer, thumbprint: r.thumbprint,
        validFrom: toDate(r.validFrom), validTo: toDate(r.validTo), daysLeft: r.daysLeft,
        chainValid: r.chainValid, chainError: r.chainError || null,
        dnsMatch: r.dnsMatch, selfSigned: !!r.selfSigned,
        keyAlgo: r.keyAlgo, keySize: r.keySize,
        tlsVersion: r.tlsVersion || null, cipher: r.cipher || null, sigAlgo: r.sigAlgo || null,
        weakCrypto: !!r.weakCrypto, weakCryptoReasons: r.weakCryptoReasons || [],
        status,
        riskScore: score, riskReasons: reasons, lastScannedAt: new Date()
      };
      if (existing) {
        const keepOwner = !!existing.owner;
        const rs = calcRisk({
          daysLeft: r.daysLeft, critical: !!existing.critical, chainValid: r.chainValid,
          selfSigned: !!r.selfSigned, dnsMatch: r.dnsMatch, hasOwner: keepOwner,
          weakCrypto: !!r.weakCrypto, weakCryptoReasons: r.weakCryptoReasons || []
        }, appCfg.riskWeights);
        await prisma.certificate.update({
          where: { id: existing.id },
          data: { ...data, critical: !!existing.critical, riskScore: rs.score, riskReasons: rs.reasons }
        });
      } else {
        await prisma.certificate.create({ data: { host: r.host, port: r.port, owner: null, critical: false, source: 'scan', ...data } });
      }
    }
    await prisma.scanJob.update({ where: { id: row.id }, data: { status: 'DONE', processed: row.total, finishedAt: new Date() } });
    job.status = 'DONE'; job.processed = row.total;
    const users = await prisma.user.findMany({ select: { id: true } });
    for (const u of users) await checkForUser(u.id);
  } catch (e) {
    await prisma.scanJob.update({ where: { id: row.id }, data: { status: 'FAILED', finishedAt: new Date() } }).catch(() => {});
    job.status = 'FAILED';
  }
});

app.get('/api/scanning/:jobId', auth, async (req, res) => {
  if (jobs.has(req.params.jobId)) return res.json(jobs.get(req.params.jobId));
  const j = await prisma.scanJob.findUnique({ where: { id: req.params.jobId } });
  if (!j) return res.status(404).json({ error: 'job not found' });
  res.json(j);
});

app.get('/api/scanning/history/list', auth, async (req, res) => {
  const list = await prisma.scanJob.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  res.json(list);
});

// ---------- Notifications ----------
app.get('/api/notifications', auth, async (req, res) => {
  const list = await prisma.notification.findMany({
    where: { userId: req.user.id }, orderBy: { sentAt: 'desc' }, take: 100
  });
  res.json(list);
});

app.get('/api/notifications/settings', auth, async (req, res) => {
  res.json(settingView(await getUserSetting(req.user.id)));
});

app.patch('/api/notifications/settings', auth, async (req, res) => {
  const { thresholds, channels } = req.body || {};
  const data = {};
  if (Array.isArray(thresholds)) {
    data.thresholds = thresholds.map(Number).filter((n) => !Number.isNaN(n) && n >= 1 && n <= 365).slice(0, 20);
  }
  if (channels) {
    if (channels.emailEnabled !== undefined) data.emailEnabled = !!channels.emailEnabled;
    if (channels.telegramEnabled !== undefined) data.telegramEnabled = !!channels.telegramEnabled;
    if (channels.email !== undefined) data.email = String(channels.email || '').trim() || null;
    if (channels.telegramBotToken !== undefined) data.telegramBotToken = String(channels.telegramBotToken || '').trim() || null;
    if (channels.telegramUsername !== undefined) {
      const uname = String(channels.telegramUsername || '').replace(/^@/, '').trim();
      const prev = await getUserSetting(req.user.id);
      data.telegramUsername = uname || null;
      if (uname !== (prev.telegramUsername || '')) {
        data.telegramStatus = 'pending';
        data.telegramChatId = null;
      }
    }
  }
  const st = await prisma.notificationSetting.upsert({ where: { userId: req.user.id }, update: data, create: { userId: req.user.id, ...data } });
  await audit('notif.settings', req.user.email);
  res.json(settingView(st));
});

// Привязка Telegram по нику: сохраняем ник → статус «ожидание» → ищем chat_id в getUpdates
app.post('/api/notifications/telegram/link', auth, async (req, res) => {
  const { username, botToken } = req.body || {};
  const uname = String(username || '').replace(/^@/, '').trim();
  if (!uname) return res.status(400).json({ error: 'укажи ник в Telegram (без @ тоже можно)' });
  const data = { telegramUsername: uname, telegramStatus: 'pending', telegramChatId: null };
  if (botToken !== undefined) data.telegramBotToken = String(botToken || '').trim() || null;
  await prisma.notificationSetting.upsert({ where: { userId: req.user.id }, update: data, create: { userId: req.user.id, ...data } });
  const st = await getUserSetting(req.user.id);
  if (!st.telegramBotToken) {
    return res.json({ status: 'need-token', message: 'Сначала вставь токен бота (возьми у @BotFather), потом привязывай ник.' });
  }
  const linked = await tryLinkTelegram(req.user.id);
  await audit('telegram.link', req.user.email, '@' + uname);
  if (linked.telegramStatus === 'linked') {
    return res.json({ status: 'linked', message: 'Готово — бот тебя нашёл, уведомления включены.' });
  }
  if (linked.linkError) return res.json({ status: 'error', message: linked.linkError });
  return res.json({
    status: 'pending',
    message: 'Ожидание: напиши боту любое сообщение (например «старт») и нажми «Я написал, проверить». Telegram не отдаёт chat_id по нику, пока человек сам не напишет боту.'
  });
});

// «Я написал боту» — повторная попытка найти chat_id
app.post('/api/notifications/telegram/check', auth, async (req, res) => {
  const linked = await tryLinkTelegram(req.user.id);
  if (linked.telegramStatus === 'linked') return res.json({ status: 'linked', message: 'Готово — бот тебя нашёл.' });
  if (linked.linkError) return res.json({ status: 'error', message: linked.linkError });
  return res.json({ status: 'pending', message: 'Пока не вижу сообщений. Напиши боту и попробуй ещё раз.' });
});

app.post('/api/notifications/test', auth, async (req, res) => {
  const { channel } = req.body || {};
  const st = await getUserSetting(req.user.id);
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (channel === 'telegram') {
    if (!st.telegramBotToken) return res.status(400).json({ error: 'укажи токен бота' });
    if (st.telegramStatus !== 'linked' || !st.telegramChatId) {
      return res.status(400).json({ error: 'сначала привяжи ник: напиши боту и нажми «Я написал, проверить»' });
    }
    const j = await tgApi(st.telegramBotToken, 'sendMessage', {
      chat_id: st.telegramChatId, text: '🔐 CertRecord: тестовое уведомление. Мониторинг сертификатов работает.'
    });
    if (!j.ok) return res.status(500).json({ error: 'Bot API: ' + (j.description || 'ошибка') });
    return res.json({ ok: true });
  }
  if (channel === 'email') {
    try {
      await sendMail(st.email || user.email, 'CertRecord — тест', 'Тестовое уведомление CertRecord. Канал работает.');
      return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ error: String(e.message || e) }); }
  }
  await prisma.notification.create({
    data: { userId: req.user.id, type: 'EXPIRING', channel: 'APP', subject: 'Тестовое уведомление', body: 'Канал работает.' }
  });
  res.json({ ok: true });
});

app.post('/api/notifications/check', auth, async (req, res) => {
  const fresh = await checkForUser(req.user.id);
  res.json({ created: fresh.length, items: fresh });
});

// ---------- Export ----------
async function exportRows() {
  const certs = await prisma.certificate.findMany({ orderBy: { daysLeft: 'asc' } });
  return certs.map((c) => ({
    Сервис: c.host, Порт: c.port, CN: c.cn, SAN: (c.san || []).join('; '),
    Издатель: c.issuer, Отпечаток: c.thumbprint,
    'Действует с': c.validFrom ? String(c.validFrom).slice(0, 10) : '',
    Истекает: c.validTo ? String(c.validTo).slice(0, 10) : '',
    'Осталось дн.': c.daysLeft,
    'Цепочка': c.chainValid ? 'валидна' : `ошибка${c.chainError ? ': ' + c.chainError : ''}`,
    'DNS-соответствие': c.dnsMatch ? 'да' : 'нет',
    'TLS-версия': c.tlsVersion || '', Шифр: c.cipher || '', Подпись: c.sigAlgo || '',
    'Ключ': c.keyAlgo && c.keySize ? `${c.keyAlgo} ${c.keySize}` : (c.keyAlgo || ''),
    'Криптография': c.weakCrypto ? 'слабая: ' + (c.weakCryptoReasons || []).join('; ') : 'надёжная',
    Проблемы: detectProblems(c).map((p) => p.label).join('; '),
    Статус: STATUS_LABEL[c.status] || c.status,
    Риск: c.riskScore, Владелец: c.owner || ''
  }));
}

app.get('/api/export/csv', auth, async (req, res) => {
  const rows = await exportRows();
  const head = Object.keys(rows[0] || { Сервис: '' });
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [head.join(';'), ...rows.map((x) => head.map((h) => esc(x[h])).join(';'))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="certrecord.csv"');
  res.send('﻿' + csv);
});

app.get('/api/export/excel', auth, async (req, res) => {
  const { default: XLSX } = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(await exportRows());
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Certificates');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="certrecord.xlsx"');
  res.send(Buffer.from(buf));
});

app.get('/api/export/html', auth, async (req, res) => {
  const certs = await prisma.certificate.findMany({ orderBy: { daysLeft: 'asc' } });
  const trs = certs.map((c) => `<tr><td>${c.host}</td><td>${c.issuer || ''}</td><td>${c.validTo ? String(c.validTo).slice(0, 10) : ''}</td><td>${c.daysLeft ?? ''}</td><td>${STATUS_LABEL[c.status] || ''}</td><td>${c.riskScore}/100</td></tr>`).join('');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>CertRecord — отчёт</title><style>body{font-family:Inter,Arial;background:#0A0A0A;color:#fff;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #333;padding:8px;font-size:13px}th{background:#1a1a1a}</style></head><body><h1>CertRecord — отчёт по сертификатам (${certs.length})</h1><p>Сформирован: ${new Date().toLocaleString('ru-RU')}</p><table><tr><th>Сервис</th><th>Издатель</th><th>Истечение</th><th>Осталось дн.</th><th>Статус</th><th>Риск</th></tr>${trs}</table></body></html>`);
});

// ---------- Settings (глобальные) ----------
app.get('/api/settings', auth, async (req, res) => {
  const s = await getApp();
  res.json({ thresholds: s.statusThresholds, riskWeights: s.riskWeights, scheduler: s.scheduler });
});

app.patch('/api/settings', auth, async (req, res) => {
  const s = await getApp();
  const { thresholds, riskWeights, scheduler } = req.body || {};
  const data = {};
  if (thresholds) data.statusThresholds = { ...s.statusThresholds, ...thresholds };
  if (riskWeights) {
    const rw = {};
    for (const k of ['daysLeft', 'criticality', 'chain', 'owner']) {
      const v = Number(riskWeights[k]);
      if (!Number.isNaN(v) && v >= 0 && v <= 1) rw[k] = v;
    }
    data.riskWeights = { ...s.riskWeights, ...rw };
  }
  if (scheduler) data.scheduler = { ...s.scheduler, ...scheduler };
  const upd = await prisma.appSettings.update({ where: { id: 'global' }, data });
  // пересчёт статусов и риска (пороги/веса могли измениться)
  const certs = await prisma.certificate.findMany();
  for (const c of certs) {
    const status = statusFromDays(c.daysLeft, upd.statusThresholds);
    const { score, reasons } = calcRisk({
      daysLeft: c.daysLeft, critical: !!c.critical, chainValid: c.chainValid,
      selfSigned: c.selfSigned, dnsMatch: c.dnsMatch, hasOwner: !!c.owner,
      weakCrypto: !!c.weakCrypto, weakCryptoReasons: c.weakCryptoReasons || []
    }, upd.riskWeights);
    await prisma.certificate.update({ where: { id: c.id }, data: { status, riskScore: score, riskReasons: reasons } });
  }
  await audit('settings.update', req.user.email);
  res.json({ thresholds: upd.statusThresholds, riskWeights: upd.riskWeights, scheduler: upd.scheduler });
});

app.get('/api/audit', auth, async (req, res) => {
  res.json(await prisma.auditLog.findMany({ orderBy: { at: 'desc' }, take: 100 }));
});

app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: 'postgres+prisma', time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Всегда отвечаем JSON-ошибкой, а не пустым/HTML 500
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[api error]', err?.message || err);
  if (res.headersSent) return next(err);
  res.status(err?.status || 500).json({ error: err?.message || 'внутренняя ошибка сервера' });
});

// ---------- Фон ----------
// 1) пересканирование ВСЕХ сертификатов каждые 5 минут (владелец/критичность не затираются)
let refreshing = false;
async function refreshAllCerts(reason = 'schedule') {
  if (refreshing) return;
  refreshing = true;
  try {
    const appCfg = await getApp();
    const cfg = appCfg.scheduler || {};
    const th = appCfg.statusThresholds;
    const certs = await prisma.certificate.findMany();
    if (!certs.length) return;
    const results = await scanMany(certs.map((c) => ({ host: c.host, port: c.port || cfg.defaultPort || 443 })), {
      port: cfg.defaultPort || 443,
      timeoutMs: cfg.timeoutMs || 6000,
      concurrency: Math.min(cfg.concurrency || 20, 20)
    });
    const byHost = new Map(results.filter((r) => r.ok).map((r) => [`${r.host}:${r.port}`, r]));
    let updated = 0;
    for (const c of certs) {
      const r = byHost.get(`${c.host}:${c.port || 443}`);
      let daysLeft = c.daysLeft;
      const data = { lastScannedAt: new Date() };
      if (r) {
        Object.assign(data, {
          cn: r.cn, san: r.san, issuer: r.issuer, thumbprint: r.thumbprint,
          validFrom: toDate(r.validFrom), validTo: toDate(r.validTo), daysLeft: r.daysLeft,
          chainValid: r.chainValid, chainError: r.chainError || null,
          dnsMatch: r.dnsMatch, selfSigned: !!r.selfSigned,
          keyAlgo: r.keyAlgo, keySize: r.keySize,
          tlsVersion: r.tlsVersion || null, cipher: r.cipher || null, sigAlgo: r.sigAlgo || null,
          weakCrypto: !!r.weakCrypto, weakCryptoReasons: r.weakCryptoReasons || []
        });
        daysLeft = r.daysLeft;
        updated++;
      } else if (c.validTo) {
        daysLeft = Math.floor((new Date(c.validTo) - Date.now()) / 86400000);
        data.daysLeft = daysLeft;
      }
      const { score, reasons } = calcRisk({
        daysLeft, critical: !!c.critical, chainValid: data.chainValid ?? c.chainValid,
        selfSigned: data.selfSigned ?? c.selfSigned, dnsMatch: data.dnsMatch ?? c.dnsMatch,
        hasOwner: !!c.owner,
        weakCrypto: data.weakCrypto ?? c.weakCrypto,
        weakCryptoReasons: data.weakCryptoReasons ?? c.weakCryptoReasons ?? []
      }, appCfg.riskWeights);
      data.status = statusFromDays(daysLeft, th);
      data.riskScore = score;
      data.riskReasons = reasons;
      await prisma.certificate.update({ where: { id: c.id }, data });
    }
    const users = await prisma.user.findMany({ select: { id: true } });
    for (const u of users) await checkForUser(u.id).catch(() => {});
    await audit('auto-refresh', 'system', `${reason}: обновлено ${updated}/${certs.length}`);
    console.log(`[auto-refresh:${reason}] обновлено ${updated}/${certs.length}`);
  } catch (e) {
    console.error('[auto-refresh] error:', e.message);
  } finally {
    refreshing = false;
  }
}
setTimeout(() => refreshAllCerts('startup'), 20000);
setInterval(() => refreshAllCerts('schedule'), 5 * 60 * 1000);

// 2) проверка привязок Telegram (статус «ожидание») каждую минуту
setInterval(async () => {
  try {
    const pendings = await prisma.notificationSetting.findMany({
      where: { telegramStatus: 'pending', telegramBotToken: { not: null }, telegramUsername: { not: null } }
    });
    for (const st of pendings) {
      const { chatId } = await resolveTelegramChat(st.telegramBotToken, st.telegramUsername);
      if (chatId) {
        await prisma.notificationSetting.update({
          where: { userId: st.userId }, data: { telegramChatId: chatId, telegramStatus: 'linked' }
        });
        console.log(`[telegram] @${st.telegramUsername} привязан`);
      }
    }
  } catch (e) { console.error('[telegram-poll]', e.message); }
}, 60 * 1000);

app.listen(PORT, () => console.log(`CertRecord server on http://localhost:${PORT} (Postgres + Prisma)`));
