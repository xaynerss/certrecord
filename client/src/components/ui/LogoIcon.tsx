import { useEffect, useState } from 'react';

// Иконка логотипа под тему: на тёмной — белая, на светлой — чёрная (оригинал)
export default function LogoIcon({ width = 30, height = 32, className = '' }: { width?: number; height?: number; className?: string }) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark');
  useEffect(() => {
    const h = () => setTheme(document.documentElement.dataset.theme || 'dark');
    window.addEventListener('certrecord-theme', h);
    return () => window.removeEventListener('certrecord-theme', h);
  }, []);
  return (
    <img
      src={theme === 'light' ? '/logo-icon-dark.svg' : '/logo-icon.svg'}
      alt="CertRecord"
      width={width}
      height={height}
      className={`shrink-0 ${className}`}
    />
  );
}
