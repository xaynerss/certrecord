import { useEffect, useState } from 'react';
import { FileDown } from 'lucide-react';
import api from '../lib/api';
import { downloadExport } from '../lib/download';
import type { Cert, Stats } from '../lib/types';
import { STATUS_META, PROBLEM_COLORS, fmtDate } from '../lib/types';
import StatusViewSwitcher, { type StatusView } from '../components/certificates/StatusViewSwitcher';
import { StatusTiles, StatusBar, StatusTableView } from '../components/certificates/StatusViews';
import RiskCircle from '../components/certificates/RiskCircle';
import CertificateDetailModal from '../components/certificates/CertificateDetailModal';

export default function DashboardPage() {
  const [view, setView] = useState<StatusView>('tiles');
  const [stats, setStats] = useState<Stats | null>(null);
  const [attention, setAttention] = useState<Cert[]>([]);
  const [selected, setSelected] = useState<Cert | null>(null);

  const load = () => {
    api.get('/certificates/stats').then((r) => setStats(r.data)).catch(() => {});
    api.get('/certificates/attention').then((r) => setAttention(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const doExport = (kind: 'csv' | 'excel' | 'html') => { downloadExport(kind).catch(() => {}); };

  return (
    <div className="anim-page">
      <h1 className="text-[42px] font-extrabold tracking-tight">Дашборд</h1>
      <div className="mt-4"><StatusViewSwitcher view={view} setView={setView} /></div>
      <div className="mt-5 max-w-[900px]">
        {stats && view === 'tiles' && <StatusTiles stats={stats} />}
        {stats && view === 'bar' && <StatusBar stats={stats} />}
        {stats && view === 'table' && <StatusTableView stats={stats} />}
      </div>

      <h2 className="text-[22px] font-bold mt-10">Требуют внимания (ближайшие 30 дней)</h2>
      <div className="card mt-4 overflow-hidden max-w-[1100px]">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[880px]">
          <thead className="table-head"><tr>
            <th>Сервис</th><th className="col-sep">Издатель</th><th className="col-sep">Истечение</th>
            <th className="col-sep">Осталось дн.</th><th className="col-sep">Риск</th><th className="col-sep">Статус</th><th className="col-sep">Проблемы</th>
          </tr></thead>
          <tbody className="table-body">
            {attention.map((c) => {
              const m = STATUS_META[c.status] || STATUS_META.UNKNOWN;
              const probs = c.problems || [];
              return (
                <tr key={c.id} className="border-b border-white/5 last:border-0 hover:bg-white/[.03] cursor-pointer" onClick={() => setSelected(c)}>
                  <td className="font-semibold">{c.host}</td>
                  <td className="col-sep">{c.issuer}</td>
                  <td className="col-sep">{fmtDate(c.validTo)}</td>
                  <td className="col-sep font-bold">{c.daysLeft ?? '—'}</td>
                  <td className="col-sep"><div className="relative"><RiskCircle score={c.riskScore} size={52} /></div></td>
                  <td className="col-sep"><span className="badge" style={{ background: m.bg }}>{m.label}</span></td>
                  <td className="col-sep">
                    {!probs.length && <span className="text-white/30 text-[12.5px]">нет</span>}
                    <span className="flex flex-col gap-1 items-start">
                      {probs.slice(0, 2).map((p) => (
                        <span key={p.code} className="badge !text-[11px] !py-1 !px-2.5" style={{ background: PROBLEM_COLORS[p.code] || 'rgba(107,114,128,.9)' }} title={p.detail}>{p.label}</span>
                      ))}
                      {probs.length > 2 && <span className="text-white/40 text-[11.5px] font-bold">+{probs.length - 2}</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!attention.length && <tr><td colSpan={7} className="p-6 text-white/50">Нет сертификатов с истечением меньше 30 дней — всё спокойно</td></tr>}
          </tbody>
        </table>
        </div>
      </div>

      <div className="mt-5 flex gap-3 flex-wrap">
        <button className="btn-primary" onClick={() => doExport('csv')}><FileDown size={20} /> Экспорт CSV</button>
        <button className="btn-ghost" onClick={() => doExport('excel')}><FileDown size={19} /> Excel</button>
        <button className="btn-ghost" onClick={() => doExport('html')}><FileDown size={19} /> HTML</button>
      </div>
      <CertificateDetailModal cert={selected} onClose={() => setSelected(null)} onUpdated={(u) => { setSelected(u); load(); }} />
    </div>
  );
}
