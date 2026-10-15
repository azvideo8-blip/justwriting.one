import { useLanguage } from '../../shared/i18n';
import { Button } from './Button';
import { ModalShell } from './ModalShell';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// MQ-15 (N-13): через ModalShell — портал в body (под BottomNav окно не попадает), blur-sm на телефоне,
// 220 мс ease-out; раньше был свой оверлей с размытием 40 px и без портала.
export function ConfirmModal({ isOpen, title, message, confirmLabel, cancelLabel, onConfirm, onCancel }: ConfirmModalProps) {
  const { t } = useLanguage();

  return (
    <ModalShell
      open={isOpen}
      onClose={onCancel}
      labelId="confirm-modal-title"
      className="max-w-[384px] rounded-2xl p-6 bg-surface-card border border-border-subtle text-text-main"
    >
      <div id="confirm-modal-title" className="text-lg font-bold mb-2">{title}</div>
      <p className="text-sm text-text-main/60 mb-6">{message}</p>
      <div className="flex gap-3">
        <Button type="button" onClick={onCancel} className="flex-1 px-4 py-3 text-sm font-bold rounded-xl border border-border-subtle text-text-main hover:bg-white/5">
          {cancelLabel || t('common_cancel')}
        </Button>
        <Button type="button" onClick={onConfirm} className="flex-1 px-4 py-3 text-sm font-bold rounded-xl bg-accent-danger text-white hover:bg-accent-danger/90">
          {confirmLabel || t('finish_discard')}
        </Button>
      </div>
    </ModalShell>
  );
}
