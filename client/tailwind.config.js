/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0A0A0A',
        card: '#161616',
        card2: '#1E1E1E',
        accent: '#206EF4',
        border: 'rgba(255,255,255,0.08)',
        ok: '#22C55E',
        info: '#3B82F6',
        warn: '#EAB308',
        crit: '#EF4444',
        exp: '#6B7280'
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      borderRadius: { card: '16px' }
    }
  },
  plugins: []
};
