import { LayoutDashboard, FileText, Radar, Bell, Plus, Settings } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import api from '../../lib/api';
import ThemeToggle from '../ui/ThemeToggle';
import LogoIcon from '../ui/LogoIcon';

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-2 select-none">
      <LogoIcon />
      <span className="text-[22px] font-extrabold tracking-tight">
        <span className="text-white">cert</span>
        <span style={{ color: '#206EF4' }}>record</span>
      </span>
    </div>
  );
}

const items = [
  { to: '/', label: 'Дашборд', icon: LayoutDashboard },
  { to: '/certificates', label: 'Сертификаты', icon: FileText },
  { to: '/scanning', label: 'Сканирование', icon: Radar },
  { to: '/notifications', label: 'Уведомления', icon: Bell },
  { to: '/create', label: 'Создать', icon: Plus },
  { to: '/settings', label: 'Настройки', icon: Settings }
];

export default function Sidebar() {
  const nav = useNavigate();
  const [user, setUser] = useState<any>(null);
  useEffect(() => {
    api.get('/auth/me').then((r) => setUser(r.data)).catch(() => {});
  }, []);
  return (
    <>
      {/* Десктоп: фиксированный сайдбар */}
      <aside className="card hidden md:flex flex-col w-[248px] p-5 fixed left-4 top-4 bottom-4 z-40 overflow-y-auto">
        <Logo />
        <nav className="mt-6 flex flex-col gap-1.5">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl text-[16px] font-semibold transition ${
                  isActive ? 'bg-white/10 text-white' : 'text-white/85 hover:bg-white/5'
                }`
              }
            >
              <it.icon size={22} strokeWidth={2} />
              {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex gap-2 items-center">
          <button
            onClick={() => { localStorage.removeItem('certrecord_token'); nav('/login'); }}
            title="Выйти"
            className="flex-1 min-w-0 text-left px-5 py-3 rounded-full bg-white/10 text-white/85 font-semibold text-[14px] hover:bg-white/15 truncate"
          >
            {user?.name ? `${user.name}` : 'Name Surname'}
          </button>
          <ThemeToggle />
        </div>
      </aside>

      {/* Телефон: верхняя шапка с горизонтальным меню */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 px-3 pt-3">
        <div className="card !rounded-2xl px-4 py-3 flex items-center gap-3">
          <LogoIcon width={24} height={26} />
          <span className="text-[18px] font-extrabold tracking-tight shrink-0">
            <span className="text-white">cert</span>
            <span style={{ color: '#206EF4' }}>record</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle className="!w-9 !h-9" />
            <button
              onClick={() => { localStorage.removeItem('certrecord_token'); nav('/login'); }}
              title="Выйти"
              className="max-w-[130px] px-4 py-2 rounded-full bg-white/10 text-white/85 font-semibold text-[12.5px] truncate"
            >
              {user?.name ? `${user.name}` : 'Выйти'}
            </button>
          </div>
        </div>
        <nav className="card !rounded-2xl mt-2 px-2 py-2 flex gap-1 overflow-x-auto">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[13px] font-semibold whitespace-nowrap transition ${
                  isActive ? 'bg-white/10 text-white' : 'text-white/70'
                }`
              }
            >
              <it.icon size={17} strokeWidth={2} />
              {it.label}
            </NavLink>
          ))}
        </nav>
      </header>
    </>
  );
}
