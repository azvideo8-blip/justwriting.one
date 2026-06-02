import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../../../core/i18n';
import { UserProfile } from '../../../types';
import { User } from 'firebase/auth';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { getOrCreateGuestId, LocalProfile } from '../../../core/storage/localDb';
import { MeAccountSection } from './MeAccountSection';
import { useSettings } from '../../../core/settings/SettingsContext';
import { Settings } from 'lucide-react';
import { useUserId } from '../../../shared/hooks/useUserId';
import { IconButton } from '../../../shared/components/IconButton';
import { Button } from '../../../shared/components/Button';
import { ProfileHero } from '../../profile/components/ProfileHero';
import { KPIStrip } from '../../profile/components/KPIStrip';
import { StreakRibbon } from '../../profile/components/StreakRibbon';
import { Heatmap } from '../../profile/components/Heatmap';
import { HourRhythm } from '../../profile/components/HourRhythm';
import { Achievements } from '../../profile/components/Achievements';
import { reportError } from '../../../core/errors/reportError';
import { useNavigate } from 'react-router-dom';
import { ProfileService } from '../../profile/services/ProfileService';
import { MobilePageHeader } from '../../../shared/components/MobilePageHeader';
import { LoadingSkeleton } from '../../../shared/components/LoadingSkeleton';
import { useProfileStats } from '../../profile/hooks/useProfileStats';

interface MobileMeScreenProps {
  user: User | null;
  profile: UserProfile | null;
  onSignOut: () => void;
  onSignIn: () => void;
}

type Section = 'stats' | 'account';

export function MobileMeScreen({ user, profile, onSignOut, onSignIn }: MobileMeScreenProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<Section>('stats');
  const [_localProfile, setLocalProfile] = useState<LocalProfile | undefined>(undefined);
  const { openSettings } = useSettings();
  const userId = useUserId(user);
  const isGuest = !user;

  const { sessions, kpiStats, loading: loadingSessions, refresh: _refresh } = useProfileStats(userId, user);
  const [achResetKey, setAchResetKey] = useState(0);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleResetAchievements = useCallback(() => {
    localStorage.removeItem(`unlocked_achievements_${user?.uid ?? 'guest'}`);
    setAchResetKey(k => k + 1);
    setShowResetConfirm(false);
    if (user) {
      ProfileService.resetAchievements(user.uid).catch(e => {
        reportError(e, { action: 'resetCloudAchievements', userId: user.uid });
      });
    }
  }, [user]);

  // Load local profile metadata for guest fallback
  useEffect(() => {
    if (isGuest) {
      void LocalDocumentService.getProfile(getOrCreateGuestId()).then(p => setLocalProfile(p ?? undefined));
    }
  }, [isGuest]);

  const sections: { id: Section; label: string }[] = [
    { id: 'stats',   label: t('me_tab_stats') },
    { id: 'account', label: t('me_tab_account') },
  ];

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--color-surface-base, #0b0d0c)',
      zIndex: 30,
      display: 'flex',
      flexDirection: 'column',
      paddingTop: 0,
    }}>
      {/* Top Header with title and Settings gear icon */}
      <MobilePageHeader
        title={t('nav_profile_short')}
        titleFont="sans"
        right={
          <IconButton
            icon={<Settings size={20} />}
            label={t('nav_settings')}
            onClick={() => openSettings()}
            className="p-3 text-text-muted/60"
          />
        }
      />

      <div style={{ padding: '12px 20px 0' }}>
        {/* Navigation Tabs Selector */}
        <div style={{
          display: 'flex',
          background: 'rgba(255,255,255,0.04)',
          borderRadius: 10,
          padding: 3,
          gap: 2,
          marginBottom: 12,
        }}>
          {sections.map(s => (
            <button
              type="button"
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              style={{
                flex: 1,
                minHeight: 44,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                fontFamily: 'Inter, system-ui, sans-serif',
                background: activeSection === s.id
                  ? 'rgba(255,255,255,0.08)'
                  : 'transparent',
                color: activeSection === s.id
                  ? 'var(--color-text-main, var(--text-main))'
                  : 'var(--color-text-subtle, var(--text-subtle))',
                transition: 'all 0.15s',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: activeSection === 'stats' ? '0' : '0 20px',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
        WebkitOverflowScrolling: 'touch',
      }}>
        {activeSection === 'stats' && (
          loadingSessions ? (
            <div className="space-y-4 px-4 pt-4">
              <LoadingSkeleton />
              {/* Profile Hero Skeleton */}
              <div className="skeleton-pulse bg-surface-card border border-white/[0.04] rounded-2xl h-32 w-full" />
              {/* KPI Skeleton */}
              <div className="skeleton-pulse bg-surface-card border border-white/[0.04] rounded-2xl h-16 w-full" />
              {/* Charts Skeletons */}
              <div className="skeleton-pulse bg-surface-card border border-white/[0.04] rounded-2xl h-40 w-full" />
              <div className="skeleton-pulse bg-surface-card border border-white/[0.04] rounded-2xl h-40 w-full" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-6 px-6 py-16 text-center">
              <div className="text-[14px] text-text-main/40 leading-relaxed max-w-xs">
                {t('profile_empty_desc')}
              </div>
              <div className="text-label-sm text-text-main/25 font-mono uppercase tracking-widest">
                {t('profile_empty_hint')}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              <ProfileHero
                user={user}
                profile={profile}
                isGuest={isGuest}
                onStartSession={() => void navigate('/')}
              />
              <div className="px-4 flex flex-col gap-5 pt-2">
                {/* KPI stats strip card */}
                <div className="bg-surface-card/25 backdrop-blur-md border border-white/[0.04] rounded-2xl overflow-hidden shadow-md [&>div]:!border-b-0">
                  <KPIStrip stats={kpiStats} />
                </div>

                {/* Heatmap activity card */}
                <div className="bg-surface-card/25 backdrop-blur-md border border-white/[0.04] rounded-2xl overflow-hidden shadow-md [&>div]:!border-b-0 [&>div]:!px-4 [&>div]:!py-5">
                  <Heatmap sessions={sessions} />
                </div>

                {/* Hourly rhythm card */}
                <div className="bg-surface-card/25 backdrop-blur-md border border-white/[0.04] rounded-2xl overflow-hidden shadow-md [&>div]:!border-b-0 [&>div]:!px-4 [&>div]:!py-5">
                  <HourRhythm sessions={sessions} />
                </div>

                {/* Streak ribbon card */}
                <div className="bg-surface-card/25 backdrop-blur-md border border-white/[0.04] rounded-2xl overflow-hidden shadow-md [&>div]:!border-b-0 [&>div]:!px-4 [&>div]:!py-5">
                  <StreakRibbon sessions={sessions} />
                </div>

                {/* Achievements card */}
                <div className="bg-surface-card/25 backdrop-blur-md border border-white/[0.04] rounded-2xl overflow-hidden shadow-md [&>div]:!border-b-0 [&>div]:!px-4 [&>div]:!py-5">
                  <Achievements key={achResetKey} stats={kpiStats} sessions={sessions} />
                </div>

                {/* Reset achievements button */}
                <div style={{ padding: '12px 0 24px', textAlign: 'center' }}>
                  {showResetConfirm ? (
                    <div className="inline-flex items-center gap-3 bg-accent-danger/10 border border-accent-danger/20 rounded-lg px-4 py-2">
                      <span className="text-[12px] text-accent-danger">{t('profile_ach_reset_confirm')}</span>
                      <Button variant="danger" size="sm" onClick={handleResetAchievements} className="text-label-sm font-medium uppercase tracking-widest">
                        {t('profile_ach_reset')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setShowResetConfirm(false)} className="text-label-sm font-medium uppercase tracking-widest">
                        ✕
                      </Button>
                    </div>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setShowResetConfirm(true)} className="font-mono text-label-sm text-text-main/20 hover:text-accent-danger/50 uppercase tracking-widest">
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
  );
}
