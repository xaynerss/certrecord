import { useState } from 'react';
import { Plus, Download, KeyRound, FileCheck2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import Checkbox from '../components/ui/Checkbox';

interface GenResult {
  host: string; port: number; cn: string; san: string[];
  issuer: string; thumbprint: string;
  validFrom: string; validTo: string; daysLeft: number;
  chainValid: boolean; chainError: string | null;
  dnsMatch: boolean; selfSigned: boolean;
  keyAlgo: string; keySize: number;
  sigAlgo: string; weakCrypto: boolean; weakCryptoReasons: string[];
  certPem: string; privateKeyPem: string;
}

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-pem-file' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function CreatePage() {
  const nav = useNavigate();
  const [host, setHost] = useState('');
  const [san, setSan] = useState('');
  const [days, setDays] = useState(365);
  const [keySize, setKeySize] = useState(2048);
  const [org, setOrg] = useState('');
  const [owner, setOwner] = useState('');
  const [critical, setCritical] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [gen, setGen] = useState<GenResult | null>(null);

  const generate = async () => {
    setErr(''); setMsg(''); setGen(null);
    if (!host.trim()) { setErr('Укажи CN (DNS-имя)'); return; }
    setBusy(true);
    try {
      const r = await api.post('/certificates/generate', {
        host: host.trim(), san, days: Number(days) || 365, keySize, org: org.trim() || undefined
      });
      setGen(r.data);
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Не удалось сгенерировать');
    } finally { setBusy(false); }
  };

  const addToInventory = async () => {
    if (!gen) return;
    setSaving(true);
    try {
      await api.post('/certificates', {
        host: gen.host, port: gen.port, cn: gen.cn, san: gen.san,
        issuer: gen.issuer, thumbprint: gen.thumbprint,
        validFrom: gen.validFrom, validTo: gen.validTo,
        chainValid: gen.chainValid, chainError: gen.chainError,
        dnsMatch: gen.dnsMatch, selfSigned: gen.selfSigned,
        keyAlgo: gen.keyAlgo, keySize: gen.keySize, sigAlgo: gen.sigAlgo,
        weakCrypto: gen.weakCrypto, weakCryptoReasons: gen.weakCryptoReasons,
        owner: owner.trim() || undefined, critical, source: 'generated'
      });
      setMsg('Добавлено в инвентарь');
      setTimeout(() => nav('/certificates'), 900);
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Не удалось добавить');
    } finally { setSaving(false); }
  };

  return (
    <div className="max-w-[900px] anim-page">
      <h1 className="text-[38px] font-extrabold">Создать сертификат</h1>
      <p className="text-white/50 mt-1 text-[14px]">Самоподписанный сертификат для тестов и внутренних сервисов. Потом — добавь в инвентарь или скачай .crt.</p>

      <div className="card mt-5 p-6">
        <div className="grid md:grid-cols-2 gap-3 text-[13px]">
          <label className="md:col-span-2">CN (DNS-имя) *
            <input className="input mt-1 font-mono" placeholder="test.company.kz" value={host} onChange={(e) => setHost(e.target.value)} />
          </label>
          <label className="md:col-span-2">SAN (дополнительно, через запятую/пробел)
            <input className="input mt-1 font-mono" placeholder="www.test.company.kz" value={san} onChange={(e) => setSan(e.target.value)} />
          </label>
          <label>Срок, дней<input type="number" min={1} max={825} className="input mt-1" value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
          <label>Ключ
            <select className="input mt-1 cursor-pointer" value={keySize} onChange={(e) => setKeySize(Number(e.target.value))}>
              <option value={2048}>RSA 2048</option>
              <option value={4096}>RSA 4096</option>
            </select>
          </label>
          <label>Организация<input className="input mt-1" placeholder="Company" value={org} onChange={(e) => setOrg(e.target.value)} /></label>
          <label>Владелец<input className="input mt-1" placeholder="Имя ответственного" value={owner} onChange={(e) => setOwner(e.target.value)} /></label>
        </div>
        <div className="mt-3"><Checkbox checked={critical} onChange={setCritical} label="Критичный сервис" /></div>
        {err && <div className="mt-4 px-4 py-3 rounded-xl text-[13px] font-semibold text-[#ff9d9d]" style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.35)' }}>{err}</div>}
        <button className="btn-primary mt-5 disabled:opacity-50" disabled={busy} onClick={generate}>
          <KeyRound size={17} /> {busy ? 'Генерирую…' : 'Сгенерировать'}
        </button>
      </div>

      {gen && (
        <div className="card mt-4 p-6 anim-pop">
          <div className="flex items-center gap-2.5">
            <FileCheck2 size={20} style={{ color: '#22C55E' }} />
            <h2 className="font-bold text-[17px]">Готово: {gen.cn}</h2>
            <span className="badge ml-auto" style={{ background: 'rgba(239,68,68,.9)' }}>self-signed</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-[13px]">
            <div className="card !bg-white/[.04] p-3"><div className="text-white/40 text-[11px] font-bold uppercase">Действует</div><div className="font-semibold font-mono mt-0.5">{gen.daysLeft} дн.</div></div>
            <div className="card !bg-white/[.04] p-3"><div className="text-white/40 text-[11px] font-bold uppercase">Ключ</div><div className="font-semibold font-mono mt-0.5">RSA {gen.keySize}</div></div>
            <div className="card !bg-white/[.04] p-3"><div className="text-white/40 text-[11px] font-bold uppercase">Подпись</div><div className="font-semibold font-mono mt-0.5">{gen.sigAlgo}</div></div>
            <div className="card !bg-white/[.04] p-3"><div className="text-white/40 text-[11px] font-bold uppercase">Отпечаток</div><div className="font-semibold font-mono mt-0.5 truncate" title={gen.thumbprint}>{gen.thumbprint.slice(0, 17)}…</div></div>
          </div>
          {msg && <div className="mt-4 text-emerald-400 text-[13.5px] font-semibold">{msg}</div>}
          <div className="flex gap-3 mt-5 flex-wrap">
            <button className="btn-primary" disabled={saving} onClick={addToInventory}><Plus size={17} /> {saving ? 'Добавляю…' : 'Добавить в инвентарь'}</button>
            <button className="btn-ghost" onClick={() => downloadText(`${gen.host}.crt`, gen.certPem)}><Download size={16} /> Скачать .crt</button>
            <button className="btn-ghost" onClick={() => downloadText(`${gen.host}.key`, gen.privateKeyPem)}><Download size={16} /> Скачать .key</button>
          </div>
          <p className="text-white/35 text-[12px] mt-3">Приватный ключ показывается один раз — скачай .key сразу, на сервере он не хранится.</p>
        </div>
      )}
    </div>
  );
}
