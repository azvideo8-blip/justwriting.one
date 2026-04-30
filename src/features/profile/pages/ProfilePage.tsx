import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { User } from 'firebase/auth';
import { Session, UserProfile } from '../../../types';
import { LocalDocumentService } from '../../writing/services/LocalDocumentService';
import { LocalVersionService } from '../../writing/services/LocalVersionService';
import { DocumentService } from '../../writing/services/DocumentService';
import { SessionService } from '../../writing/services/SessionService';
import { getOrCreateGuestId } from '../../../shared/lib/localDb';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../../core/i18n';
import { ProfileHero } from '../components/ProfileHero';
import { KPIStrip } from '../components/KPIStrip';
import { StreakRibbon } from '../components/StreakRibbon';
import { Heatmap } from '../components/Heatmap';
import { HourRhythm } from '../components/HourRhythm';
import { Achievements } from '../components/Achievements';

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

  useEffect(() => {
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
        for (const doc of localDocs) {
          if (seenIds.has(doc.id)) continue;
          seenIds.add(doc.id);
          totalWords += doc.totalWords || 0;
          sessionsCount += doc.sessionsCount || 1;
          totalDuration += doc.totalDuration || 0;
          try {
            const versions = await LocalVersionService.getVersions(doc.id);
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
          } catch (verErr) {
            console.error('Error loading versions for doc', doc.id, verErr);
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

        setSessions(allSessions);
        setDocStats({ totalWords, sessionsCount, totalDuration });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('Profile load error:', err);
        setError(msg);
      } finally {
        setLoading(false);
      }
    };

    fetchSessions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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

      let streak = 0;
      const check = new Date();
      check.setHours(0, 0, 0, 0);
      while (dates.has(check.toDateString())) {
        streak++;
        check.setDate(check.getDate() - 1);
      }

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

  const handleResetAchievements = useCallback(() => {
    if (confirm(t('profile_ach_reset_confirm'))) {
      localStorage.removeItem('unlocked_achievements');
      setAchResetKey(k => k + 1);
    }
  }, [t]);

  if (loading) {
    return <div className="italic text-center py-24 text-text-main/50">{t('profile_loading')}</div>;
  }

  if (error) {
    return <div style={{ padding: 24, color: 'red' }}>Profile error: {error}</div>;
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
        <button onClick={handleResetAchievements} className="font-mono text-[11px] text-text-main/20 hover:text-red-400/50 transition-colors uppercase tracking-widest">
          {t('profile_ach_reset')}
        </button>
      </div>
    </div>
  );
}
