import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'motion/react';
import { User } from 'firebase/auth';
import { AlertCircle } from 'lucide-react';
import { Session, UserProfile } from '../../../types';
import { calculateStreak } from '../../../core/utils/utils';
import { SyncService } from '../../writing/services/SyncService';
import { loadAllSessions } from '../../writing/services/UnifiedSessionLoader';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../../core/i18n';
import { useUserId } from '../../../shared/hooks/useUserId';
import { reportError } from '../../../core/errors/reportError';
import { JustWritingLogo } from '../../../shared/components/JustWritingLogo';
import { ProfileHero } from '../components/ProfileHero';
import { KPIStrip } from '../components/KPIStrip';
import { StreakRibbon } from '../components/StreakRibbon';
import { Heatmap } from '../components/Heatmap';
import { HourRhythm } from '../components/HourRhythm';
import { Achievements } from '../components/Achievements';
import { ProfileService } from '../services/ProfileService';
import { useToast } from '../../../shared/components/Toast';

interface ProfilePageProps {
  user: User | null;
  profile: UserProfile | null;
}

interface DocLevelStats {
  totalWords: number;
  sessionsCount: number;
  totalDuration: number;
}

export function ProfilePage({ user, profile }: ProfilePageProps) {
  const { t } = useLanguage();
  const isGuest = !user;
  const userId = useUserId(user);
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [docStats, setDocStats] = useState<DocLevelStats>({ totalWords: 0, sessionsCount: 0, totalDuration: 0 });
  const [loading, setLoading] = useState(true);
  const [achResetKey, setAchResetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const { showToast } = useToast();

  const handleSyncBoth = useCallback(async () => {
    if (!user || syncing) return;
    setSyncing(true);
    try {
      const [uploadResult, downloadResult] = await Promise.allSettled([
        SyncService.syncAllUnlinked(user.uid),
        SyncService.downloadAllFromCloud(user.uid),
      ]);
      const upload = uploadResult.status === 'fulfilled' ? uploadResult.value : { synced: 0, failed: 0 };
      const download = downloadResult.status === 'fulfilled' ? downloadResult.value : { downloaded: 0, failed: 0 };
      const total = upload.synced + download.downloaded;
      if (uploadResult.status === 'rejected' || downloadResult.status === 'rejected' || upload.failed + download.failed > 0) {
        showToast(t('profile_sync_partial', { synced: String(total), failed: String(upload.failed + download.failed) }), 'error');
      } else {
        showToast(t('profile_sync_success', { count: String(total) }), 'success');
      }
      setFetchKey(k => k + 1);
    } catch (e) {
      reportError(e, { action: 'syncBoth', userId: user.uid });
      showToast(t('profile_sync_error'), 'error');
    } finally {
      setSyncing(false);
    }
  }, [user, syncing, showToast, t]);

  useEffect(() => {
    let cancelled = false;
    const fetchProfileData = async () => {
      setLoading(true);
      setError(null);
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
        reportError(err, { page: 'profile', userId: user?.uid ?? 'guest' });
        setError(t('profile_load_error'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchProfileData();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, fetchKey]);

  const kpiStats = useMemo(() => {
    try {
      const dates = new Set<string>();
      sessions.forEach(s => {
        try {
          const ts = s.sessionStartTime ?? 
            (typeof (s.createdAt as any)?.toDate === 'function'
              ? (s.createdAt as any).toDate().getTime()
              : s.createdAt instanceof Date ? s.createdAt.getTime() : null);
          if (!ts) return;
          const d = new Date(ts);
          if (isNaN(d.getTime())) return;
          dates.add(d.toDateString());
        } catch { /* ignore */ }
      });

      const streak = calculateStreak(sessions);

      const avgMins = docStats.sessionsCount
        ? Math.round(docStats.totalDuration / docStats.sessionsCount / 60)
        : 0;

      const hours = new Array(24).fill(0) as number[];
      sessions.forEach(s => {
        try {
          const ts = s.sessionStartTime ?? 
            (typeof (s.createdAt as any)?.toDate === 'function'
              ? (s.createdAt as any).toDate().getTime()
              : s.createdAt instanceof Date ? s.createdAt.getTime() : null);
          if (!ts) return;
          const d = new Date(ts);
          const h = d.getHours();
          if (!isNaN(h) && h >= 0 && h < 24) hours[h]++;
        } catch { /* ignore */ }
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
      console.error('kpiStats error:', err);
      return { totalWords: 0, streakDays: 0, sessionsCount: 0, avgSessionMins: 0, typicalHour: '—', wordsPerDay: 0 };
    }
  }, [sessions, docStats]);

  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleResetAchievements = useCallback(() => {
    localStorage.removeItem(`unlocked_achievements_${user?.uid ?? 'guest'}`);
    setAchResetKey(k => k + 1);
    setShowResetConfirm(false);
    if (user) {
      ProfileService.resetAchievements(user.uid).catch(e => {
        console.error('Failed to reset cloud achievements:', e);
      });
    }
  }, [user]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-24">
        <motion.div
          animate={{ opacity: [0.7, 1, 0.7] }}
          transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
          style={{ filter: "drop-shadow(0 0 24px color-mix(in srgb, var(--brand-soft) 40%, transparent))" }}
        >
          <JustWritingLogo size={120} variant="dark" showRailway={true} showRoman={true} showCrown={true} />
        </motion.div>
        <p className="text-sm text-text-main/35 tracking-widest uppercase font-sans">
          {t("profile_loading")}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-12 text-center rounded-2xl border bg-red-500/10 border-red-500/20">
        <AlertCircle size={24} className="mx-auto mb-3 text-red-400/70" /><p className="text-red-400 text-sm mb-4">{t('profile_load_error')}</p>
        <button onClick={() => { setError(null); setFetchKey(k => k + 1); }} className="px-4 py-2 rounded-xl text-sm font-medium text-red-400 border border-red-400/30 hover:bg-red-400/10 transition-all">
          {t('retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-base">
      <>
        <ProfileHero
          user={user} profile={profile} isGuest={isGuest}
          onStartSession={() => navigate('/')}
          onSync={user ? handleSyncBoth : undefined}
          syncing={syncing}
        />
      </>
      <div className="px-9 pt-6 space-y-0">
          <>
            <KPIStrip stats={kpiStats} />
          </>
          <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--flow-pulse-color) 30%, var(--border-light)), transparent)' }} />
          <>
            <Heatmap sessions={sessions} />
          </>
          <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--flow-pulse-color) 30%, var(--border-light)), transparent)' }} />
          <>
            <HourRhythm sessions={sessions} />
          </>
          <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--flow-pulse-color) 30%, var(--border-light)), transparent)' }} />
          <>
            <StreakRibbon sessions={sessions} />
          </>
          <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--flow-pulse-color) 30%, var(--border-light)), transparent)' }} />
          <>
            <Achievements key={achResetKey} stats={kpiStats} sessions={sessions} />
          </>
      </div>
      <div style={{ padding: '12px 36px 48px', textAlign: 'center' }}>
        {showResetConfirm ? (
          <div className="inline-flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
            <span className="text-[12px] text-red-400">{t('profile_ach_reset_confirm')}</span>
            <button onClick={handleResetAchievements} className="text-[11px] font-medium text-red-400 hover:text-red-300 transition-colors uppercase tracking-widest">
              {t('profile_ach_reset')}
            </button>
            <button onClick={() => setShowResetConfirm(false)} className="text-[11px] font-medium text-text-main/40 hover:text-text-main/60 transition-colors uppercase tracking-widest">
              ✕
            </button>
          </div>
        ) : (
          <button onClick={() => setShowResetConfirm(true)} className="font-mono text-[11px] text-text-main/20 hover:text-red-400/50 transition-colors uppercase tracking-widest">
            {t('profile_ach_reset')}
          </button>
        )}
      </div>
    </div>
  );
}
