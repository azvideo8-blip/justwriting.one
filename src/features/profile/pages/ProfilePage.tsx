import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'motion/react';
import { User } from 'firebase/auth';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Session, UserProfile } from '../../../types';
import { LocalDocumentService } from '../../writing/services/LocalDocumentService';
import { calculateStreak } from '../../../core/utils/utils';
import { LocalVersionService } from '../../writing/services/LocalVersionService';
import { DocumentService } from '../../writing/services/DocumentService';
import { SessionService } from '../../writing/services/SessionService';
import { SyncService } from '../../writing/services/SyncService';
import { getOrCreateGuestId } from '../../../shared/lib/localDb';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../../core/i18n';
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

function SafeSection({ children }: { label?: string; children: React.ReactNode }) {
  return <>{children}</>;
}

export function ProfilePage({ user, profile }: ProfilePageProps) {
  const { t } = useLanguage();
  const isGuest = !user;
  const userId = user?.uid ?? getOrCreateGuestId();
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [docStats, setDocStats] = useState<DocLevelStats>({ totalWords: 0, sessionsCount: 0, totalDuration: 0 });
  const [loading, setLoading] = useState(true);
  const [achResetKey, setAchResetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);
  const [_unsyncedCount, setUnsyncedCount] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    SyncService.getUnsyncedCount(user.uid).then(count => {
      if (!cancelled) setUnsyncedCount(count);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [user, fetchKey]);

  const handleSyncBoth = useCallback(async () => {
    if (!user || syncing) return;
    setSyncing(true);
    try {
      const [uploadResult, downloadResult] = await Promise.all([
        SyncService.syncAllUnlinked(user.uid),
        SyncService.downloadAllFromCloud(user.uid),
      ]);
      const total = uploadResult.synced + downloadResult.downloaded;
      if (uploadResult.failed + downloadResult.failed > 0) {
        showToast(t('profile_sync_partial', { synced: String(total), failed: String(uploadResult.failed + downloadResult.failed) }), 'error');
      } else {
        showToast(t('profile_sync_success', { count: String(total) }), 'success');
      }
      setUnsyncedCount(0);
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
    const fetchSessions = async () => {
      setLoading(true);
      setError(null);
      try {
        const allSessions: Session[] = [];
        const seenIds = new Set<string>();
        let totalWords = 0;
        let sessionsCount = 0;
        let totalDuration = 0;

        const localDocs = await LocalDocumentService.getGuestDocuments(userId);

        const allVersions = await Promise.allSettled(
          localDocs.map(doc => LocalVersionService.getVersions(doc.id))
        );

        for (let idx = 0; idx < localDocs.length; idx++) {
          const doc = localDocs[idx];
          if (seenIds.has(doc.id)) continue;
          seenIds.add(doc.id);
          totalWords += doc.totalWords || 0;
          sessionsCount += doc.sessionsCount || 1;
          totalDuration += doc.totalDuration || 0;

          const result = allVersions[idx];
          if (result.status === 'rejected') {
            console.error('Error loading versions for doc', doc.id, result.reason);
            continue;
          }

          const versions = result.value;
            for (const ver of versions) {
              const startedAt = ver.sessionStartedAt
                ? ver.sessionStartedAt
                : doc.firstSessionAt || null;
              if (!startedAt) continue;
              allSessions.push({
                id: ver.id,
                userId: doc.guestId,
                authorName: '',
                authorPhoto: '',
                content: ver.content || '',
                duration: ver.duration || 0,
                wordCount: ver.wordsAdded || 0,
                charCount: 0,
                wpm: ver.wpm || 0,
                title: doc.title || '',
                tags: doc.tags || [],
                sessionStartTime: startedAt,
                createdAt: new Date(startedAt),
              });
            }
            if (versions.length === 0) {
              const startedAt = doc.firstSessionAt || null;
              if (!startedAt) continue;
              allSessions.push({
                id: doc.id,
                userId: doc.guestId,
                authorName: '',
                authorPhoto: '',
                content: '',
                duration: doc.totalDuration || 0,
                wordCount: doc.totalWords || 0,
                charCount: 0,
                wpm: 0,
                title: doc.title || '',
                tags: doc.tags || [],
                sessionStartTime: startedAt,
                createdAt: new Date(startedAt),
              });
            }

}

        if (user) {
          try {
            const cloudDocs = await DocumentService.getUserDocuments(user.uid);
            for (const cloudDoc of cloudDocs) {
              if (seenIds.has(cloudDoc.id)) continue;
              seenIds.add(cloudDoc.id);
              totalWords += cloudDoc.totalWords || 0;
              sessionsCount += cloudDoc.sessionsCount || 1;
              totalDuration += cloudDoc.totalDuration || 0;
              try {
                const firstAt = cloudDoc.firstSessionAt ?? cloudDoc.lastSessionAt;
                const created = (firstAt as { toDate?: () => Date })?.toDate?.() ?? new Date();
                allSessions.push({
                  id: cloudDoc.id,
                  userId: user.uid,
                  authorName: '',
                  authorPhoto: '',
                  content: '',
                  duration: cloudDoc.totalDuration || 0,
                  wordCount: cloudDoc.totalWords || 0,
                  charCount: 0,
                  wpm: 0,
                  title: cloudDoc.title || '',
                  tags: cloudDoc.tags || [],
                  sessionStartTime: created.getTime(),
                  createdAt: created,
                });
              } catch (cloudErr) {
                console.error('Error processing cloud doc', cloudDoc.id, cloudErr);
              }
            }
          } catch (e) {
            console.error('Failed to fetch cloud docs for profile:', e);
          }

          try {
            const { sessions: legacySessions } = await SessionService.getAllSessions(user.uid, 500);
            for (const s of legacySessions) {
              if (seenIds.has(s.id)) continue;
              seenIds.add(s.id);
              totalWords += s.wordCount || 0;
              sessionsCount += 1;
              totalDuration += s.duration || 0;
              allSessions.push(s);
            }
          } catch (e) {
            console.error('Failed to fetch legacy sessions for profile:', e);
          }
        }

        if (cancelled) return;
        setSessions(allSessions);
        setDocStats({ totalWords, sessionsCount, totalDuration });
      } catch (err) {
        if (cancelled) return;
        reportError(err, { page: 'profile', userId: user?.uid ?? 'guest' });
        setError(t('profile_load_error'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchSessions();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, fetchKey]);

  const kpiStats = useMemo(() => {
    try {
      const dates = new Set<string>();
      sessions.forEach(s => {
        try {
          const ts = s.sessionStartTime ?? (s.createdAt instanceof Date ? s.createdAt.getTime() : null);
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
          const ts = s.sessionStartTime ?? (s.createdAt instanceof Date ? s.createdAt.getTime() : null);
          if (!ts) return;
          const d = new Date(ts);
          const h = d.getHours();
          if (!isNaN(h) && h >= 0 && h < 24) hours[h]++;
        } catch { /* ignore */ }
      });
      const typicalHour = `${String(hours.indexOf(Math.max(...hours))).padStart(2, '0')}:00`;

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
      return { totalWords: 0, streakDays: 0, sessionsCount: 0, avgSessionMins: 0, typicalHour: '00:00', wordsPerDay: 0 };
    }
  }, [sessions, docStats]);

  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleResetAchievements = useCallback(() => {
    localStorage.removeItem('unlocked_achievements');
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
      <SafeSection label="ProfileHero">
        <ProfileHero user={user} profile={profile} isGuest={isGuest} onStartSession={() => navigate('/')} />
      </SafeSection>
      <SafeSection label="KPIStrip">
        <KPIStrip stats={kpiStats} />
      </SafeSection>
      <SafeSection label="StreakRibbon">
        <StreakRibbon sessions={sessions} />
      </SafeSection>
      <SafeSection label="Heatmap">
        <Heatmap sessions={sessions} />
      </SafeSection>
      <SafeSection label="HourRhythm">
        <HourRhythm sessions={sessions} />
      </SafeSection>
      <SafeSection label="Achievements">
        <Achievements key={achResetKey} stats={kpiStats} sessions={sessions} />
      </SafeSection>
      <div style={{ padding: '12px 36px 48px', textAlign: 'center' }}>
        {user && (
          <div className="mb-4">
            <button
              onClick={handleSyncBoth}
              disabled={syncing}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-brand-soft/30 text-brand-soft hover:bg-brand-soft/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              {syncing ? t('profile_syncing') : t('profile_sync_button')}
            </button>
          </div>
        )}
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
