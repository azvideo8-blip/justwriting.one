import React from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { useLanguage } from '../../shared/i18n';
import { ModalShell } from './ModalShell';
import { cn } from '../../shared/utils/cn';
import { Button } from './Button';
import { IconButton } from './IconButton';

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

  return (
    <ModalShell
      open={isOpen}
      onClose={onCancel}
      labelId="cancel-modal-title"
      className="max-w-[384px] rounded-3xl p-8 shadow-2xl space-y-6 text-center border bg-surface-card border-border-subtle"
    >
        <IconButton
          type="button"
          onClick={onCancel}
          className="absolute top-4 right-4 p-3 rounded-full text-text-main/60 hover:text-text-main hover:bg-text-main/10 transition-colors"
          label={t('common_close')}
          icon={<X size={20} />}
        />
        <div className={cn("w-16 h-16 rounded-full flex items-center justify-center mx-auto", v.bg, v.text)}>
          {v.icon}
        </div>
        <div className="space-y-2">
          <h3 id="cancel-modal-title" className="text-xl font-bold text-text-main">
            {title || t('writing_cancel_confirm')}
          </h3>
          <p className="text-sm text-text-muted">
            {description || t('writing_cancel_desc')}
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-3 rounded-xl font-bold transition-colors border border-border-subtle text-text-main hover:bg-text-main/5"
          >
            {cancelLabel || t('writing_back')}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            className={cn(
              "flex-1 px-4 py-3 rounded-xl font-bold transition-colors",
              variant === 'warning'
                ? 'bg-accent-warning/20 text-accent-warning hover:bg-accent-warning/30'
                : 'bg-accent-danger/20 text-accent-danger hover:bg-accent-danger/30'
            )}
          >
            {confirmLabel || t('finish_discard')}
          </Button>
        </div>
    </ModalShell>
  );
}
