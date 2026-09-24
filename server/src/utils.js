import tls from 'node:tls';
import net from 'node:net';
import dns from 'node:dns/promises';
import { X509Certificate } from 'node:crypto';

// OID → имя алгоритма подписи (для evaluateCrypto достаточно md5/sha1/sha2 различий)
const SIG_NAMES = {
  '1.2.840.113549.1.1.2': 'md2WithRSAEncryption',
  '1.2.840.113549.1.1.4': 'md5WithRSAEncryption',
  '1.2.840.113549.1.1.5': 'sha1WithRSAEncryption',
  '1.2.840.113549.1.1.11': 'sha256WithRSAEncryption',
  '1.2.840.113549.1.1.12': 'sha384WithRSAEncryption',
  '1.2.840.113549.1.1.13': 'sha512WithRSAEncryption',
  '1.2.840.113549.1.1.14': 'sha224WithRSAEncryption',
  '1.2.840.10045.4.1': 'ecdsa-with-SHA1',
  '1.2.840.10045.4.3.1': 'ecdsa-with-SHA224',
  '1.2.840.10045.4.3.2': 'ecdsa-with-SHA256',
  '1.2.840.10045.4.3.3': 'ecdsa-with-SHA384',
  '1.2.840.10045.4.3.4': 'ecdsa-with-SHA512',
  '1.2.840.10040.4.3': 'dsa-with-SHA1',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448'
};

// Мини-DER-парсер: достаём OID алгоритма подписи из Certificate
// (Certificate ::= SEQ { tbs SEQ, signatureAlgorithm SEQ { OID, ... }, signature BIT STRING })
function sigOidFromDER(der) {
  try {
    const buf = Buffer.from(der);
    const readLen = (off) => {
      let len = buf[off++];
      if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = (len << 8) | buf[off++]; }
      return [len, off];
    };
    const readTLV = (off) => {
      const tag = buf[off++];
      const [len, head] = readLen(off);
      return { tag, head, end: head + len };
    };
    const outer = readTLV(0);
    if (outer.tag !== 0x30) return null;
    const tbs = readTLV(outer.head);
    const sigAlg = readTLV(tbs.end);
    if (sigAlg.tag !== 0x30) return null;
    const oid = readTLV(sigAlg.head);
    if (oid.tag !== 0x06) return null;
    const bytes = buf.subarray(oid.head, oid.end);
    if (!bytes.length) return null;
    const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40];
    let v = 0;
    for (let i = 1; i < bytes.length; i++) { v = (v << 7) | (bytes[i] & 0x7f); if (!(bytes[i] & 0x80)) { parts.push(v); v = 0; } }
    return parts.join('.');
  } catch {
    return null;
  }
}

export function sigAlgoFromRaw(raw) {
  try {
    if (!raw) return null;
    const oid = sigOidFromDER(derFromPem(raw));
    if (!oid) return null;
    return SIG_NAMES[oid] || `OID ${oid}`;
  } catch {
    return null;
  }
}

// PEM → DER (снимаем броню); DER возвращаем как есть
export function derFromPem(raw) {
  try {
    const text = Buffer.from(raw).toString('utf8');
    const m = text.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/);
    if (m) return Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
    return Buffer.from(raw);
  } catch {
    return Buffer.from(raw);
  }
}

const EC_CURVE_BITS = {
  '1.2.840.10045.3.1.1': 192, '1.2.840.10045.3.1.7': 256,
  '1.3.132.0.34': 384, '1.3.132.0.35': 521, '1.3.101.112': 256, '1.3.101.113': 456
};
const OID_RSA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];
const OID_EC = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01];

// Размер/тип ключа прямо из DER (когда X509 в Node не отдаёт asymmetricKeySize)
export function keyInfoFromDER(raw) {
  try {
    const buf = derFromPem(raw);
    const find = (pat) => {
      outer: for (let i = 0; i + pat.length <= buf.length; i++) {
        for (let j = 0; j < pat.length; j++) if (buf[i + j] !== pat[j]) continue outer;
        return i;
      }
      return -1;
    };
    const readLen = (off) => {
      let len = buf[off++];
      if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = (len << 8) | buf[off++]; }
      return [len, off];
    };
    const findAll = (pat) => {
      const out = [];
      outer: for (let i = 0; i + pat.length <= buf.length; i++) {
        for (let j = 0; j < pat.length; j++) if (buf[i + j] !== pat[j]) continue outer;
        out.push(i);
      }
      return out;
    };
    for (const i of findAll(OID_RSA)) {
      // ... OID, 05 00 (NULL), 03 len 00, 02 modLen <modulus>
      // (первое вхождение — поле signature, там дальше не ключ)
      try {
        let off = i + OID_RSA.length;
        if (buf[off] === 0x05) off += 2; // NULL
        if (buf[off] !== 0x03) continue;
        const [, head] = readLen(off + 1);
        off = head + 1; // пропускаем байт unused bits
        if (buf[off] === 0x30) { const [, h2] = readLen(off + 1); off = h2; } // RSAPublicKey SEQ
        if (buf[off] !== 0x02) continue;
        const [mlen] = readLen(off + 1);
        if (mlen < 64) continue; // слишком мал для ключа — ложное вхождение
        return { algo: 'RSA', bits: Math.max(0, (mlen - 1) * 8) || null };
      } catch { continue; }
    }
    i = findAll(OID_EC)[0] ?? -1;
    if (i >= 0) {
      let off = i + OID_EC.length;
      if (buf[off] === 0x06) {
        const [olen, head] = readLen(off + 1);
        const parts = [];
        const bytes = buf.subarray(head, head + olen);
        if (bytes.length) {
          parts.push(Math.floor(bytes[0] / 40), bytes[0] % 40);
          let v = 0;
          for (let k = 1; k < bytes.length; k++) { v = (v << 7) | (bytes[k] & 0x7f); if (!(bytes[k] & 0x80)) { parts.push(v); v = 0; } }
          const bits = EC_CURVE_BITS[parts.join('.')] || null;
          return { algo: 'ECDSA', bits };
        }
      }
      return { algo: 'ECDSA', bits: null };
    }
    return { algo: '', bits: null };
  } catch {
    return { algo: '', bits: null };
  }
}

// ---------- Контроль слабых криптографических параметров (ТЗ 3.2, 3.9) ----------
// Правила: RSA < 2048 бит, EC < 256 бит, подпись MD5/SHA-1,
// протокол старее TLS 1.2, слабые шифры (RC4/DES/3DES/EXPORT/NULL/anon).
export function evaluateCrypto({ keyAlgo, keyBits, sigAlgo, tlsVersion, cipher }) {
  const reasons = [];
  const algo = String(keyAlgo || '');
  const bits = Number(keyBits) || 0;
  if (bits) {
    const isEC = /ec|ecdsa|prime|secp|curve|ed25519|ed448/i.test(algo);
    if (isEC && bits < 256) {
      reasons.push(`слабый ключ: EC ${bits} бит (нужно ≥ 256)`);
    } else if (!isEC && bits < 2048) {
      reasons.push(`слабый ключ: ${algo || 'RSA'} ${bits} бит (нужно ≥ 2048)`);
    }
  }
  const sig = String(sigAlgo || '').toLowerCase();
  if (sig) {
    if (sig.includes('md5')) reasons.push(`слабая подпись: ${sigAlgo}`);
    else if (sig.includes('sha1') && !sig.includes('sha256') && !sig.includes('sha384') && !sig.includes('sha512')) reasons.push(`слабая подпись: ${sigAlgo}`);
  }
  const proto = String(tlsVersion || '');
  if (proto && !/^TLSv1\.[23]$/i.test(proto)) {
    reasons.push(`устаревший протокол: ${proto} (нужен TLS 1.2+)`);
  }
  const cph = String(cipher || '').toUpperCase();
  if (cph && /(^|[^A-Z])(RC4|DES|3DES|EXPORT|NULL|ANON|PSK|SRP)([^A-Z]|$)/.test(cph.replace(/[^A-Z0-9]/g, ' '))) {
    reasons.push(`слабый шифр: ${cipher}`);
  }
  return { weak: reasons.length > 0, reasons };
}

// ---------- Статусы (настраиваемые пороги) ----------
export function calcStatus(daysLeft, th = { ok: 60, info: 30, warning: 14, critical: 0 }) {
  if (daysLeft == null || Number.isNaN(daysLeft)) return 'UNKNOWN';
  if (daysLeft < 0) return 'EXPIRED';
  if (daysLeft <= (th.critical ?? 0) + 14 && daysLeft <= 14) {
    // ТЗ: 0–14 Критично, 15–30 Предупреждение, 31–60 Информация, >60 В норме
    if (daysLeft <= 14) return 'CRITICAL';
  }
  if (daysLeft <= 30) return daysLeft <= 14 ? 'CRITICAL' : 'WARNING';
  if (daysLeft <= 60) {
    // уточняем по настраиваемым порогам
    if (daysLeft <= (th.warning ?? 30)) return 'WARNING';
    if (daysLeft <= (th.info ?? 60)) return 'INFO';
    return 'INFO';
  }
  return 'OK';
  // Простая совместимость с ТЗ Certificate Radar 3.5:
  // >60 OK, 31–60 INFO, 15–30 WARNING, 0–14 CRITICAL, <0 EXPIRED
}

// Статусы по ТЗ Certificate Radar 3.5 (пороги настраиваемые):
// <=critical — Критично, <=warning — Предупреждение, <=info — Информация,
// выше — В норме, <0 — Истёк.
export function statusFromDays(daysLeft, th = { info: 60, warning: 30, critical: 14 }) {
  if (daysLeft == null || Number.isNaN(daysLeft)) return 'UNKNOWN';
  if (daysLeft < 0) return 'EXPIRED';
  if (daysLeft <= (th.critical ?? 14)) return 'CRITICAL';
  if (daysLeft <= (th.warning ?? 30)) return 'WARNING';
  if (daysLeft <= (th.info ?? 60)) return 'INFO';
  return 'OK';
}

export function simpleStatus(daysLeft) {
  return statusFromDays(daysLeft);
}

// ---------- Risk Score 0–100 (ТЗ 3.6/3.9) ----------
// веса: дни 40%, критичность 30%, цепочка 20%, владелец 10%
// слабая криптография учитывается внутри блока цепочки (до +8 баллов)
export function calcRisk({ daysLeft, critical = false, chainValid = true, selfSigned = false, dnsMatch = true, hasOwner = false, weakCrypto = false, weakCryptoReasons = [] }, weights = { daysLeft: 0.4, criticality: 0.3, chain: 0.2, owner: 0.1 }) {
  const reasons = [];
  let score = 0;

  // дни до истечения (0–40 баллов)
  let daysPts = 0;
  if (daysLeft == null) { daysPts = 15; reasons.push('нет данных о сроке действия'); }
  else if (daysLeft < 0) { daysPts = 40; reasons.push(`сертификат истёк ${Math.abs(daysLeft)} дн. назад`); }
  else if (daysLeft <= 7) { daysPts = 38; reasons.push(`истекает через ${daysLeft} дн.`); }
  else if (daysLeft <= 14) { daysPts = 34; reasons.push(`истекает через ${daysLeft} дн.`); }
  else if (daysLeft <= 30) { daysPts = 26; reasons.push(`истекает через ${daysLeft} дн.`); }
  else if (daysLeft <= 60) { daysPts = 14; reasons.push(`истекает через ${daysLeft} дн.`); }
  else { daysPts = 4; }
  score += daysPts * (weights.daysLeft / 0.4);

  // критичность сервиса (0–30)
  if (critical) { score += 30 * (weights.criticality / 0.3); reasons.push('сервис критичный'); }

  // цепочка / self-signed / dns / слабая криптография (0–20)
  let chainPts = 0;
  if (selfSigned) { chainPts = 20; reasons.push('self-signed сертификат'); }
  else if (chainValid === false) { chainPts = 18; reasons.push('ошибка цепочки доверия'); }
  if (dnsMatch === false) { chainPts = Math.max(chainPts, 14); reasons.push('DNS-имя не соответствует CN/SAN'); }
  if (weakCrypto) {
    chainPts = Math.min(20, chainPts + 8);
    const detail = (weakCryptoReasons || []).slice(0, 2).join('; ');
    reasons.push(detail ? `слабые криптопараметры: ${detail}` : 'слабые криптопараметры');
  }
  score += chainPts * (weights.chain / 0.2);

  // владелец (0–10)
  if (!hasOwner) { score += 10 * (weights.owner / 0.1); reasons.push('отсутствует владелец'); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, reasons };
}

export function recommendationFor(cert) {
  const recs = [];
  if (cert.status === 'EXPIRED') recs.push('Срочно перевыпустите сертификат — сервис уже недоступен по TLS.');
  else if (cert.status === 'CRITICAL') recs.push('Перевыпустите сертификат в течение 14 дней, назначьте владельца.');
  else if (cert.status === 'WARNING') recs.push('Запланируйте перевыпуск в ближайшие 30 дней.');
  if (cert.selfSigned) recs.push('Замените self-signed на сертификат доверенного CA.');
  if (cert.chainValid === false) recs.push(`Проверьте полную цепочку (intermediate CA) на сервере.${cert.chainError ? ' Причина: ' + cert.chainError : ''}`);
  if (cert.dnsMatch === false) recs.push('Исправьте CN/SAN — добавьте DNS-имя сервиса.');
  if (cert.weakCrypto) recs.push('Усильте криптографию: ключ ≥ 2048 бит (EC ≥ 256), подпись SHA-256+, только TLS 1.2+.');
  if (!cert.owner) recs.push('Назначьте владельца/ответственного за сервис.');
  if (!recs.length) recs.push('Действий не требуется. Контролируйте плановый перевыпуск.');
  return recs;
}

// ---------- TLS-сканирование ----------
function parseTarget(line) {
  line = String(line || '').trim();
  if (!line) return null;
  // поддерживаем URL, host:port, IP, CIDR (CIDR раскрываем частично — первые 16 адресов для MVP)
  let host = line, port = null;
  try {
    if (/^https?:\/\//i.test(line)) {
      const u = new URL(line);
      host = u.hostname; port = u.port ? Number(u.port) : null;
    } else if (line.includes(':') && !line.includes('/')) {
      const parts = line.split(':');
      if (parts.length === 2 && /^\d+$/.test(parts[1])) { host = parts[0]; port = Number(parts[1]); }
    }
  } catch { /* ignore */ }
  if (line.includes('/')) {
    // CIDR — простая обработка /24..: возьмём базовый IP (демо)
    const [base] = line.split('/');
    host = base;
  }
  host = host.replace(/\/.*$/, '').trim();
  if (!host) return null;
  return { host, port };
}

export function expandTargets(lines) {
  const out = [];
  for (const l of lines) {
    const t = parseTarget(l);
    if (t) out.push(t);
  }
  return out;
}

// Строгая проверка self-signed: у самоподписанного серт и есть свой издатель
// (отпечатки совпадают). Фолбэк — равенство subject и issuer.
export function isSelfSigned(cert) {
  try {
    if (cert?.fingerprint && cert?.issuerCertificate?.fingerprint) {
      return cert.fingerprint === cert.issuerCertificate.fingerprint;
    }
    if (cert?.subject && cert?.issuer) {
      return JSON.stringify(cert.subject) === JSON.stringify(cert.issuer);
    }
    return false;
  } catch {
    return false;
  }
}

export function dnsMatches(host, cn, san) {  if (!host) return true;
  const names = [...(cn ? [cn] : []), ...(san || [])];
  if (!names.length) return false;
  const h = host.toLowerCase();
  return names.some((n) => {
    n = String(n).toLowerCase();
    if (n === h) return true;
    if (n.startsWith('*.')) {
      const suffix = n.slice(2);
      return h === suffix || h.endsWith('.' + suffix);
    }
    return false;
  });
}

export function scanTls(host, port = 443, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      try {
        const cert = socket.getPeerCertificate(true);
        const chainValid = socket.authorized;
        const chainError = socket.authorized ? null : (socket.authorizationError || 'цепочка не проверена');
        // Параметры соединения: версия TLS и шифр — для контроля слабой криптографии
        const tlsVersion = typeof socket.getProtocol === 'function' ? (socket.getProtocol() || null) : null;
        let cipher = null;
        try {
          const c = typeof socket.getCipher === 'function' ? socket.getCipher() : null;
          cipher = c?.name || null;
        } catch {}
        socket.end();
        if (!cert || !Object.keys(cert).length) return resolve({ ok: false, host, port, error: 'no certificate' });
        const validTo = new Date(cert.valid_to);
        const validFrom = new Date(cert.valid_from);
        const daysLeft = Math.floor((validTo - Date.now()) / 86400000);
        const sanRaw = cert.subjectaltname || '';
        const san = sanRaw.split(',')
          .map((s) => s.trim().replace(/^(dns|ip address|uri|email|othername)\s*:\s*/i, '').trim())
          .filter(Boolean);
        const cn = cert.subject?.CN || '';
        const issuer = cert.issuer?.CN || cert.issuer?.O || Object.values(cert.issuer || {})[0] || 'Unknown';
        const fingerprint = cert.fingerprint || '';
        // Алгоритм подписи — через X509 (в getPeerCertificate его нет)
        let sigAlgo = null, keyType = null, keyBits = cert.bits || cert.publicKey?.asymmetricKeySize || null;
        try {
          if (cert.raw) {
            sigAlgo = sigAlgoFromRaw(cert.raw);
            try {
              const x = new X509Certificate(cert.raw);
              keyType = x.publicKey?.asymmetricKeyType || null;
              if (!keyBits) keyBits = x.publicKey?.asymmetricKeySize || null;
            } catch {}
          }
        } catch {}
        const keyAlgo = cert.asn1Curve || keyType || cert.publicKey?.asymmetricKeyType || cert.ptype || '';
        const crypto = evaluateCrypto({ keyAlgo, keyBits, sigAlgo, tlsVersion, cipher });
        resolve({
          ok: true, host, port, cn, san, issuer,
          thumbprint: fingerprint, validFrom: validFrom.toISOString(), validTo: validTo.toISOString(),
          daysLeft, chainValid, chainError, selfSigned: isSelfSigned(cert),
          dnsMatch: dnsMatches(host, cn, san),
          keyAlgo: typeof keyAlgo === 'string' ? keyAlgo : 'RSA',
          keySize: keyBits,
          tlsVersion, cipher, sigAlgo,
          weakCrypto: crypto.weak, weakCryptoReasons: crypto.reasons,
          rawCn: cn
        });
      } catch (e) {
        try { socket.destroy(); } catch {}
        resolve({ ok: false, host, port, error: String(e?.message || e) });
      }
    });
    socket.setTimeout(timeoutMs, () => { try { socket.destroy(); } catch {} resolve({ ok: false, host, port, error: 'timeout' }); });
    socket.on('error', (e) => resolve({ ok: false, host, port, error: String(e?.message || e) }));
  });
}

// Разбор загруженного файла сертификата (PEM или DER) через X509
export function parseCertFile(buf) {
  let x;
  try {
    x = new X509Certificate(buf);
  } catch {
    throw new Error('не похож на сертификат (нужен .pem/.crt/.cer/.der)');
  }
  const dn = (s) => {
    const out = {};
    String(s || '').split('\n').forEach((line) => {
      const i = line.indexOf('=');
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    return out;
  };
  const subj = dn(x.subject);
  const iss = dn(x.issuer);
  const san = String(x.subjectAltName || '').split(',')
    .map((s) => s.trim().replace(/^(dns|ip address|uri|email|othername)\s*:\s*/i, '').trim())
    .filter(Boolean);
  const fp = x.fingerprint || '';
  const ki = keyInfoFromDER(buf);
  const pkType = x.publicKey?.asymmetricKeyType || '';
  const algo = pkType === 'rsa' ? 'RSA' : pkType === 'ec' ? 'ECDSA' : (ki.algo || pkType || '');
  return {
    cn: subj.CN || '',
    san,
    issuer: iss.CN || iss.O || Object.values(iss)[0] || 'Unknown',
    thumbprint: fp,
    validFrom: x.validFrom, validTo: x.validTo,
    selfSigned: (() => { try { return !!x.subject && x.subject === x.issuer; } catch { return false; } })(),
    sigAlgo: sigAlgoFromRaw(buf),
    keyAlgo: algo,
    keySize: x.publicKey?.asymmetricKeySize || ki.bits || null
  };
}

// limit concurrency
export async function scanMany(targets, { port = 443, timeoutMs = 6000, concurrency = 20, onProgress } = {}) {
  const results = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while (idx < targets.length) {
      const t = targets[idx++];
      const p = t.port || port;
      const r = await scanTls(t.host, p, timeoutMs);
      results.push(r);
      onProgress?.(results.length, targets.length);
      // простой rate-limit
      await new Promise((res) => setTimeout(res, 10));
    }
  });
  await Promise.all(workers);
  return results;
}
