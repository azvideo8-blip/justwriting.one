import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getSessionDate, calculateStreak, calculateBestStreak } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';
import { Session } from '../../../types';

interface StreakDay {
  date: Date;
  words: number;
  hasSession: boolean;
  isToday: boolean;
}

export function StreakRibbon({ sessions }: { sessions: Session[] }) {
  const { t, language } = useLanguage();
  const [offset, setOffset] = useState(0);

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
    <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-light)' }}>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-[16px] font-medium text-text-main">
          {t('profile_streak_title')}
        </h2>
        <div className="flex items-center gap-1">
          <button onClick={() => setOffset(o => o + 1)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-text-main/30 hover:text-text-main hover:bg-text-main/5 transition-all">
            <ChevronLeft size={14} />
          </button>
          <button onClick={() => setOffset(o => Math.max(0, o - 1))} disabled={offset === 0}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-text-main/30 hover:text-text-main hover:bg-text-main/5 transition-all disabled:opacity-20 disabled:cursor-default">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      <div className="flex items-baseline gap-4 mb-4 font-mono text-[11px] text-text-main/40">
        <span className="text-[10px] uppercase tracking-widest">{periodLabel}</span>
        <span className="ml-auto">
          {t('profile_streak_now')} <span style={{ color: 'var(--flow-pulse-color)' }} className="text-[14px] font-medium">{currentStreak}</span>
        </span>
        <span>
          {t('profile_streak_best')} <span className="text-[14px] font-medium text-text-main/70">{bestStreak}</span>
        </span>
      </div>

      <div className="flex gap-1 items-end" style={{ height: 64 }}>
        {days.map((day, i) => {
          const heightPct = day.words > 0 ? Math.max(16, (day.words / maxWords) * 100) : 16;
          const isCurrentStreak = day.hasSession && offset === 0 &&
            i >= days.length - currentStreak;

          return (
            <div
              key={i}
              role="img" aria-label={`${day.date.toLocaleDateString(language)} — ${day.words} ${t('writing_words')}`}
              title={`${day.date.toLocaleDateString(language)} — ${day.words} ${t('writing_words')}`}
              style={{
                flex: 1,
                height: `${day.hasSession ? heightPct : 20}%`,
                minHeight: 3,
                borderRadius: 2,
                background: isCurrentStreak
                  ? 'var(--flow-pulse-color)'
                  : day.hasSession
                    ? 'var(--text-subtle)'
                    : 'var(--surface-elevated)',
                outline: day.isToday ? '1px solid var(--text-subtle)' : 'none',
                outlineOffset: 1,
                transition: 'height 0.3s',
              }}
            />
          );
        })}
      </div>

      <div className="flex justify-between mt-2 font-mono text-[10px] text-text-main/25">
        <span>{days[0]?.date.toLocaleDateString(language, { day: 'numeric', month: 'short' })}</span>
        <span>{days[14]?.date.toLocaleDateString(language, { day: 'numeric', month: 'short' })}</span>
        <span>{t('profile_streak_today')}</span>
      </div>
    </div>
  );
}
