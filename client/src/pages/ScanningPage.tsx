import { useEffect, useState } from 'react';
import { Play, Upload } from 'lucide-react';
import api from '../lib/api';
import ScanJobModal from '../components/scanning/ScanJobModal';

const JOB_STATUS_RU: Record<string, { label: string; bg: string }> = {
  RUNNING: { label: 'Выполняется', bg: 'rgba(59,130,246,.9)' },
  DONE: { label: 'Готов', bg: 'rgba(34,197,94,.9)' },
  FAILED: { label: 'Ошибка', bg: 'rgba(239,68,68,.9)' },
  PENDING: { label: 'Ожидает', bg: 'rgba(107,114,128,.9)' }
};

export default function ScanningPage() {
  const [targets, setTargets] = useState('google.com\ngithub.com\ncloudflare.com');
  const [port, setPort] = useState(443);
  const [job, setJob] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedJob, setSelectedJob] = useState<any>(null);

  const loadHist = () => api.get('/scanning/history/list').then((r) => setHistory(r.data)).catch(() => {});
  useEffect(() => { loadHist(); }, []);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const list = targets.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
      const r = await api.post('/scanning/start', { targets: list, port });
      const jobId = r.data.jobId;
      const poll = setInterval(async () => {
        try {
          const j = await api.get(`/scanning/${jobId}`);
          setJob(j.data);
          if (j.data.status === 'DONE' || j.data.status === 'FAILED') { clearInterval(poll); setBusy(false); loadHist(); }
        } catch { clearInterval(poll); setBusy(false); }
      }, 1200);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Не удалось запустить сканирование');
      setBusy(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const text = await f.text();
    setTargets(text);
  };

  const pct = job ? Math.round(((job.processed || 0) / Math.max(1, job.total)) * 100) : 0;

  return (
    <div className="max-w-[900px] anim-page">
      <h1 className="text-[38px] font-extrabold">Сканирование</h1>
      <p className="text-white/50 mt-1 text-[14px]">DNS-имена, IP, URL или host:port — по одному на строку. Реальное TLS-подключение к 443 порту.</p>

      <div className="card mt-5 p-6">
        <label className="font-bold text-[14px]">Цели</label>
        <textarea className="input mt-2 h-36 font-mono text-[13.5px]" value={targets} onChange={(e) => setTargets(e.target.value)} placeholder={'api.company.kz\nvpn.company.kz:443\nhttps://portal.company.kz'} />
        <div className="flex gap-3 mt-4 flex-wrap items-center">
          <label className="btn-ghost cursor-pointer !py-2.5 text-[14px]">
            <Upload size={17} /> TXT/CSV
            <input type="file" accept=".txt,.csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <div className="flex items-center gap-2 text-[14px]">
            <span className="text-white/50">Порт</span>
            <input type="number" className="input !w-24" value={port} onChange={(e) => setPort(Number(e.target.value))} />
          </div>
          <button className="btn-primary disabled:opacity-50" disabled={busy} onClick={start}><Play size={18} /> {busy ? 'Сканирование…' : 'Запустить сканирование'}</button>
        </div>
        {error && <div className="mt-4 px-4 py-3 rounded-xl text-[13.5px] font-semibold text-[#ff9d9d]" style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.35)' }}>{error}</div>}
        {job && (
          <div className="mt-5">
            <div className="flex justify-between text-[13px] text-white/60 mb-2"><span>{(JOB_STATUS_RU[job.status] || JOB_STATUS_RU.PENDING).label} — {job.processed}/{job.total}</span><span>{pct}%</span></div>
            <div className="h-2.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: '#206EF4' }} /></div>
          </div>
        )}
      </div>

      <h2 className="font-bold text-[18px] mt-8 mb-3">История</h2>
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="table-head"><tr><th>ID</th><th className="col-sep">Целей</th><th className="col-sep">Статус</th><th className="col-sep">Создан</th></tr></thead>
          <tbody className="table-body">
            {history.map((h) => {
              const st = JOB_STATUS_RU[h.status] || JOB_STATUS_RU.PENDING;
              return (
                <tr key={h.id} className="cursor-pointer" onClick={() => setSelectedJob(h)}>
                  <td className="font-mono text-[12px]">{h.id.slice(0, 18)}…</td>
                  <td className="col-sep">{h.total}</td>
                  <td className="col-sep"><span className="badge" style={{ background: st.bg }}>{st.label}</span></td>
                  <td className="col-sep text-white/50">{new Date(h.createdAt).toLocaleString('ru-RU')}</td>
                </tr>
              );
            })}
            {!history.length && <tr><td colSpan={4} className="p-5 text-white/40">Пока пусто</td></tr>}
          </tbody>
        </table>
      </div>
      <ScanJobModal job={selectedJob} onClose={() => setSelectedJob(null)} />
    </div>
  );
}
