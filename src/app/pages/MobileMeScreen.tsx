import { useState } from 'react';
import { cn } from '../../core/utils/utils';
import { useLanguage } from '../../shared/i18n';
import { UserProfile } from '../../types';
import type { AppUser } from '../../core/auth/types';
import { getOrCreateGuestId } from '../../core/storage/localDb';
import { MeAccountSection } from './MeAccountSection';
import { useSettings } from '../../core/settings/SettingsContext';
import { Settings } from 'lucide-react';
import { useUserId } from '../../shared/hooks/useUserId';
import { IconButton } from '../../shared/components/IconButton';
import { Button } from '../../shared/components/Button';
import { ProfileHero } from '../../features/profile/components/ProfileHero';
import { KPIStrip } from '../../features/profile/components/KPIStrip';
import { StreakRibbon } from '../../features/profile/components/StreakRibbon';
import { Heatmap } from '../../features/profile/components/Heatmap';
import { HourRhythm } from '../../features/profile/components/HourRhythm';
import { Achievements } from '../../features/profile/components/Achievements';
import { MoodTrend } from '../../features/profile/components/MoodTrend';
import { useNavigate } from 'react-router-dom';
import { ProfileService } from '../../core/services/ProfileService';
import { MobilePageHeader } from '../../shared/components/MobilePageHeader';
import { LoadingSkeleton } from '../../shared/components/LoadingSkeleton';
import { useProfileStats } from '../../features/profile/hooks/useProfileStats';

interface MobileMeScreenProps {
  user: AppUser | null;
  profile: UserProfile | null;
  onSignOut: () => void;
  onSignIn: () => void;
}

type Section = 'stats' | 'account';

export function MobileMeScreen({ user, profile, onSignOut, onSignIn }: MobileMeScreenProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<Section>('stats');
  const { openSettings } = useSettings();
  const userId = useUserId(user);
  const isGuest = !user;

  const { sessions, kpiStats, loading: loadingSessions, refresh: _refresh } = useProfileStats(userId, user);

  const [achievementsResetKey, setAchievementsResetKey] = useState(0);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleResetAchievements = async () => {
    const targetUserId = user?.uid || getOrCreateGuestId();
    await ProfileService.resetAchievements(targetUserId);
    setAchievementsResetKey(k => k + 1);
    setShowResetConfirm(false);
  };

  const sections: { id: Section; label: string }[] = [
    { id: 'stats',   label: t('me_tab_stats') },
    { id: 'account', label: t('me_tab_account') },
  ];

  return (
    <>
      {/* not-a-modal: fullscreen mobile screen */}
      <div className="fixed inset-0 bg-[var(--color-surface-base,#0b0d0c)] z-30 flex flex-col pt-0">
      {/* Top Header with title and Settings gear icon */}
      <MobilePageHeader
        title={t('nav_profile_short')}
        titleFont="sans"
        right={
          <IconButton
            icon={<Settings size={20} />}
            label={t('nav_settings')}
            onClick={() => openSettings()}
            className="p-2 text-text-muted hover:text-text-main"
          />
        }
      />

      {/* Pill Switcher */}
      <div className="flex justify-center shrink-0 border-b border-border-subtle py-2 px-4">
        <div className="flex bg-white/[0.04] p-1 rounded-xl gap-1 w-full max-w-xs">
          {sections.map(s => (
            <Button
              type="button"
              key={s.id}
              variant="ghost"
              size="sm"
              onClick={() => setActiveSection(s.id)}
              className={cn(
                "flex-1 py-1.5 rounded-lg border-none cursor-pointer text-xs font-medium transition-all duration-150",
                activeSection === s.id
                  ? "bg-white/[0.08] text-[rgba(232,236,233,0.95)] shadow-xs"
                  : "bg-transparent text-[rgba(74,81,77,0.9)] hover:text-[rgba(232,236,233,0.6)]"
              )}
            >
              {s.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Section Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-20">
        {activeSection === 'stats' && (
          loadingSessions ? (
            <div className="space-y-4">
              <LoadingSkeleton lines={3} className="p-4 bg-white/[0.02] border border-white/[0.04] rounded-2xl" />
              <LoadingSkeleton lines={4} className="p-4 bg-white/[0.02] border border-white/[0.04] rounded-2xl" />
              <LoadingSkeleton lines={4} className="p-4 bg-white/[0.02] border border-white/[0.04] rounded-2xl" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* 1. Profile Hero (Avatar, Name, Edit) */}
              <div className="rounded-2xl border border-white/[0.04] bg-white/[0.01] p-4">
                <ProfileHero
                  user={user}
                  profile={profile}
                  isGuest={isGuest}
                  onStartSession={() => void navigate('/')}
                />
              </div>

              {/* 2. KPI Strip (Metrics row) */}
              <KPIStrip stats={kpiStats} />

              {/* 3. Streak Ribbon */}
              <StreakRibbon sessions={sessions} />

              {/* 4. Heatmap Activity */}
              <div className="rounded-2xl border border-white/[0.04] bg-white/[0.01] p-4">
                <div className="text-[11px] font-medium text-[rgba(74,81,77,0.7)] uppercase tracking-wider mb-3">
                  {t('profile_act_map')}
                </div>
                <Heatmap sessions={sessions} />
              </div>

              {/* 5. Hour Rhythm */}
              <div className="rounded-2xl border border-white/[0.04] bg-white/[0.01] p-4">
                <div className="text-[11px] font-medium text-[rgba(74,81,77,0.7)] uppercase tracking-wider mb-3">
                  {t('profile_rhythm')}
                </div>
                <HourRhythm sessions={sessions} />
              </div>

              {/* 6. Mood Trend */}
              <MoodTrend userId={userId} className="rounded-2xl border border-white/[0.04] bg-white/[0.01] p-4" />

              {/* 7. Achievements */}
              <div className="rounded-2xl border border-white/[0.04] bg-white/[0.01] p-4">
                <Achievements
                  key={achievementsResetKey}
                  stats={kpiStats}
                  sessions={sessions}
                />

                {/* Reset Achievements action */}
                <div className="mt-4 pt-3 border-t border-border-subtle flex justify-end items-center gap-2">
                  {showResetConfirm ? (
                    <div className="flex items-center gap-2">
                      <span className="text-label-sm text-accent-danger/70 font-mono">
                        {t('profile_ach_reset_confirm')}
                      </span>
                      <Button variant="danger" size="sm" onClick={() => void handleResetAchievements()} className="text-label-sm font-medium uppercase tracking-widest">
                        {t('profile_ach_reset')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setShowResetConfirm(false)} className="text-label-sm font-medium uppercase tracking-widest">
                        ✕
                      </Button>
                    </div>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setShowResetConfirm(true)} className="font-mono text-label-sm text-text-main/60 hover:text-accent-danger/50 uppercase tracking-widest">
                      {t('profile_ach_reset')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )
        )}
        {activeSection === 'account' && <MeAccountSection user={user} onSignOut={onSignOut} onSignIn={onSignIn} />}
      </div>
    </div>
    </>
  );
}
