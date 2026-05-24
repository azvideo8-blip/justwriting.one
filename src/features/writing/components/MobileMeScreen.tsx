import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLanguage } from '../../../core/i18n';
import { UserProfile, Session } from '../../../types';
import { User } from 'firebase/auth';
import { LocalDocumentService } from '../services/LocalDocumentService';
import { getOrCreateGuestId, LocalProfile } from '../../../shared/lib/localDb';
import { MeAccountSection } from './MeAccountSection';
import { useSettings } from '../../../core/settings/SettingsContext';
import { Settings } from 'lucide-react';
import { useUserId } from '../../../shared/hooks/useUserId';
import { loadAllSessions } from '../services/UnifiedSessionLoader';
import { calculateStreak } from '../../../core/utils/utils';
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

interface MobileMeScreenProps {
  user: User | null;
  profile: UserProfile | null;
  onSignOut: () => void;
  onSignIn: () => void;
}

type Section = 'stats' | 'account';

interface DocLevelStats {
  totalWords: number;
  sessionsCount: number;
  totalDuration: number;
}

export function MobileMeScreen({ user, profile, onSignOut, onSignIn }: MobileMeScreenProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<Section>('stats');
  const [_localProfile, setLocalProfile] = useState<LocalProfile | undefined>(undefined);
  const { openSettings } = useSettings();
  const userId = useUserId(user);
  const isGuest = !user;

  const [sessions, setSessions] = useState<Session[]>([]);
  const [docStats, setDocStats] = useState<DocLevelStats>({ totalWords: 0, sessionsCount: 0, totalDuration: 0 });
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [fetchKey] = useState(0);
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
      LocalDocumentService.getProfile(getOrCreateGuestId()).then(p => setLocalProfile(p ?? undefined));
    }
  }, [isGuest]);

  // Load full session history for stats charts and achievements
  useEffect(() => {
    let cancelled = false;
    const fetchProfileData = async () => {
      setLoadingSessions(true);
      try {
        const result = await loadAllSessions(userId, user);
        if (cancelled) return;
        let totalWords = 0;
        let sessionsCount = 0;
        let totalDuration = 0;
        for (const s of result.sessions) {
          totalWords += s._totalWords ?? s.wordCount ?? 0;
          sessionsCount += s._sessionsCount ?? 1;
          totalDuration += s._totalDuration ?? s.duration ?? 0;
        }
        setSessions(result.sessions);
        setDocStats({ totalWords, sessionsCount, totalDuration });
      } catch (err) {
        if (cancelled) return;
        reportError(err, { page: 'mobile-me', userId });
      } finally {
        if (!cancelled) setLoadingSessions(false);
      }
    };

    fetchProfileData();
    return () => { cancelled = true; };
  }, [userId, user, fetchKey]);


  // Calculate full KPI Statistics
  const kpiStats = useMemo(() => {
    try {
      const dates = new Set<string>();
      sessions.forEach(s => {
        try {
          const ts = s.sessionStartTime ?? 
            (typeof (s.createdAt as { toDate?: () => Date })?.toDate === 'function'
              ? (s.createdAt as { toDate: () => Date }).toDate().getTime()
              : s.createdAt instanceof Date ? s.createdAt.getTime() : null);
          if (!ts) return;
          const d = new Date(ts);
          if (isNaN(d.getTime())) return;
          dates.add(d.toDateString());
        } catch (e) { reportError(e, { action: 'parseSessionDate' }, 'warning'); }
      });

      const streak = calculateStreak(sessions);

      const avgMins = docStats.sessionsCount
        ? Math.round(docStats.totalDuration / docStats.sessionsCount / 60)
        : 0;

      const hours = new Array(24).fill(0) as number[];
      sessions.forEach(s => {
        try {
          const ts = s.sessionStartTime ?? 
            (typeof (s.createdAt as { toDate?: () => Date })?.toDate === 'function'
              ? (s.createdAt as { toDate: () => Date }).toDate().getTime()
              : s.createdAt instanceof Date ? s.createdAt.getTime() : null);
          if (!ts) return;
          const d = new Date(ts);
          const h = d.getHours();
          if (!isNaN(h) && h >= 0 && h < 24) hours[h]++;
        } catch (e) { reportError(e, { action: 'parseSessionHour' }, 'warning'); }
      });
      const totalHourHits = hours.reduce((a, b) => a + b, 0);
      const typicalHour = totalHourHits === 0
        ? '—'
        : `${String(hours.indexOf(Math.max(...hours))).padStart(2, '0')}:00`;

      const daysActive = dates.size || 1;
      const wordsPerDay = Math.round(docStats.totalWords / daysActive);

      return {
        totalWords: docStats.totalWords,
        streakDays: streak,
        sessionsCount: docStats.sessionsCount,
        avgSessionMins: avgMins,
        typicalHour,
        wordsPerDay,
      };
    } catch (err) {
      reportError(err, { action: 'kpiStats' });
      return { totalWords: 0, streakDays: 0, sessionsCount: 0, avgSessionMins: 0, typicalHour: '—', wordsPerDay: 0 };
    }
  }, [sessions, docStats]);

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
          <button
            onClick={() => openSettings()}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(232,236,233,0.6)',
              cursor: 'pointer',
              padding: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 44,
              minHeight: 44,
            }}
            aria-label={t('nav_settings')}
          >
            <Settings size={20} />
          </button>
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
              <style dangerouslySetInnerHTML={{__html: `
                @keyframes pulse-bg {
                  0%, 100% { opacity: 0.6; }
                  50% { opacity: 0.35; }
                }
                .skeleton-pulse {
                  animation: pulse-bg 1.5s ease-in-out infinite;
                }
              `}} />
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
                onStartSession={() => navigate('/')}
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
                    <div className="inline-flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
                      <span className="text-[12px] text-red-400">{t('profile_ach_reset_confirm')}</span>
                      <button onClick={handleResetAchievements} className="text-label-sm font-medium text-red-400 hover:text-red-300 transition-colors uppercase tracking-widest">
                        {t('profile_ach_reset')}
                      </button>
                      <button onClick={() => setShowResetConfirm(false)} className="text-label-sm font-medium text-text-main/40 hover:text-text-main/60 transition-colors uppercase tracking-widest">
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setShowResetConfirm(true)} className="font-mono text-label-sm text-text-main/20 hover:text-red-400/50 transition-colors uppercase tracking-widest">
                      {t('profile_ach_reset')}
                    </button>
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
