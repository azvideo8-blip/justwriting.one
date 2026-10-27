import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';

/**
 * RA1-6: один вид на телефон и десктоп. Владелец 27.10: при нуле чипа нет —
 * «Начнём новую серию» над пустым экраном мешала (решение 24.10 отменено).
 */
export function StreakChip({ days, displayDays, className }: { days: number; displayDays?: number; className?: string }) {
  const { tp } = useLanguage();
  if (days <= 0) return null;
  const value = displayDays ?? days;
  return (
    <div
      data-testid="streak-chip"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-[var(--border-light)] bg-[var(--surface-card)] px-3 py-1 text-[13px] font-medium text-[var(--text-main)]',
        className
      )}
    >
      <span className="tabular-nums">
        {`${value} ${tp('home_streak_days', days)}`}
      </span>
    </div>
  );
}
