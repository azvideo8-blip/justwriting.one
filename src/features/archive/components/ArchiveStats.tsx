import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';
import { ArchiveSession } from '../pages/ArchivePage';

function toJsDate(d: Date | { toDate?: () => Date }): Date {
  if (d instanceof Date) return d;
  if (d && typeof d === 'object' && 'toDate' in d) return (d as { toDate: () => Date }).toDate();
  return new Date();
}

export function ArchiveStats({ sessions, streakDays }: { sessions: ArchiveSession[]; streakDays: number }) {
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
    <div className="grid grid-cols-2 gap-2">
      {stats.map(stat => (
        <div
          key={stat.label}
          className={cn(
            "border rounded-xl p-2.5 lg:p-3 flex flex-col gap-1",
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
            className="text-lg lg:text-xl font-medium tabular-nums leading-none"
            style={stat.isStreak ? { color: 'var(--flow-pulse-color)' } : {}}
          >
            {stat.value}{stat.suffix ? ' ' + stat.suffix : ''}
          </div>
          <div className="text-[10px] text-text-main/35 uppercase tracking-widest">
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  );
}

export function calculateStreak(sessions: ArchiveSession[]): number {
  const dates = new Set(sessions.map(s => {
    const d = toJsDate(s.createdAt);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toDateString();
  }));
  let streak = 0;
  const check = new Date();
  check.setHours(0, 0, 0, 0);
  while (dates.has(check.toDateString())) {
    streak++;
    check.setDate(check.getDate() - 1);
  }
  return streak;
}
