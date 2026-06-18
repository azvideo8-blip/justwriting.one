import { useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '../../shared/utils/cn';
import { useLanguage } from '../../shared/i18n';

interface StreakDotsProps {
  sessionGroups: { date: Date; sessions: unknown[] }[];
  variant: 'modal' | 'mobile';
}

export function StreakDots({ sessionGroups, variant }: StreakDotsProps) {
  const { language } = useLanguage();
  const reducedMotion = useReducedMotion();

  const days = useMemo(() => {
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const hasSession = sessionGroups.some(g =>
        new Date(g.date).toDateString() === d.toDateString()
      );
      const isToday = i === 0;
      result.push({ date: d, hasSession, isToday });
    }
    return result;
  }, [sessionGroups]);

  if (variant === 'mobile') {
    return (
      <div role="group" aria-label="Writing streak calendar" className="flex justify-between gap-1.5">
        {days.map((day, i) => (
          <div key={i} className="flex flex-col items-center gap-1 flex-1">
            <div
              role="gridcell"
              aria-label={day.hasSession ? `${day.date.toLocaleDateString()}: session written` : `${day.date.toLocaleDateString()}: no session`}
              className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold font-mono",
                day.hasSession
                  ? day.isToday
                    ? "bg-[var(--brand-primary)] text-[var(--color-surface-base,#0b0d0c)]"
                    : "bg-[rgba(255,255,255,0.12)] text-[rgba(232,236,233,0.85)]"
                  : "bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.20)]",
                day.isToday && !day.hasSession ? "border border-[rgba(255,255,255,0.15)]" : "border border-transparent"
              )}
            >
              {day.date.getDate()}
            </div>
            <span className="text-[9px] font-mono text-text-main/60 uppercase">
              {day.date.toLocaleDateString(language, { weekday: 'narrow' })}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div role="group" aria-label="Writing streak calendar" className="flex justify-between gap-1.5">
      {days.map((day, i) => (
        <motion.div
          key={i}
          initial={reducedMotion ? false : { scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3, delay: i * 0.05, type: 'spring', stiffness: 300, damping: 20 }}
          className="flex flex-col items-center gap-1 flex-1"
        >
          <div
            role="gridcell"
            aria-label={day.hasSession ? `${day.date.toLocaleDateString()}: session written` : `${day.date.toLocaleDateString()}: no session`}
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center text-label-sm font-bold transition-colors",
              day.hasSession
                ? day.isToday
                  ? "bg-brand-primary text-surface-base ring-2 ring-brand-primary/30 ring-offset-2 ring-offset-surface-card"
                  : "bg-brand-primary/40 text-text-main"
                : day.isToday
                  ? "bg-text-main/10 text-text-main/60 ring-2 ring-brand-primary/20 ring-offset-2 ring-offset-surface-card"
                  : "bg-text-main/10 text-text-main/60"
            )}
          >
            {day.date.getDate()}
          </div>
          <span className="text-[9px] font-mono text-text-main/60 uppercase">
            {day.date.toLocaleDateString(language, { weekday: 'narrow' })}
          </span>
        </motion.div>
      ))}
    </div>
  );
}
