import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getSessionDate } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';
import { Session } from '../../../types';

interface HeatCell {
  date: Date;
  words: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export function Heatmap({ sessions }: { sessions: Session[] }) {
  const { t } = useLanguage();
  const [offset, setOffset] = useState(0);

  const { cells, monthLabels } = useMemo(() => {
    const wordsByDate: Record<string, number> = {};
    sessions.forEach(s => {
      const d = getSessionDate(s);
      if (!d) return;
      const key = d.toDateString();
      wordsByDate[key] = (wordsByDate[key] || 0) + (s.wordCount || 0);
    });

    const endDate = new Date();
    endDate.setDate(endDate.getDate() - offset * 30);
    endDate.setHours(0, 0, 0, 0);

    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 181);

    while (startDate.getDay() !== 1) startDate.setDate(startDate.getDate() - 1);

    const allDays: { date: Date; words: number }[] = [];
    const cur = new Date(startDate);
    while (cur <= endDate) {
      allDays.push({ date: new Date(cur), words: wordsByDate[cur.toDateString()] || 0 });
      cur.setDate(cur.getDate() + 1);
    }

    const maxW = Math.max(...allDays.map(d => d.words), 1);

    const weeks: HeatCell[][] = [];
    for (let i = 0; i < allDays.length; i += 7) {
      weeks.push(allDays.slice(i, i + 7).map(d => ({
        ...d,
        level: d.words === 0 ? 0
          : d.words < maxW * 0.25 ? 1
          : d.words < maxW * 0.5 ? 2
          : d.words < maxW * 0.75 ? 3
          : 4,
      })));
    }

    const labels: { col: number; label: string }[] = [];
    weeks.forEach((week, wi) => {
      const firstDay = week[0]?.date;
      if (firstDay && firstDay.getDate() <= 7) {
        labels.push({
          col: wi,
          label: firstDay.toLocaleDateString('ru', { month: 'short' }),
        });
      }
    });

    return { cells: weeks, monthLabels: labels };
  }, [offset, sessions]);

  const colors = [
    'var(--surface-elevated)',
    'color-mix(in srgb, var(--flow-pulse-color) 20%, transparent)',
    'color-mix(in srgb, var(--flow-pulse-color) 40%, transparent)',
    'color-mix(in srgb, var(--flow-pulse-color) 65%, transparent)',
    'var(--flow-pulse-color)',
  ];

  return (
    <div style={{ padding: '24px 36px', borderBottom: '1px solid var(--border-light)' }}>
      <div className="flex items-baseline justify-between mb-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[18px] font-medium text-text-main">
            {t('profile_heatmap_title')}
          </h2>
          <span className="font-mono text-[11px] text-text-main/30 uppercase tracking-widest">
            {t('profile_heatmap_hint')}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-text-main/30">
            <span>{t('profile_heatmap_less')}</span>
            {colors.map((c, i) => (
              <div key={i} style={{ width: 11, height: 11, background: c, borderRadius: 2 }} />
            ))}
            <span>{t('profile_heatmap_more')}</span>
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

      <div className="flex gap-4">
        <div className="flex flex-col gap-[3px] pt-5">
          {['пн', '', 'ср', '', 'пт', '', ''].map((d, i) => (
            <div key={i} style={{ height: 11, lineHeight: '11px' }}
              className="font-mono text-[9px] text-text-main/25">{d}</div>
          ))}
        </div>

        <div className="flex-1 overflow-hidden">
          <div className="flex mb-1" style={{ gap: 3 }}>
            {cells.map((_, wi) => {
              const label = monthLabels.find(l => l.col === wi);
              return (
                <div key={wi} style={{ flex: 1 }}
                  className="font-mono text-[9px] text-text-main/25 truncate">
                  {label?.label || ''}
                </div>
              );
            })}
          </div>

          <div className="flex" style={{ gap: 3 }}>
            {cells.map((week, wi) => (
              <div key={wi} className="flex flex-col" style={{ flex: 1, gap: 3 }}>
                {week.map((day, di) => (
                  <div
                    key={di}
                    title={`${day.date.toLocaleDateString('ru')} — ${day.words} слов`}
                    style={{
                      height: 11,
                      background: colors[day.level],
                      borderRadius: 2,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
