import { AlertTriangle } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';
import { useDraftWriteAlertStore } from '../store/useDraftWriteAlertStore';

interface DraftWriteAlertBarProps {
  className?: string;
}

/**
 * VIS (утверждено владельцем 04.11): стоячий баннер над редактором, когда
 * напечатанное не записано на устройство и живёт только в этой вкладке.
 * Снимается принятием записи, а не таймером: условие стоячее, и погасший баннер
 * читался бы как «всё в порядке».
 *
 * Кнопки нет: повтор идёт сам, и «Повторить» обещало бы действие, которого
 * человек не совершает. `role="status"` на тексте: показ не отнимает фокус и не
 * двигает курсор.
 */
export function DraftWriteAlertBar({ className }: DraftWriteAlertBarProps) {
  const { t } = useLanguage();
  const localWriteStuck = useDraftWriteAlertStore(s => s.localWriteStuck);

  if (!localWriteStuck) return null;

  return (
    <div
      data-testid="draft-alert-local-write-stuck"
      className={cn(
        'flex items-start gap-1.5 rounded-xl border border-border-subtle bg-surface-card/90 px-3 py-1 text-[13px] leading-snug text-[var(--accent-danger)]',
        className
      )}
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span role="status">
        {t('editor_alert_local_write_stuck')}
      </span>
    </div>
  );
}
