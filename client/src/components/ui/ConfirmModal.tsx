import { AlertTriangle } from 'lucide-react';

export default function ConfirmModal({
  open, title, text, confirmLabel = 'Удалить', onConfirm, onCancel, busy
}: {
  open: boolean;
  title: string;
  text: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 anim-fade modal-backdrop"
      onClick={onCancel}
    >
      <div className="card w-full max-w-[420px] p-7 anim-pop" onClick={(e) => e.stopPropagation()}>
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(239,68,68,.15)' }}>
          <AlertTriangle size={22} className="text-[#EF4444]" />
        </div>
        <h2 className="text-[19px] font-bold mt-4">{title}</h2>
        <p className="text-white/55 text-[13.5px] mt-1.5">{text}</p>
        <div className="flex gap-3 mt-6">
          <button
            className="flex-1 rounded-full py-2.5 font-bold text-[14px] text-white disabled:opacity-50"
            style={{ background: '#EF4444' }}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Удаление…' : confirmLabel}
          </button>
          <button className="btn-ghost flex-1 justify-center" onClick={onCancel}>Отмена</button>
        </div>
      </div>
    </div>
  );
}
