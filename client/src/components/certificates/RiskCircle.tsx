import { riskColor } from '../../lib/types';

export default function RiskCircle({ score, size = 58 }: { score: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (Math.min(100, Math.max(0, score)) / 100) * c;
  const color = riskColor(score);
  return (
    <div className="inline-flex items-center justify-center" style={{ width: size, height: size }} title={`Risk Score ${score}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--ring-track)" strokeWidth="5" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="5" fill="none"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <div className="absolute text-center leading-none">
        <div className="font-extrabold" style={{ fontSize: size * 0.26 }}>{score}</div>
        <div className="text-white/50 font-semibold" style={{ fontSize: size * 0.16 }}>/100</div>
      </div>
    </div>
  );
}
