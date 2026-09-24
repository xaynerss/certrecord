import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prisma from './prisma.js';
import { statusFromDays, calcRisk, scanMany } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.join(__dirname, '..', 'data', 'db.json');
const FORCE = process.argv.includes('--force');

// Гарантируем строку глобальных настроек
await prisma.appSettings.upsert({
  where: { id: 'global' },
  update: {},
  create: {
    id: 'global',
    statusThresholds: { info: 60, warning: 30, critical: 14 },
    riskWeights: { daysLeft: 0.4, criticality: 0.3, chain: 0.2, owner: 0.1 },
    scheduler: { defaultPort: 443, timeoutMs: 6000, concurrency: 20, fullScanHours: 24 }
  }
});

const certCount = await prisma.certificate.count();
if (certCount && !FORCE) {
  console.log(`Postgres already has ${certCount} certificates, skip seed (use --force)`);
  process.exit(0);
}

// 1) перенос из старого data/db.json (пользователи с хешами + сертификаты)
if (fs.existsSync(JSON_PATH)) {
  try {
    const old = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
    if (FORCE) {
      await prisma.notification.deleteMany();
      await prisma.scanJob.deleteMany();
      await prisma.certificate.deleteMany();
    }
    let u = 0;
    for (const ou of old.users || []) {
      await prisma.user.upsert({
        where: { email: ou.email },
        update: {},
        create: { email: ou.email, password: ou.password, name: ou.name || '', role: ou.role || 'USER' }
      });
      u++;
    }
    const app = await prisma.appSettings.findUnique({ where: { id: 'global' } });
    let c = 0;
    for (const oc of old.certificates || []) {
      const toDate = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
      const daysLeft = oc.daysLeft ?? (oc.validTo ? Math.floor((new Date(oc.validTo) - Date.now()) / 86400000) : null);
      const status = statusFromDays(daysLeft, app.statusThresholds);
      const { score, reasons } = calcRisk({
        daysLeft, critical: !!oc.critical, chainValid: oc.chainValid,
        selfSigned: !!oc.selfSigned, dnsMatch: oc.dnsMatch, hasOwner: !!oc.owner
      }, app.riskWeights);
      await prisma.certificate.create({
        data: {
          host: oc.host, port: oc.port || 443, cn: oc.cn || oc.host, san: oc.san || [],
          issuer: oc.issuer || null, thumbprint: oc.thumbprint || null,
          validFrom: toDate(oc.validFrom), validTo: toDate(oc.validTo), daysLeft,
          chainValid: oc.chainValid ?? null, dnsMatch: oc.dnsMatch ?? null,
          selfSigned: !!oc.selfSigned, keyAlgo: oc.keyAlgo || null,
          keySize: oc.keySize ?? null, status, riskScore: score, riskReasons: reasons,
          owner: oc.owner || null, critical: !!oc.critical,
          lastScannedAt: toDate(oc.lastScannedAt)
        }
      });
      c++;
    }
    // настройки уведомлений каждому пользователю
    for (const usr of await prisma.user.findMany()) {
      await prisma.notificationSetting.upsert({ where: { userId: usr.id }, update: {}, create: { userId: usr.id } });
    }
    console.log(`Imported from db.json: users=${u}, certificates=${c} -> Postgres`);
    process.exit(0);
  } catch (e) {
    console.log('db.json import failed, fallback to live scan:', e.message);
  }
}

// 2) живой скан реальных хостов
const REAL_TARGETS = ['google.com', 'github.com', 'cloudflare.com', 'microsoft.com', 'apple.com', 'amazon.com', 'digicert.com', 'letsencrypt.org', 'sectigo.com', 'globalsign.com'];
console.log(`Live-scanning ${REAL_TARGETS.length} hosts...`);
const app = await prisma.appSettings.findUnique({ where: { id: 'global' } });
const results = await scanMany(REAL_TARGETS.map((host) => ({ host, port: null })), { port: 443, timeoutMs: 8000, concurrency: 5 });
if (FORCE) await prisma.certificate.deleteMany();
let n = 0;
for (const r of results) {
  if (!r.ok) { console.log(`  ✗ ${r.host}: ${r.error}`); continue; }
  const status = statusFromDays(r.daysLeft, app.statusThresholds);
  const { score, reasons } = calcRisk({
    daysLeft: r.daysLeft, critical: false, chainValid: r.chainValid,
    selfSigned: !!r.selfSigned, dnsMatch: r.dnsMatch, hasOwner: false,
    weakCrypto: !!r.weakCrypto, weakCryptoReasons: r.weakCryptoReasons || []
  }, app.riskWeights);
  await prisma.certificate.create({
    data: {
      host: r.host, port: r.port, cn: r.cn, san: r.san, issuer: r.issuer,
      thumbprint: r.thumbprint, validFrom: new Date(r.validFrom), validTo: new Date(r.validTo),
      daysLeft: r.daysLeft, chainValid: r.chainValid, chainError: r.chainError || null,
      dnsMatch: r.dnsMatch,
      selfSigned: !!r.selfSigned, keyAlgo: r.keyAlgo, keySize: r.keySize,
      tlsVersion: r.tlsVersion || null, cipher: r.cipher || null, sigAlgo: r.sigAlgo || null,
      weakCrypto: !!r.weakCrypto, weakCryptoReasons: r.weakCryptoReasons || [],
      status, riskScore: score, riskReasons: reasons, lastScannedAt: new Date()
    }
  });
  n++;
  console.log(`  ✓ ${r.host}: ${r.issuer}, ${r.daysLeft} дн., ${status}`);
}
console.log(`Seeded ${n} REAL certificates -> Postgres`);
process.exit(0);
