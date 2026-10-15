import { motion } from 'motion/react';
import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';
import { ArchiveSession } from '../types';
import { X } from 'lucide-react';
import { IconButton } from '../../../shared/components/IconButton';
import { SECTION_LABEL } from '../../../shared/components/ModalShell';

interface ArchiveStatsProps {
  sessions: ArchiveSession[];
  streakDays: number;
  title: string;
  onReset?: (() => void) | undefined;
  /** MQ-8: телефон — без карточек и моно-капса, нулевые показатели скрыты. */
  flat?: boolean;
}

export function ArchiveStats({ sessions, streakDays, title, onReset, flat = false }: ArchiveStatsProps) {
  const { t, tp } = useLanguage();

  const totalWords = sessions.reduce((s, n) => s + (n.wordCount || 0), 0);
  const totalMins = Math.round(sessions.reduce((s, n) => s + (n.duration || 0), 0) / 60);
  const totalDocs = sessions.length;

  const stats = [
    { label: tp('archive_stat_docs', totalDocs), value: totalDocs, isStreak: false },
    { label: tp('archive_stat_words', totalWords), value: totalWords.toLocaleString(), isStreak: false },
    { label: tp('archive_stat_mins', totalMins), value: totalMins, isStreak: false },
    // DC-A5: нулевой стрик — не показатель. Плитка про нуль появлялась на
    // пустом архиве и во время загрузки и читалась как «0 дней».
    ...(streakDays > 0
      ? [{ label: tp('archive_stat_streak', streakDays), value: streakDays, isStreak: true }]
      : []),
  ];

  if (flat) {
    const shown = stats.filter(s => Number(String(s.value).replace(/\D/g, '')) > 0);
    return (
      <div>
        {(onReset || title) && (
          <div className="flex items-center justify-between">
            <div className={cn(SECTION_LABEL, 'truncate')}>{title}</div>
            {onReset && (
              <IconButton
                onClick={onReset}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-main/60"
                label={t('archive_stats_reset')}
                icon={<X size={16} />}
              />
            )}
          </div>
        )}
        {shown.length > 0 && (
          <div className="flex flex-wrap gap-x-6 gap-y-2" data-testid="archive-stats-flat">
            {shown.map(stat => (
              <div key={stat.label}>
                <div className="text-[17px] font-semibold tabular-nums leading-tight" style={stat.isStreak ? { color: 'var(--flow-pulse-color)' } : {}}>{stat.value}</div>
                <div className="text-[12px] text-text-muted">{stat.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-label-sm font-mono text-text-main/60 uppercase tracking-widest truncate">
          {title}
        </div>
        {onReset && (
          <IconButton
            onClick={onReset}
            className="w-5 h-5 flex items-center justify-center rounded text-text-main/60 hover:text-text-main hover:bg-text-main/5 transition-colors shrink-0 ml-2"
            label={t('archive_stats_reset')}
            icon={<X size={12} />}
          />
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, transform: "translateY(8px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
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
              {stat.value}
            </div>
            <div className="text-label text-text-main/60 uppercase tracking-widest">
              {stat.label}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
