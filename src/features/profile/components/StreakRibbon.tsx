import { useState, useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getSessionDate, calculateStreak, calculateBestStreak, cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../shared/i18n';
import { Session } from '../../../types';
import { IconButton } from '../../../shared/components/IconButton';

interface StreakDay {
  date: Date;
  words: number;
  hasSession: boolean;
  isToday: boolean;
}

export function StreakRibbon({ sessions }: { sessions: Session[] }) {
  const { t, language } = useLanguage();
  const [offset, setOffset] = useState(0);
  const reducedMotion = useReducedMotion();

  const days: StreakDay[] = useMemo(() => {
    const result: StreakDay[] = [];
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() - offset * 30);

    const wordsByDate: Record<string, number> = {};
    sessions.forEach(s => {
      const d = getSessionDate(s);
      if (!d) return;
      const key = d.toDateString();
      wordsByDate[key] = (wordsByDate[key] || 0) + (s.wordCount || 0);
    });

    for (let i = 29; i >= 0; i--) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() - i);
      const key = date.toDateString();
      const words = wordsByDate[key] || 0;
      const isToday = date.toDateString() === new Date().toDateString();
      result.push({ date, words, hasSession: words > 0, isToday });
    }
    return result;
  }, [offset, sessions]);

  const currentStreak = useMemo(() => calculateStreak(sessions), [sessions]);

  const bestStreak = useMemo(() => calculateBestStreak(sessions), [sessions]);

  const maxWords = Math.max(...days.map(d => d.words), 1);

  const periodLabel = offset === 0
    ? t('profile_streak_current_month')
    : days[0]?.date.toLocaleDateString(language, { month: 'long', year: 'numeric' });

  return (
    <div className="px-6 py-5 border-b border-[var(--border-light)]">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-[16px] font-medium text-text-main">
          {t('profile_streak_title')}
        </h2>
        <div className="flex items-center gap-1">
          <IconButton onClick={() => setOffset(o => o + 1)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-text-main/60 hover:text-text-main hover:bg-text-main/5 transition-colors"
            label="Previous"
            icon={<ChevronLeft size={14} />}
          />
          <IconButton onClick={() => setOffset(o => Math.max(0, o - 1))} disabled={offset === 0}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-text-main/60 hover:text-text-main hover:bg-text-main/5 transition-colors disabled:opacity-20 disabled:cursor-default"
            label="Next"
            icon={<ChevronRight size={14} />}
          />
        </div>
      </div>
      <div className="flex items-baseline gap-4 mb-4 font-mono text-label-sm text-text-main/60">
        <span className="text-label uppercase tracking-widest">{periodLabel}</span>
        <span className="ml-auto">
          {t('profile_streak_now')}{' '}
          <span className="text-[16px] font-semibold text-[var(--flow-pulse-color)] drop-shadow-[0_0_12px_var(--flow-pulse-color)]">
            {currentStreak}
          </span>
        </span>
        <span>
          {t('profile_streak_best')} <span className="text-[14px] font-medium text-text-main/70">{bestStreak}</span>
        </span>
      </div>

      <div className="flex gap-1 items-end h-16" >
        {days.map((day, i) => {
          const heightPct = day.words > 0 ? Math.max(16, (day.words / maxWords) * 100) : 16;
          const isCurrentStreak = day.hasSession && offset === 0 &&
            i >= days.length - currentStreak;

          return (
            <motion.div
              key={i}
              initial={reducedMotion ? false : { scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ duration: 0.35, delay: i * 0.02, ease: 'easeOut' }}
              style={{ flex: 1, height: `${day.hasSession ? heightPct : 20}%`, minHeight: 3, transformOrigin: 'bottom' }}
              role="img" aria-label={`${day.date.toLocaleDateString(language)} — ${day.words} ${t('writing_words')}`}
              title={`${day.date.toLocaleDateString(language)} — ${day.words} ${t('writing_words')}`}
            >
              <div
                className={cn(
                  "h-full rounded-[2px]",
                  isCurrentStreak ? "bg-[var(--flow-pulse-color)]" : day.hasSession ? "bg-[var(--text-subtle)]" : "bg-[var(--surface-elevated)]",
                  day.isToday ? "outline outline-[1px] outline-[var(--text-subtle)] outline-offset-1" : "outline-none"
                )}
                style={isCurrentStreak && i === days.length - 1 ? { boxShadow: '0 0 8px var(--flow-pulse-color)' } : undefined}
              />
            </motion.div>
          );
        })}
      </div>

      <div className="flex justify-between mt-2 font-mono text-label text-text-main/60">
        <span>{days[0]?.date.toLocaleDateString(language, { day: 'numeric', month: 'short' })}</span>
        <span>{days[14]?.date.toLocaleDateString(language, { day: 'numeric', month: 'short' })}</span>
        <span>{t('profile_streak_today')}</span>
      </div>
    </div>
  );
}
