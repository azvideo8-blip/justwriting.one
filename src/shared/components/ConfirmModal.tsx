import { useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useLanguage } from '../../core/i18n';
import { useModalEscape } from '../hooks/useModalEscape';
import { useFocusTrap } from '../hooks/useFocusTrap';

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
  const { t } = useLanguage();
  const reducedMotion = useReducedMotion();
  const modalRef = useRef<HTMLDivElement>(null);

  useModalEscape(isOpen, onCancel);
  useFocusTrap(modalRef, isOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-base/80 backdrop-blur-2xl">
      <motion.div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        initial={reducedMotion ? {} : { scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-sm rounded-2xl p-6 bg-surface-card border border-border-subtle text-text-main"
      >
        <div id="confirm-modal-title" className="text-lg font-bold mb-2">{title}</div>
        <p className="text-sm text-text-main/60 mb-6">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 px-4 py-3 text-sm font-bold rounded-xl border border-border-subtle text-text-main hover:bg-white/5">
            {cancelLabel || t('common_cancel')}
          </button>
          <button onClick={onConfirm} className="flex-1 px-4 py-3 text-sm font-bold rounded-xl bg-red-500/80 text-white hover:bg-red-500">
            {confirmLabel || t('finish_discard')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
