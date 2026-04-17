import React from 'react';
import { motion } from 'motion/react';
import { X, AlertTriangle } from 'lucide-react';
import { useLanguage } from '../../../../core/i18n';
import { useModalEscape } from '../../../../shared/hooks/useModalEscape';
import { cn } from '../../../../core/utils/utils';

interface CancelConfirmModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
}

const variantConfig = {
  danger: { bg: 'bg-accent-danger/10', text: 'text-accent-danger', icon: <X size={32} /> },
  warning: { bg: 'bg-accent-warning/10', text: 'text-accent-warning', icon: <AlertTriangle size={32} /> },
};

export function CancelConfirmModal({
  isOpen,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = 'danger'
}: CancelConfirmModalProps) {
  const { t } = useLanguage();
  const v = variantConfig[variant];

  useModalEscape(isOpen, onCancel);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-surface-base/80 backdrop-blur-xl">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-sm rounded-3xl p-8 shadow-2xl space-y-6 text-center border bg-surface-card backdrop-blur-2xl border-border-subtle shadow-[0_0_40px_rgba(255,255,255,0.05)]"
      >
        <button 
          onClick={onCancel}
          className="absolute top-4 right-4 p-3 rounded-full text-text-main/50 hover:text-text-main hover:bg-text-main/10 transition-all"
          aria-label={t('common_close')}
        >
          <X size={20} />
        </button>
        <div className={cn("w-16 h-16 rounded-full flex items-center justify-center mx-auto", v.bg, v.text)}>
          {v.icon}
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-bold text-text-main">
            {title || t('writing_cancel_confirm')}
          </h3>
          <p className="text-sm text-text-muted">
            {description || t('writing_cancel_desc')}
          </p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={onCancel}
            className="flex-1 px-4 py-3 rounded-xl font-bold transition-all border border-border-subtle text-text-main hover:bg-white/5"
          >
            {cancelLabel || t('writing_back')}
          </button>
          <button 
            onClick={onConfirm}
            className="flex-1 px-4 py-3 rounded-xl font-bold transition-all bg-accent-danger/20 text-accent-danger hover:bg-accent-danger/30"
          >
            {confirmLabel || t('finish_discard')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
