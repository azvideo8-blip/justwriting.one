import React, { useMemo, useState, useEffect } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useLanguage } from '../../../shared/i18n';
import { Session } from '../../../types';
import { toDate } from '../../../core/utils/dateUtils';
import { cn } from '../../../core/utils/utils';

function getSessionHour(s: Session): number | null {
  const d = s.sessionStartTime ? new Date(s.sessionStartTime) : toDate(s.createdAt);
  if (!d || isNaN(d.getTime())) return null;
  return d.getHours();
}

export function HourRhythm({ sessions }: { sessions: Session[] }) {
  const { t } = useLanguage();
  const reducedMotion = useReducedMotion();
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);

  // Clear tooltip on tap away
  useEffect(() => {
    if (hoveredHour === null) return;
    const handleBodyClick = () => {
      setHoveredHour(null);
    };
    document.addEventListener('click', handleBodyClick);
    return () => {
      document.removeEventListener('click', handleBodyClick);
    };
  }, [hoveredHour]);

  const { data, counts, peakHour } = useMemo(() => {
    const counts = new Array(24).fill(0);
    sessions.forEach(s => {
      const h = getSessionHour(s);
      if (h !== null && h >= 0 && h < 24) counts[h]++;
    });
    const max = Math.max(...counts, 1);
    const normalized = counts.map(c => c / max);
    const peakHour = counts.indexOf(Math.max(...counts));
    return { data: normalized, counts, peakHour };
  }, [sessions]);

  const isPeak = (h: number) => h === peakHour && counts[h] > 0;

  return (
    <div className="px-4 py-6 md:px-9 md:py-8 border-b border-border-subtle" >
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-3 mb-4">
        <h2 className="text-[18px] font-medium text-text-main">
          {t('profile_rhythm_title')}
        </h2>
        <div className="font-mono text-label-sm text-text-main/40">
          {t('profile_rhythm_peak')}{' '}
          <span className="text-[var(--flow-pulse-color)]">
            {String(peakHour).padStart(2, '0')}:00
          </span>
        </div>
      </div>

      <div className="flex gap-0.5 items-end overflow-visible h-[72px]">
        {data.map((v, h) => {
          const isLeftEdge = h < 3;
          const isRightEdge = h > 20;

          const tooltipAlignStyle: React.CSSProperties = isLeftEdge
            ? { left: 0, transform: 'none' }
            : isRightEdge
            ? { right: 0, left: 'auto', transform: 'none' }
            : { left: '50%', transform: 'translateX(-50%)' };

          return (
            <motion.div
              key={h}
              initial={reducedMotion ? false : { scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ duration: 0.4, delay: h * 0.02, ease: 'easeOut' }}
              onClick={(e) => {
                e.stopPropagation();
                setHoveredHour(h);
              }}
              style={{ flex: 1, height: `${Math.max(3, v * 100)}%`, transformOrigin: 'bottom', position: 'relative', cursor: 'pointer' }}
              onMouseEnter={() => setHoveredHour(h)}
              onMouseLeave={() => setHoveredHour(null)}
            >
              <div
                className={cn(
                  "h-full rounded-[2px] transition-colors duration-150",
                  hoveredHour === h ? "bg-[var(--flow-pulse-color)]" : isPeak(h) ? "bg-[var(--flow-pulse-color)]" : v > 0.1 ? "bg-[var(--text-subtle)]" : "bg-[var(--surface-elevated)]"
                )}
                style={hoveredHour === h ? { filter: 'brightness(1.15)' } : undefined}
              />
              {hoveredHour === h && (
                <div className="absolute bottom-full mb-1.5 whitespace-nowrap bg-[var(--surface-elevated)] border border-[var(--border-light)] rounded-md py-0.5 px-2 text-[10px] font-mono text-[var(--text-main)] shadow-[0_4px_12px_rgba(0,0,0,0.3)] pointer-events-none z-50" style={tooltipAlignStyle}>
                  {String(h).padStart(2, '0')}:00 · {counts[h]}
                </div>
              )}
              {isPeak(h) && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[8px] leading-none text-[var(--flow-pulse-color)] pointer-events-none">▲</div>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="flex justify-between mt-2 font-mono text-label text-text-main/25">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
      </div>
    </div>
  );
}
