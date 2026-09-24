import { Check } from 'lucide-react';

export default function Checkbox({
  checked, onChange, label, hint
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-start gap-3 text-left w-full group"
    >
      <span
        className="mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition border"
        style={
          checked
            ? { background: '#206EF4', borderColor: '#206EF4' }
            : { background: 'var(--check-bg)', borderColor: 'var(--check-border)' }
        }
      >
        {checked && <Check size={14} strokeWidth={3.5} className="text-white" />}
      </span>
      <span className="text-[14px]">
        <span className="font-semibold">{label}</span>
        {hint && <span className="block text-white/40 text-[12px] font-normal">{hint}</span>}
      </span>
    </button>
  );
}
