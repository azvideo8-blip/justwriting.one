import { motion } from 'motion/react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ isOpen, title, message, confirmLabel, cancelLabel, onConfirm, onCancel }: ConfirmModalProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-base/80 backdrop-blur-2xl">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-sm rounded-2xl p-6 bg-surface-card border border-border-subtle text-text-main"
      >
        <div className="text-lg font-bold mb-2">{title}</div>
        <p className="text-sm text-text-main/60 mb-6">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 px-4 py-3 text-sm font-bold rounded-xl border border-border-subtle text-text-main hover:bg-white/5">
            {cancelLabel || 'Cancel'}
          </button>
          <button onClick={onConfirm} className="flex-1 px-4 py-3 text-sm font-bold rounded-xl bg-red-500/80 text-white hover:bg-red-500">
            {confirmLabel || 'Delete'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
