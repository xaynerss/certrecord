import { useEffect, useState } from 'react';
import api from '../lib/api';

export default function SettingsPage() {
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { api.get('/settings').then((r) => setS(r.data)).catch(() => {}); }, []);
  if (!s) return <div className="text-white/40">Загрузка…</div>;

  const save = async () => {
    await api.patch('/settings', { thresholds: s.thresholds, riskWeights: s.riskWeights, scheduler: s.scheduler });
    setMsg('Сохранено, статусы и оценка риска пересчитаны');
    setTimeout(() => setMsg(''), 2500);
  };

  const pct = (obj: any, set: any, key: string, label: string) => (
    <label>{label}
      <span className="relative block mt-1">
        <input type="number" min={0} max={100} className="input !pr-9" value={Math.round((obj[key] ?? 0) * 100)}
          onChange={(e) => {
            const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
            set({ ...obj, [key]: v / 100 });
          }} />
        <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/40 text-[13px] font-bold">%</span>
      </span>
    </label>
  );

  const weightSum = Math.round(Object.values(s.riskWeights || {}).reduce((a: number, b: any) => a + Number(b || 0), 0) * 100);

  const normalizeWeights = () => {
    const w = s.riskWeights || {};
    const sum = Object.values(w).reduce((a: number, b: any) => a + Number(b || 0), 0) || 1;
    const n: any = {};
    for (const k of Object.keys(w)) n[k] = Math.round((Number(w[k] || 0) / sum) * 100) / 100;
    setS({ ...s, riskWeights: n });
  };

  return (
    <div className="max-w-[900px] anim-page">
      <h1 className="text-[38px] font-extrabold">Настройки</h1>
      <div className="grid md:grid-cols-2 gap-4 mt-5">
        <div className="card p-6">
          <div className="font-bold mb-3">Пороги статусов (дней)</div>
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <label>Информация, до<input type="number" className="input mt-1" value={s.thresholds?.info ?? 60} onChange={(e) => setS({ ...s, thresholds: { ...s.thresholds, info: Number(e.target.value) } })} /></label>
            <label>Предупреждение, до<input type="number" className="input mt-1" value={s.thresholds?.warning ?? 30} onChange={(e) => setS({ ...s, thresholds: { ...s.thresholds, warning: Number(e.target.value) } })} /></label>
            <label>Критично, до<input type="number" className="input mt-1" value={s.thresholds?.critical ?? 14} onChange={(e) => setS({ ...s, thresholds: { ...s.thresholds, critical: Number(e.target.value) } })} /></label>
            <label>В норме, больше<input type="number" className="input mt-1" value={s.thresholds?.ok ?? 60} onChange={(e) => setS({ ...s, thresholds: { ...s.thresholds, ok: Number(e.target.value) } })} /></label>
          </div>
          <p className="text-white/35 text-[12px] mt-3">По ТЗ Certificate Radar: больше 60 — в норме · 31–60 — информация · 15–30 — предупреждение · 0–14 — критично · меньше 0 — истёк.</p>
        </div>
        <div className="card p-6">
          <div className="font-bold mb-1">Веса оценки риска</div>
          <div className={`text-[12.5px] font-semibold mb-3 ${weightSum === 100 ? 'text-emerald-400' : 'text-amber-400'}`}>
            Сумма: {weightSum}% {weightSum !== 100 && <button className="underline ml-1" onClick={normalizeWeights}>выровнять до 100%</button>}
          </div>
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            {pct(s.riskWeights, (v: any) => setS({ ...s, riskWeights: v }), 'daysLeft', 'Дни до истечения')}
            {pct(s.riskWeights, (v: any) => setS({ ...s, riskWeights: v }), 'criticality', 'Критичность сервиса')}
            {pct(s.riskWeights, (v: any) => setS({ ...s, riskWeights: v }), 'chain', 'Цепочка доверия')}
            {pct(s.riskWeights, (v: any) => setS({ ...s, riskWeights: v }), 'owner', 'Наличие владельца')}
          </div>
        </div>
      </div>
      <div className="card p-6 mt-4">
        <div className="font-bold mb-1">Сканер</div>
        <p className="text-white/40 text-[12.5px] mb-3">Сервер сам пересканирует все сертификаты каждые 5 минут. Здесь задаётся только порт по умолчанию.</p>
        <div className="text-[13px] max-w-[220px]">
          <label>Порт<input type="number" className="input mt-1" value={s.scheduler?.defaultPort ?? 443} onChange={(e) => setS({ ...s, scheduler: { ...s.scheduler, defaultPort: Number(e.target.value) } })} /></label>
        </div>
        <button className="btn-primary mt-5" onClick={save}>Сохранить</button>
        {msg && <span className="text-[13px] text-emerald-400 ml-3">{msg}</span>}
      </div>
      <p className="text-white/30 text-[12px] mt-4">Режим только чтение по умолчанию · пароли хранятся только в виде хеша · секреты почты и Telegram — только в файле server/.env · действия пишутся в журнал.</p>
    </div>
  );
}
