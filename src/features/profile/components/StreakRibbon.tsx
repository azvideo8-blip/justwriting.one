import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getSessionDate } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';
import { Session } from '../../../types';

interface StreakDay {
  date: Date;
  words: number;
  hasSession: boolean;
  isToday: boolean;
}

export function StreakRibbon({ sessions }: { sessions: Session[] }) {
  const { t } = useLanguage();
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

  const currentStreak = useMemo(() => {
    let streak = 0;
    const check = new Date();
    check.setHours(0, 0, 0, 0);
    const dateSet = new Set(
      sessions.map(s => getSessionDate(s)).filter((d): d is Date => d !== null).map(d => d.toDateString())
    );
    while (dateSet.has(check.toDateString())) {
      streak++;
      check.setDate(check.getDate() - 1);
    }
    return streak;
  }, [sessions]);

  const bestStreak = useMemo(() => {
    const sorted = [...sessions]
      .map(s => ({ s, d: getSessionDate(s) }))
      .filter((item): item is { s: Session; d: Date } => item.d !== null)
      .sort((a, b) => a.d.getTime() - b.d.getTime());
    let best = 0, cur = 0, prev: Date | null = null;
    sorted.forEach(({ d }) => {
      if (prev) {
        const diff = (d.getTime() - prev.getTime()) / 86400000;
        cur = diff <= 1.5 ? cur + 1 : 1;
      } else cur = 1;
      if (cur > best) best = cur;
      prev = d;
    });
    return best;
  }, [sessions]);

  const maxWords = Math.max(...days.map(d => d.words), 1);

  const periodLabel = offset === 0
    ? t('profile_streak_current_month')
    : days[0]?.date.toLocaleDateString('ru', { month: 'long', year: 'numeric' });

  return (
    <div style={{ padding: '24px 36px', borderBottom: '1px solid var(--border-light)' }}>
      <div className="flex items-baseline justify-between mb-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[18px] font-medium text-text-main">
            {t('profile_streak_title')}
          </h2>
          <span className="font-mono text-[11px] text-text-main/30 uppercase tracking-widest">
            {periodLabel}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex gap-4 font-mono text-[11px] text-text-main/40">
            <span>{t('profile_streak_now')} <span style={{ color: 'var(--flow-pulse-color)' }} className="text-[13px] font-medium">{currentStreak}</span></span>
            <span>{t('profile_streak_best')} <span className="text-[13px] font-medium text-text-main/70">{bestStreak}</span></span>
          </div>

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
      </div>

      <div className="flex gap-1 items-end" style={{ height: 48 }}>
        {days.map((day, i) => {
          const heightPct = day.words > 0 ? Math.max(16, (day.words / maxWords) * 100) : 16;
          const isCurrentStreak = day.hasSession && offset === 0 &&
            i >= days.length - currentStreak;

          return (
            <div
              key={i}
              title={`${day.date.toLocaleDateString('ru')} — ${day.words} слов`}
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
        <span>{days[0]?.date.toLocaleDateString('ru', { day: 'numeric', month: 'short' })}</span>
        <span>{days[14]?.date.toLocaleDateString('ru', { day: 'numeric', month: 'short' })}</span>
        <span>{t('profile_streak_today')}</span>
      </div>
    </div>
  );
}
