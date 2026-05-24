import React, { useState, useMemo, useEffect } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getSessionDate } from '../../../core/utils/utils';

function getDayLabels(locale: string): string[] {
  const mon = new Date(2024, 0, 1);
  const wed = new Date(2024, 0, 3);
  const fri = new Date(2024, 0, 5);
  return [
    mon.toLocaleDateString(locale, { weekday: 'narrow' }),
    '',
    wed.toLocaleDateString(locale, { weekday: 'narrow' }),
    '',
    fri.toLocaleDateString(locale, { weekday: 'narrow' }),
    '',
    '',
  ];
}
import { useLanguage } from '../../../core/i18n';
import { Session } from '../../../types';

interface HeatCell {
  date: Date;
  words: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export function Heatmap({ sessions }: { sessions: Session[] }) {
  const { t, language } = useLanguage();
  const [offset, setOffset] = useState(0);
  const [hoveredCell, setHoveredCell] = useState<{ wi: number; di: number } | null>(null);
  const reducedMotion = useReducedMotion();

  // Clear tooltip on tap away
  useEffect(() => {
    if (hoveredCell === null) return;
    const handleBodyClick = () => {
      setHoveredCell(null);
    };
    document.addEventListener('click', handleBodyClick);
    return () => {
      document.removeEventListener('click', handleBodyClick);
    };
  }, [hoveredCell]);

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
          label: firstDay.toLocaleDateString(language, { month: 'short' }),
        });
      }
    });

    return { cells: weeks, monthLabels: labels };
  }, [offset, sessions, language]);

  const colors = [
    'var(--surface-elevated)',
    'color-mix(in srgb, var(--flow-pulse-color) 20%, transparent)',
    'color-mix(in srgb, var(--flow-pulse-color) 40%, transparent)',
    'color-mix(in srgb, var(--flow-pulse-color) 65%, transparent)',
    'var(--flow-pulse-color)',
  ];

  return (
    <div className="px-4 py-6 md:px-9 md:py-8" style={{ borderBottom: '1px solid var(--border-light)' }}>
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-3 mb-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[18px] font-medium text-text-main">
            {t('profile_heatmap_title')}
          </h2>
          <span className="font-mono text-[11px] text-text-main/30 uppercase tracking-widest">
            {t('profile_heatmap_hint')}
          </span>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-4">
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

      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-none">
        <div className="flex flex-col gap-[3px] pt-5">
          {getDayLabels(language).map((d, i) => (
            <div key={i} style={{ height: 11, lineHeight: '11px' }}
              className="font-mono text-[9px] text-text-main/25">{d}</div>
          ))}
        </div>

        <div className="flex-1 min-w-[280px] overflow-visible">
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
                {week.map((day, di) => {
                  const isHovered = hoveredCell?.wi === wi && hoveredCell?.di === di;
                  const isLeftEdge = wi < 3;
                  const isRightEdge = wi > cells.length - 4;

                  const tooltipAlignStyle: React.CSSProperties = isLeftEdge
                    ? { left: 0, transform: 'none' }
                    : isRightEdge
                    ? { right: 0, left: 'auto', transform: 'none' }
                    : { left: '50%', transform: 'translateX(-50%)' };

                  return (
                    <motion.div
                      key={di}
                      initial={reducedMotion ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.15, delay: Math.min(wi, 12) * 0.01 }}
                      onMouseEnter={() => setHoveredCell({ wi, di })}
                      onMouseLeave={() => setHoveredCell(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setHoveredCell({ wi, di });
                      }}
                      style={{ position: 'relative', cursor: 'pointer' }}
                    >
                      <div
                        style={{
                          height: 11,
                          background: isHovered
                            ? 'var(--flow-pulse-color)'
                            : colors[day.level],
                          borderRadius: 2,
                          transition: 'background 0.1s',
                        }}
                      />
                      {isHovered && (
                        <div style={{
                          position: 'absolute', bottom: '100%',
                          marginBottom: 4, whiteSpace: 'nowrap',
                          background: 'var(--surface-elevated)', border: '1px solid var(--border-light)',
                          borderRadius: 6, padding: '3px 8px', fontSize: 10,
                          fontFamily: 'var(--font-mono)', color: 'var(--text-main)',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.3)', pointerEvents: 'none', zIndex: 50,
                          ...tooltipAlignStyle
                        }}>
                          {day.date.toLocaleDateString(language)} — {day.words} {t('home_words_short')}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
