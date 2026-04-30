import { useMemo } from 'react';
import { useLanguage } from '../../../core/i18n';
import { Session } from '../../../types';

function getSessionHour(s: Session): number {
  if (s.sessionStartTime) return new Date(s.sessionStartTime).getHours();
  const d = s.createdAt;
  if (d instanceof Date) return d.getHours();
  if (typeof d === 'object' && d !== null && typeof (d as { toDate?: () => Date }).toDate === 'function') {
    return (d as { toDate: () => Date }).toDate().getHours();
  }
  return new Date(d as unknown as number).getHours();
}

export function HourRhythm({ sessions }: { sessions: Session[] }) {
  const { t } = useLanguage();

  const { data, peakHour } = useMemo(() => {
    const counts = new Array(24).fill(0);
    sessions.forEach(s => {
      counts[getSessionHour(s)]++;
    });
    const max = Math.max(...counts, 1);
    const normalized = counts.map(c => c / max);
    const peakHour = counts.indexOf(Math.max(...counts));
    return { data: normalized, peakHour };
  }, [sessions]);

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
        {data.map((v, h) => {
          const isPeak = v > 0.7;
          return (
            <div
              key={h}
              title={`${h}:00`}
              style={{
                flex: 1,
                height: `${Math.max(3, v * 100)}%`,
                borderRadius: 2,
                background: isPeak
                  ? 'var(--flow-pulse-color)'
                  : v > 0.1
                    ? 'var(--text-subtle)'
                    : 'var(--surface-elevated)',
              }}
            />
          );
        })}
      </div>

      <div className="flex justify-between mt-2 font-mono text-[10px] text-text-main/25">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
      </div>
    </div>
  );
}
