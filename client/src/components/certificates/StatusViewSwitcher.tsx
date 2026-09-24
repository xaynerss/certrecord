import { Box, AlignLeft, BarChart3 } from 'lucide-react';

export type StatusView = 'tiles' | 'bar' | 'table';

export default function StatusViewSwitcher({ view, setView }: { view: StatusView; setView: (v: StatusView) => void }) {
  const btn = (v: StatusView, icon: any, label: string) => (
    <button
      key={v}
      onClick={() => setView(v)}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-full font-bold text-[16px] transition ${
        view === v ? 'text-white' : 'text-white/80 hover:text-white'
      }`}
      style={view === v ? { background: '#206EF4' } : {}}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="card inline-flex items-center gap-1 p-1.5 !rounded-full">
      {btn('tiles', <Box size={22} />, 'Плитка')}
      {btn('bar', <AlignLeft size={22} />, 'Полоса')}
      {btn('table', <BarChart3 size={22} />, 'Таблица')}
    </div>
  );
}
