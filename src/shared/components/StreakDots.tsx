import { useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '../../core/utils/utils';
import { useLanguage } from '../../core/i18n';

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

  const filledCount = days.filter(d => d.hasSession).length;
  const chainWidth = filledCount > 0 ? `${((filledCount - 1) / 6) * 100}%` : '0%';

  if (variant === 'mobile') {
    return (
      <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between' }}>
        {days.map((day, i) => (
          <div key={i} style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            flex: 1,
          }}>
            <div style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'JetBrains Mono, monospace',
              background: day.hasSession
                ? day.isToday
                  ? 'var(--brand-primary)'
                  : 'rgba(255,255,255,0.12)'
                : 'rgba(255,255,255,0.04)',
              color: day.hasSession
                ? day.isToday
                  ? 'var(--color-surface-base, #0b0d0c)'
                  : 'rgba(232,236,233,0.85)'
                : 'rgba(255,255,255,0.20)',
              border: day.isToday && !day.hasSession
                ? '1px solid rgba(255,255,255,0.15)'
                : '1px solid transparent',
              boxShadow: day.isToday && day.hasSession
                ? '0 0 8px color-mix(in srgb, var(--brand-primary) 40%, transparent)'
                : 'none',
            }}>
              {day.date.getDate()}
            </div>
            <span style={{
              fontSize: 9,
              color: day.isToday
                ? 'rgba(232,236,233,0.7)'
                : 'rgba(74,81,77,1)',
              fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '.04em',
            }}>
              {day.date.toLocaleDateString(language, { weekday: 'narrow' }).toUpperCase()}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex justify-center gap-2 relative">
      <div className="absolute top-[16px] left-[16px] right-[16px] h-[2px] bg-border-subtle/40 z-0" />
      <div className="absolute top-[16px] left-[16px] h-[2px] bg-brand-primary z-0 transition-all duration-500" style={{ width: chainWidth }} />
      {days.map((day, i) => (
        <motion.div
          key={i}
          className="flex flex-col items-center gap-1 relative z-10"
          initial={reducedMotion ? {} : { scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={reducedMotion ? { duration: 0 } : {
            type: 'spring',
            stiffness: day.isToday ? 500 : 350,
            damping: day.isToday ? 18 : 20,
            delay: i * 0.04,
          }}
        >
          <div
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold transition-all",
              day.hasSession
                ? day.isToday
                  ? "bg-brand-primary text-surface-base ring-2 ring-brand-primary/30 ring-offset-2 ring-offset-surface-card"
                  : "bg-brand-primary/40 text-text-main"
                : day.isToday
                  ? "bg-text-main/10 text-text-main/40 ring-2 ring-brand-primary/20 ring-offset-2 ring-offset-surface-card"
                  : "bg-text-main/10 text-text-main/30"
            )}
          >
            {day.date.getDate()}
          </div>
          <span className="text-[9px] font-mono text-text-main/30 uppercase">
            {day.date.toLocaleDateString(language, { weekday: 'narrow' })}
          </span>
        </motion.div>
      ))}
    </div>
  );
}
