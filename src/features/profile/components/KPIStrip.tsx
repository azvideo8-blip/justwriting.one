import { Type, Flame, BookOpen, Clock } from 'lucide-react';
import { useLanguage } from '../../../core/i18n';
import React from 'react';

interface KPIStats {
  totalWords: number;
  streakDays: number;
  sessionsCount: number;
  avgSessionMins: number;
  typicalHour: string;
  wordsPerDay: number;
}

export function KPIStrip({ stats }: { stats: KPIStats }) {
  const { t } = useLanguage();

  const items = [
    { value: stats.totalWords.toLocaleString(), label: t('archive_stat_words'), icon: <Type size={13} /> },
    { value: stats.streakDays, label: t('archive_stat_streak'), icon: <Flame size={13} />, accent: true },
    { value: stats.sessionsCount, label: t('archive_stat_docs'), icon: <BookOpen size={13} /> },
    { value: `${stats.avgSessionMins} мин`, label: t('profile_avg_session'), icon: <Clock size={13} /> },
    { value: stats.typicalHour, label: t('profile_typical_hour'), icon: <Clock size={13} />, dim: true },
    { value: stats.wordsPerDay, label: t('profile_words_per_day'), icon: <Type size={13} /> },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(6, 1fr)',
      gap: 1,
      background: 'rgba(255,255,255,0.06)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      {items.map((item, i) => (
        <div key={i} style={{ padding: '18px 22px', background: '#0b0d0c' }}>
          <div className="flex items-center gap-2 mb-2">
            <span style={{ color: item.accent ? 'var(--flow-pulse-color)' : 'rgba(74,81,77,1)' }}>
              {item.icon}
            </span>
            <span className="font-mono text-[10px] text-text-main/30 uppercase tracking-widest">
              {item.label}
            </span>
          </div>
          <div
            className="text-[24px] font-medium tracking-tight"
            style={{ color: item.accent ? 'var(--flow-pulse-color)' : item.dim ? 'rgba(138,145,141,1)' : 'rgba(232,236,233,0.95)' }}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}
