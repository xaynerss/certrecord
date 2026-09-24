import { useEffect, useState } from 'react';
import { X, Check, AlertTriangle, Lock } from 'lucide-react';
import type { Cert } from '../../lib/types';
import { STATUS_META, PROBLEM_COLORS, fmtDate } from '../../lib/types';
import RiskCircle from './RiskCircle';
import api from '../../lib/api';

export default function CertificateDetailModal({ cert, onClose, onUpdated }: { cert: Cert | null; onClose: () => void; onUpdated?: (c: Cert) => void }) {
  const [ownerEdit, setOwnerEdit] = useState('');
  const [savingOwner, setSavingOwner] = useState(false);
  useEffect(() => { setOwnerEdit(cert?.owner || ''); }, [cert?.id]);
  if (!cert) return null;
  const meta = STATUS_META[cert.status] || STATUS_META.UNKNOWN;

  const saveOwner = async () => {
    if (!cert) return;
    setSavingOwner(true);
    try {
      const r = await api.patch(`/certificates/${cert.id}`, { owner: ownerEdit.trim() || null });
      onUpdated?.(r.data);
    } finally { setSavingOwner(false); }
  };

  const rows: [string, string][] = [
    ['CN', cert.cn || cert.host],
    ['SAN', (cert.san || []).join(', ') || '—'],
    ['Издатель', cert.issuer || '—'],
    ['Отпечаток', cert.thumbprint || '—'],
    ['Действует', `${fmtDate(cert.validFrom)} — ${fmtDate(cert.validTo)}`],
    ['Дней осталось', cert.daysLeft == null ? '—' : String(cert.daysLeft)],
    ['Цепочка', cert.chainValid ? 'валидна' : `ошибка${cert.chainError ? ' — ' + cert.chainError : ''}`],
    ['DNS-соответствие', cert.dnsMatch ? 'да' : 'нет'],
    ['Self-signed', cert.selfSigned ? 'да' : 'нет']
  ];
  const probs = cert.problems || [];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-6 overflow-auto anim-fade modal-backdrop" onClick={onClose}>
      <div className="card w-full max-w-[880px] p-7 mt-6 anim-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[22px] font-bold">{cert.host}:{cert.port}</h2>
          <button onClick={onClose} className="w-10 h-10 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center"><X size={22} /></button>
        </div>
        <div className="card !bg-white/[.07] mt-5 p-6">
          <h3 className="text-[20px] font-bold mb-4">Основное</h3>
          <div className="grid grid-cols-[150px_1fr] gap-y-2 gap-x-4 text-[16px]">
            {rows.slice(0, 5).map(([k, v]) => (
              <div key={k} className="contents">
                <span className="text-white/90 font-semibold">{k}</span>
                <span className="border-l-4 border-white/25 pl-4 font-semibold break-all">{v}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[150px_1fr] gap-y-2 gap-x-4 text-[16px] mt-2">
            {rows.slice(5).map(([k, v]) => (
              <div key={k} className="contents">
                <span className="text-white/90 font-semibold">{k}</span>
                <span className="border-l-4 border-white/25 pl-4 font-semibold">{v}</span>
              </div>
            ))}
            <div className="contents">
              <span className="text-white/90 font-semibold">Владелец</span>
              <span className="border-l-4 border-white/25 pl-4">
                <span className="flex gap-2 items-center">
                  <input className="input !py-2 !text-[14px]" placeholder="Не назначен — впишите имя"
                    value={ownerEdit} onChange={(e) => setOwnerEdit(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveOwner()} />
                  <button onClick={saveOwner} disabled={savingOwner || (ownerEdit.trim() || '') === (cert.owner || '')}
                    title="Сохранить владельца"
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-30"
                    style={{ background: '#206EF4' }}>
                    <Check size={18} strokeWidth={3} />
                  </button>
                </span>
                <span className="block text-white/35 text-[11.5px] mt-1.5 font-normal">Владелец не читается из сертификата — его назначает человек. После назначения причина риска «отсутствует владелец» снимется.</span>
              </span>
            </div>
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <div className="card !bg-white/[.07] p-6">
            <div className="font-bold text-[16px] mb-3 flex items-center gap-2">
              <AlertTriangle size={17} style={{ color: probs.length ? '#EAB308' : '#22C55E' }} />
              Выявленные проблемы ({probs.length})
            </div>
            {!probs.length && <div className="text-white/50 text-[13.5px]">Проблем нет — сертификат в порядке.</div>}
            <ul className="flex flex-col gap-2">
              {probs.map((p) => (
                <li key={p.code} className="flex items-start gap-2.5 text-[13px]">
                  <span className="badge !text-[11px] !py-1 !px-2.5 shrink-0" style={{ background: PROBLEM_COLORS[p.code] || 'rgba(107,114,128,.9)' }}>{p.label}</span>
                  <span className="text-white/60">{p.detail}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card !bg-white/[.07] p-6">
            <div className="font-bold text-[16px] mb-3 flex items-center gap-2">
              <Lock size={17} className="text-white/60" />
              Криптография
              <span className="badge !text-[11px] !py-1 !px-2.5 ml-auto" style={{ background: cert.weakCrypto ? 'rgba(168,85,247,.9)' : 'rgba(34,197,94,.9)' }}>
                {cert.weakCrypto ? 'Слабая' : 'Надёжная'}
              </span>
            </div>
            <div className="grid grid-cols-[110px_1fr] gap-y-1.5 text-[13.5px]">
              <span className="text-white/50">TLS</span><span className="font-semibold font-mono">{cert.tlsVersion || '—'}</span>
              <span className="text-white/50">Шифр</span><span className="font-semibold font-mono break-all">{cert.cipher || '—'}</span>
              <span className="text-white/50">Подпись</span><span className="font-semibold font-mono">{cert.sigAlgo || '—'}</span>
              <span className="text-white/50">Ключ</span><span className="font-semibold font-mono">{cert.keyAlgo && cert.keySize ? `${cert.keyAlgo} ${cert.keySize} бит` : '—'}</span>
            </div>
            {!!(cert.weakCryptoReasons || []).length && (
              <ul className="mt-2.5 text-[12.5px] text-white/65 list-disc ml-4 space-y-0.5">
                {cert.weakCryptoReasons!.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <div className="card !bg-white/[.07] p-6 flex items-center gap-5">
            <div className="relative"><RiskCircle score={cert.riskScore} size={84} /></div>
            <div>
              <div className="font-bold text-[16px]">Оценка риска</div>
              <span className="badge mt-2 inline-block" style={{ background: meta.bg }}>{meta.label}</span>
              <ul className="mt-3 text-[13px] text-white/70 list-disc ml-4">
                {(cert.riskReasons || []).map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          </div>
          <div className="card !bg-white/[.07] p-6">
            <div className="font-bold text-[16px] mb-2">Рекомендации</div>
            <ul className="text-[13.5px] text-white/75 list-disc ml-4 space-y-1">
              {(cert.recommendations || []).map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
