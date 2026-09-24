import { X } from 'lucide-react';

const STATUS: Record<string, { label: string; bg: string }> = {
  RUNNING: { label: 'Выполняется', bg: 'rgba(59,130,246,.9)' },
  DONE: { label: 'Готов', bg: 'rgba(34,197,94,.9)' },
  FAILED: { label: 'Ошибка', bg: 'rgba(239,68,68,.9)' },
  PENDING: { label: 'Ожидает', bg: 'rgba(107,114,128,.9)' }
};

export default function ScanJobModal({ job, onClose }: { job: any | null; onClose: () => void }) {
  if (!job) return null;
  const st = STATUS[job.status] || STATUS.PENDING;
  const pct = Math.round(((job.processed || 0) / Math.max(1, job.total)) * 100);
  const targets: string[] = job.targets || [];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-6 overflow-auto anim-fade modal-backdrop" onClick={onClose}>
      <div className="card w-full max-w-[560px] p-7 mt-8 anim-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[18px] font-bold font-mono truncate" title={job.id}>
            {String(job.id).slice(0, 24)}…
          </h2>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center shrink-0"><X size={19} /></button>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <span className="badge" style={{ background: st.bg }}>{st.label}</span>
          <span className="text-white/50 text-[13px]">{job.processed || 0} из {job.total} · {pct}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-white/10 overflow-hidden mt-3">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: '#206EF4' }} />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-5 text-[13px]">
          <div className="card !bg-white/[.04] p-3.5">
            <div className="text-white/40 text-[11px] uppercase tracking-wider font-bold">Запущен</div>
            <div className="font-semibold mt-1">{job.createdAt ? new Date(job.createdAt).toLocaleString('ru-RU') : '—'}</div>
          </div>
          <div className="card !bg-white/[.04] p-3.5">
            <div className="text-white/40 text-[11px] uppercase tracking-wider font-bold">Завершён</div>
            <div className="font-semibold mt-1">{job.finishedAt ? new Date(job.finishedAt).toLocaleString('ru-RU') : '—'}</div>
          </div>
        </div>
        <div className="font-bold text-[14px] mt-5 mb-2">Цели ({targets.length})</div>
        <div className="card !bg-white/[.04] p-4 max-h-56 overflow-auto font-mono text-[12.5px] text-white/75 flex flex-col gap-1.5">
          {targets.map((t, i) => <div key={i} className="flex gap-2.5"><span className="text-white/30 w-6 shrink-0">{i + 1}.</span><span className="break-all">{t}</span></div>)}
          {!targets.length && <span className="text-white/35 font-sans">Список пуст</span>}
        </div>
      </div>
    </div>
  );
}
