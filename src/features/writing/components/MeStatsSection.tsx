import React from 'react';
import { useLanguage } from '../../../shared/i18n';
import { StatCard } from './MeScreenHelpers';
interface StatsProfile {
  totalWordCount?: number | undefined;
  sessionsCount?: number | undefined;
  totalDuration?: number | undefined;
  streakDays?: number | undefined;
  avgWpm?: number | undefined;
  avgSessionWords?: number | undefined;
}

interface MeStatsSectionProps {
  profile: StatsProfile | null;
}

export function MeStatsSection({ profile }: MeStatsSectionProps) {
  const { t, tp } = useLanguage();
  const streak = profile?.streakDays || 0;

  return (
    <div className="flex flex-col gap-3" >
      <div className="flex gap-2" >
        <StatCard
          value={(profile?.totalWordCount || 0).toLocaleString()}
          label={t('me_stat_total_words')}
          accent
        />
        <StatCard
          value={profile?.sessionsCount || 0}
          label={t('me_stat_sessions')}
        />
      </div>
      <div className="flex gap-2" >
        <StatCard
          value={streak}
          label={typeof tp === 'function' ? tp('me_stat_streak', streak) : t('me_stat_streak')}
        />
        <StatCard
          value={`${Math.round((profile?.totalDuration || 0) / 3600)}${t('unit_hour')}`}
          label={t('me_stat_total_time')}
        />
      </div>
      <div className="flex gap-2" >
        <StatCard
          value={profile?.avgWpm || 0}
          label={t('me_stat_avg_wpm')}
        />
        <StatCard
          value={profile?.avgSessionWords || 0}
          label={t('me_stat_avg_session')}
        />
      </div>
    </div>
  );
}
