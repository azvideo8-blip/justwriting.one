import { AlertTriangle } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';
import { useDraftWriteAlertStore } from '../store/useDraftWriteAlertStore';

interface DraftWriteAlertBarProps {
  className?: string;
}

/**
 * VIS (утверждено владельцем 04.11): стоячий баннер над редактором для двух
 * состояний, в которых напечатанное не записано на устройство и живёт только в
 * этой вкладке.
 *
 * Один баннер на состояние: при совпадении виден T1 (текст прежнего входа не
 * записан) — он важнее, потому что у того текста нет и текущей сессии. Снимается
 * принятием записи, а не таймером: условие стоячее, и погасший баннер читался бы
 * как «всё в порядке».
 *
 * Ни текстов заметок, ни заголовков, ни адресов (I3): состояние — это факт
 * «не записано», а не «что именно и чьё». Кнопки нет — повтор идёт сам, и
 * «Повторить» обещало бы действие, которого человек не совершает. `role="status"`
 * на тексте: показ не отнимает фокус и не двигает курсор.
 */
export function DraftWriteAlertBar({ className }: DraftWriteAlertBarProps) {
  const { t } = useLanguage();
  const rescueNotWritten = useDraftWriteAlertStore(s => s.rescueNotWritten);
  const localWriteStuck = useDraftWriteAlertStore(s => s.localWriteStuck);

  if (!rescueNotWritten && !localWriteStuck) return null;

  return (
    <div
      data-testid={rescueNotWritten ? 'draft-alert-rescue-not-written' : 'draft-alert-local-write-stuck'}
      className={cn(
        'flex items-start gap-1.5 rounded-xl border border-border-subtle bg-surface-card/90 px-3 py-1 text-[13px] leading-snug text-[var(--accent-danger)]',
        className
      )}
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span role="status">
        {rescueNotWritten ? t('editor_alert_rescue_not_written') : t('editor_alert_local_write_stuck')}
      </span>
    </div>
  );
}
