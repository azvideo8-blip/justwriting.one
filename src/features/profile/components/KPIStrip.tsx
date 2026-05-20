import { Type, Flame, BookOpen, Clock } from 'lucide-react';
import { motion } from 'motion/react';
import { useLanguage } from '../../../core/i18n';
import { useCountUp } from '../../../shared/hooks/useCountUp';

interface KPIStats {
  totalWords: number;
  streakDays: number;
  sessionsCount: number;
  avgSessionMins: number;
  typicalHour: string;
  wordsPerDay: number;
}

function CountUpValue({ target }: { target: number }) {
  const value = useCountUp(target);
  return <>{value.toLocaleString()}</>;
}

export function KPIStrip({ stats }: { stats: KPIStats }) {
  const { t } = useLanguage();

  const items = [
    { countUp: stats.totalWords, label: t('archive_stat_words'), icon: <Type size={13} /> },
    { countUp: stats.streakDays, label: t('archive_stat_streak'), icon: <Flame size={13} />, accent: true },
    { countUp: stats.sessionsCount, label: t('archive_stat_docs'), icon: <BookOpen size={13} /> },
    { countUp: stats.avgSessionMins, suffix: ` ${t('goal_time_short')}`, label: t('profile_avg_session'), icon: <Clock size={13} /> },
    { value: stats.typicalHour, label: t('profile_typical_hour'), icon: <Clock size={13} />, dim: true },
    { countUp: stats.wordsPerDay, label: t('profile_words_per_day'), icon: <Type size={13} /> },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-px bg-border-light border-b border-border-light">
      {items.map((item, i) => (
        <motion.div
          key={i}
          whileHover={{ y: -2, scale: 1.02 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          style={{ padding: '16px 20px', background: 'var(--surface-card)', cursor: 'default' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span style={{ color: item.accent ? 'var(--flow-pulse-color)' : 'var(--text-muted)' }}>
              {item.icon}
            </span>
            <span className="text-[10px] text-text-muted uppercase tracking-wider leading-tight">
              {item.label}
            </span>
          </div>
          <div
            className="text-[24px] font-medium tracking-tight tabular-nums"
            style={{ fontFamily: 'var(--font-sans)', color: item.accent ? 'var(--flow-pulse-color)' : item.dim ? 'var(--text-muted)' : 'var(--text-main)' }}
          >
            {item.countUp !== undefined
              ? <><CountUpValue target={item.countUp} />{item.suffix ?? ''}</>
              : item.value}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
