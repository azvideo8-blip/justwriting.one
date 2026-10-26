import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';

/**
 * RA1-6 (решение владельца 2026-10-24): серия не исчезает при нуле — вместо
 * числа чип зовёт начать новую. Один вид на телефон и десктоп.
 */
export function StreakChip({ days, displayDays, className }: { days: number; displayDays?: number; className?: string }) {
  const { t, tp } = useLanguage();
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
        {days > 0 ? `${value} ${tp('home_streak_days', days)}` : t('home_streak_start')}
      </span>
    </div>
  );
}
