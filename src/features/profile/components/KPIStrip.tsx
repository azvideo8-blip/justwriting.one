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
      background: 'var(--border-light)',
      borderBottom: '1px solid var(--border-light)',
    }}>
      {items.map((item, i) => (
        <div key={i} style={{ padding: '18px 22px', background: 'var(--surface-card)' }}>
          <div className="flex items-center gap-2 mb-2">
            <span style={{ color: item.accent ? 'var(--flow-pulse-color)' : 'var(--text-muted)' }}>
              {item.icon}
            </span>
            <span className="font-mono text-[10px] text-text-muted uppercase tracking-widest">
              {item.label}
            </span>
          </div>
          <div
            className="text-[24px] font-medium tracking-tight"
            style={{ color: item.accent ? 'var(--flow-pulse-color)' : item.dim ? 'var(--text-muted)' : 'var(--text-main)' }}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}
