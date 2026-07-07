import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getSessionDate } from '../../../core/utils/utils';
import { IconButton } from '../../../shared/components/IconButton';
import { useLanguage } from '../../../shared/i18n';
import { Session } from '../../../types';

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

interface HeatCell {
  date: Date;
  words: number;
  level: 0 | 1 | 2 | 3 | 4;
}

interface HoveredCellState {
  wi: number;
  di: number;
  x: number;
  y: number;
  text: string;
}

export function Heatmap({ sessions }: { sessions: Session[] }) {
  const { t, language } = useLanguage();
  const [offset, setOffset] = useState(0);
  const [hoveredCell, setHoveredCell] = useState<HoveredCellState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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
      if (firstDay != null && firstDay.getDate() <= 7) {
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

  // SVG Layout dimensions
  const labelWidth = 15;
  const cellSize = 10;
  const cellGap = 2;
  const cellStride = cellSize + cellGap; // 12
  const gridYOffset = 18;
  const svgWidth = labelWidth + cells.length * cellStride;
  const svgHeight = gridYOffset + 7 * cellStride;

  const weekdayLabels = getDayLabels(language);

  return (
    <div className="px-4 py-6 md:px-9 md:py-8 border-b border-border-subtle relative" ref={containerRef}>
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-3 mb-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[18px] font-medium text-text-main">
            {t('profile_heatmap_title')}
          </h2>
          <span className="font-mono text-label-sm text-text-main/60 uppercase tracking-widest">
            {t('profile_heatmap_hint')}
          </span>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-4">
          <div className="flex items-center gap-1.5 font-mono text-label text-text-main/60">
            <span>{t('profile_heatmap_less')}</span>
            {colors.map((c, i) => {
              const dotStyle = { background: c };
              return (
                <div key={i} className="w-[11px] h-[11px] rounded-[2px]" style={dotStyle} />
              );
            })}
            <span>{t('profile_heatmap_more')}</span>
          </div>

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
      </div>

      <div className="overflow-x-auto pb-2 scrollbar-none">
        <svg 
          width="100%" 
          height={svgHeight} 
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="min-w-[420px]"
        >
          {/* Weekday labels */}
          {weekdayLabels.map((label, di) => {
            if (!label) return null;
            return (
              <text
                key={di}
                x={0}
                y={gridYOffset + di * cellStride + 8}
                className="font-mono text-[9px] fill-text-main/60"
              >
                {label}
              </text>
            );
          })}

          {/* Month labels */}
          {monthLabels.map((ml, index) => (
            <text
              key={index}
              x={labelWidth + ml.col * cellStride}
              y={10}
              className="font-mono text-[9px] fill-text-main/60"
            >
              {ml.label}
            </text>
          ))}

          {/* Heat cells */}
          {cells.map((week, wi) => (
            <g key={wi}>
              {week.map((day, di) => {
                const isHovered = hoveredCell?.wi === wi && hoveredCell?.di === di;
                const rectX = labelWidth + wi * cellStride;
                const rectY = gridYOffset + di * cellStride;

                return (
                  <motion.rect
                    key={di}
                    initial={reducedMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.15, delay: Math.min(wi, 12) * 0.01 }}
                    x={rectX}
                    y={rectY}
                    width={cellSize}
                    height={cellSize}
                    rx={2}
                    ry={2}
                    fill={isHovered ? 'var(--flow-pulse-color)' : colors[day.level]}
                    className="cursor-pointer transition-[fill] duration-100 outline-none"
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const parentRect = containerRef.current?.getBoundingClientRect();
                      if (parentRect) {
                        setHoveredCell({
                          wi,
                          di,
                          x: rect.left - parentRect.left + rect.width / 2,
                          y: rect.top - parentRect.top,
                          text: `${day.date.toLocaleDateString(language)} — ${day.words} ${t('home_words_short')}`
                        });
                      }
                    }}
                    onMouseLeave={() => setHoveredCell(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const parentRect = containerRef.current?.getBoundingClientRect();
                      if (parentRect) {
                        setHoveredCell({
                          wi,
                          di,
                          x: rect.left - parentRect.left + rect.width / 2,
                          y: rect.top - parentRect.top,
                          text: `${day.date.toLocaleDateString(language)} — ${day.words} ${t('home_words_short')}`
                        });
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`${day.date.toLocaleDateString(language)} — ${day.words} ${t('home_words_short')}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        const parentRect = containerRef.current?.getBoundingClientRect();
                        if (parentRect) {
                          setHoveredCell({
                            wi,
                            di,
                            x: rect.left - parentRect.left + rect.width / 2,
                            y: rect.top - parentRect.top,
                            text: `${day.date.toLocaleDateString(language)} — ${day.words} ${t('home_words_short')}`
                          });
                        }
                      }
                    }}
                  />
                );
              })}
            </g>
          ))}
        </svg>
      </div>

      {/* Tooltip */}
      {hoveredCell && (
        <div 
          className="absolute mb-1 whitespace-nowrap bg-[var(--surface-elevated)] border border-[var(--border-light)] rounded-md py-0.5 px-2 text-[10px] font-mono text-[var(--text-main)] shadow-[0_4px_12px_rgba(0,0,0,0.3)] pointer-events-none z-50 transition-all duration-100"
          style={{
            left: `${hoveredCell.x}px`,
            top: `${hoveredCell.y}px`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {hoveredCell.text}
        </div>
      )}
    </div>
  );
}
