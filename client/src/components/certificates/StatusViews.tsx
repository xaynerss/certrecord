import type { Stats } from '../../lib/types';

function Tile({ title, value, border }: { title: string; value: number; border: string }) {
  return (
    <div className="card card-hover p-5 min-w-[150px] flex-1" style={{ border: `1.5px solid ${border}` }}>
      <div className="text-white/50 font-bold text-[13px] tracking-wide uppercase">{title}</div>
      <div className="text-[34px] font-extrabold mt-1 leading-none">{value}</div>
    </div>
  );
}

export function StatusTiles({ stats }: { stats: Stats }) {
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Tile title="Всего" value={stats.TOTAL} border="rgba(255,255,255,0.08)" />
        <Tile title="В норме" value={stats.OK} border="#22C55E" />
        <Tile title="Предупреждение" value={stats.WARNING + stats.INFO} border="#EAB308" />
        <Tile title="Критические" value={stats.CRITICAL} border="#EF4444" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
        <Tile title="Истекшие" value={stats.EXPIRED} border="rgba(255,255,255,0.08)" />
        <Tile title="Без владельца" value={stats.NOOWNER} border="rgba(255,255,255,0.08)" />
      </div>
    </div>
  );
}

// ---- Полоса: горизонтальная диаграмма с % и количеством (минимализм) ----
export function StatusBar({ stats }: { stats: Stats }) {
  const total = Math.max(1, stats.TOTAL);
  const segs = [
    { label: 'В норме', value: stats.OK, color: '#22C55E' },
    { label: 'Информация', value: stats.INFO, color: '#3B82F6' },
    { label: 'Предупреждение', value: stats.WARNING, color: '#EAB308' },
    { label: 'Критично', value: stats.CRITICAL, color: '#EF4444' },
    { label: 'Истёк', value: stats.EXPIRED, color: '#6B7280' }
  ];
  return (
    <div className="card p-6">
      <div className="flex h-[26px] rounded-full overflow-hidden bg-white/5">
        {segs.map((s) =>
          s.value > 0 ? (
            <div key={s.label} title={`${s.label}: ${s.value}`} style={{ width: `${(s.value / total) * 100}%`, background: s.color, minWidth: s.value ? 8 : 0 }} />
          ) : null
        )}
      </div>
      <div className="mt-5 flex flex-col gap-3">
        {segs.map((s) => (
          <div key={s.label} className="flex items-center gap-3 text-[14px]">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-white/70 w-32">{s.label}</span>
            <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
            </div>
            <span className="font-bold w-8 text-right">{s.value}</span>
            <span className="text-white/40 w-12 text-right">{Math.round((s.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Таблица: Статус | Количество | Доля ----
export function StatusTableView({ stats }: { stats: Stats }) {
  const total = Math.max(1, stats.TOTAL);
  const rows = [
    { label: 'В норме', value: stats.OK, color: '#22C55E' },
    { label: 'Информация', value: stats.INFO, color: '#3B82F6' },
    { label: 'Предупреждение', value: stats.WARNING, color: '#EAB308' },
    { label: 'Критично', value: stats.CRITICAL, color: '#EF4444' },
    { label: 'Истёк', value: stats.EXPIRED, color: '#6B7280' },
    { label: 'Без владельца', value: stats.NOOWNER, color: '#A1A1AA' }
  ];
  return (
    <div className="card overflow-hidden">
      <table className="w-full">
        <thead className="table-head"><tr><th>Статус</th><th className="col-sep">Количество</th><th className="col-sep">Доля</th></tr></thead>
        <tbody className="table-body">
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-white/5 last:border-0">
              <td><span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: r.color }} />{r.label}</span></td>
              <td className="col-sep font-bold">{r.value}</td>
              <td className="col-sep text-white/60">{Math.round((r.value / total) * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
