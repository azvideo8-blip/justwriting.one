import { motion } from 'motion/react';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';
import { ArchiveSession } from '../types';
import { X } from 'lucide-react';

interface ArchiveStatsProps {
  sessions: ArchiveSession[];
  streakDays: number;
  title: string;
  onReset?: (() => void) | undefined;
}

export function ArchiveStats({ sessions, streakDays, title, onReset }: ArchiveStatsProps) {
  const { t } = useLanguage();

  const totalWords = sessions.reduce((s, n) => s + (n.wordCount || 0), 0);
  const totalMins = Math.round(sessions.reduce((s, n) => s + (n.duration || 0), 0) / 60);
  const totalDocs = sessions.length;

  const stats = [
    { label: t('archive_stat_docs'), value: totalDocs, isStreak: false },
    { label: t('archive_stat_words'), value: totalWords.toLocaleString(), isStreak: false },
    { label: t('archive_stat_mins'), value: totalMins, isStreak: false },
    { label: t('archive_stat_streak'), value: streakDays, suffix: t('home_streak_days'), isStreak: true },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-label-sm font-mono text-text-main/40 uppercase tracking-widest truncate">
          {title}
        </div>
        {onReset && (
          <button
            onClick={onReset}
            className="w-5 h-5 flex items-center justify-center rounded text-text-main/25 hover:text-text-main/60 hover:bg-text-main/5 transition-colors shrink-0 ml-2"
            title={t('archive_stats_reset')}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: i * 0.06 }}
            className={cn(
              "border rounded-xl p-2 flex flex-col gap-1",
              stat.isStreak
                ? "bg-text-main/5 border-transparent"
                : "bg-surface-card border-border-subtle"
            )}
            style={stat.isStreak ? {
              background: 'color-mix(in srgb, var(--flow-pulse-color) 8%, transparent)',
              borderColor: 'color-mix(in srgb, var(--flow-pulse-color) 25%, transparent)',
            } : {}}
          >
            <div
              className="text-base font-medium tabular-nums leading-none"
              style={stat.isStreak ? { color: 'var(--flow-pulse-color)' } : {}}
            >
              {stat.value}{stat.suffix ? ' ' + stat.suffix : ''}
            </div>
            <div className="text-label text-text-main/40 uppercase tracking-widest">
              {stat.label}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
