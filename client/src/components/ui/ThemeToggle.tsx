import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

export function currentTheme(): 'dark' | 'light' {
  return localStorage.getItem('certrecord_theme') === 'light' ? 'light' : 'dark';
}

export function applyTheme(t: 'dark' | 'light') {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('certrecord_theme', t);
  window.dispatchEvent(new Event('certrecord-theme'));
}

// Тумблер темы, выбор сохраняется в localStorage
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    const t = currentTheme();
    setTheme(t);
    document.documentElement.dataset.theme = t;
  }, []);
  const toggle = () => {
    const t = theme === 'dark' ? 'light' : 'dark';
    setTheme(t);
    applyTheme(t);
  };
  return (
    <button
      onClick={toggle}
      title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
      className={`w-10 h-10 rounded-xl bg-white/10 hover:bg-white/15 text-white/85 flex items-center justify-center shrink-0 transition ${className}`}
    >
      {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
    </button>
  );
}
