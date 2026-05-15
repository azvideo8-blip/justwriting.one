import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useLanguage } from '../../../core/i18n';
import { Session } from '../../../types';
import { toDate } from '../../../core/utils/dateUtils';

function getSessionHour(s: Session): number | null {
  const d = s.sessionStartTime ? new Date(s.sessionStartTime) : toDate(s.createdAt);
  if (!d || isNaN(d.getTime())) return null;
  return d.getHours();
}

export function HourRhythm({ sessions }: { sessions: Session[] }) {
  const { t } = useLanguage();
  const reducedMotion = useReducedMotion();
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);

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
    <div style={{ padding: '24px 36px', borderBottom: '1px solid var(--border-light)' }}>
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-[18px] font-medium text-text-main">
          {t('profile_rhythm_title')}
        </h2>
        <div className="font-mono text-[11px] text-text-main/35">
          {t('profile_rhythm_peak')}{' '}
          <span style={{ color: 'var(--flow-pulse-color)' }}>
            {String(peakHour).padStart(2, '0')}:00
          </span>
        </div>
      </div>

      <div className="flex gap-0.5 items-end" style={{ height: 72 }}>
        {data.map((v, h) => (
          <motion.div
              key={h}
              initial={reducedMotion ? false : { scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ duration: 0.4, delay: h * 0.02, ease: 'easeOut' }}
              style={{ flex: 1, height: `${Math.max(3, v * 100)}%`, transformOrigin: 'bottom', position: 'relative' }}
              onMouseEnter={() => setHoveredHour(h)}
              onMouseLeave={() => setHoveredHour(null)}
            >
              <div
                style={{
                  height: '100%',
                  borderRadius: 2,
                background: isPeak(h)
                  ? 'var(--flow-pulse-color)'
                  : v > 0.1
                    ? 'var(--text-subtle)'
                    : 'var(--surface-elevated)',
                transition: 'background 0.15s',
                ...(hoveredHour === h ? { background: 'var(--flow-pulse-color)', filter: 'brightness(1.15)' } : {}),
              }}
            />
            {hoveredHour === h && (
              <div style={{
                position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                marginBottom: 6, whiteSpace: 'nowrap',
                background: 'var(--surface-elevated)', border: '1px solid var(--border-light)',
                borderRadius: 6, padding: '3px 8px', fontSize: 10,
                fontFamily: 'var(--font-mono)', color: 'var(--text-main)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)', pointerEvents: 'none', zIndex: 10,
              }}>
                {String(h).padStart(2, '0')}:00 · {counts[h]} {t('home_words_short')}
              </div>
            )}
            {isPeak(h) && (
              <div style={{
                position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)',
                fontSize: 8, lineHeight: 1, color: 'var(--flow-pulse-color)', pointerEvents: 'none',
              }}>▲</div>
            )}
          </motion.div>
        ))}
      </div>

      <div className="flex justify-between mt-2 font-mono text-[10px] text-text-main/25">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
      </div>
    </div>
  );
}
