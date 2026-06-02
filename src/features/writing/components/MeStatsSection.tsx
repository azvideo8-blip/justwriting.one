import React from 'react';
import { useLanguage } from '../../../core/i18n';
import { StatCard } from './MeScreenHelpers';
interface StatsProfile {
  totalWordCount?: number;
  sessionsCount?: number;
  totalDuration?: number;
  streakDays?: number;
  avgWpm?: number;
  avgSessionWords?: number;
}

interface MeStatsSectionProps {
  profile: StatsProfile | null;
}

export function MeStatsSection({ profile }: MeStatsSectionProps) {
  const { t } = useLanguage();

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
          value={profile?.streakDays || 0}
          label={t('me_stat_streak')}
        />
        <StatCard
          value={`${Math.round((profile?.totalDuration || 0) / 60)}ч`}
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
