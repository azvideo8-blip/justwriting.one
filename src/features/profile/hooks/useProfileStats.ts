import { useState, useEffect, useCallback } from 'react';
import { User } from 'firebase/auth';
import { Session } from '../../../types';
import { loadAllSessions } from '../../../core/services/UnifiedSessionLoader';
import { calculateStreak } from '../../../core/utils/utils';
import { toTimestampMs } from '../../../core/utils/dateUtils';
import { reportError } from '../../../shared/errors/reportError';

interface StatsSession extends Session {
  _totalWords?: number;
  _sessionsCount?: number;
  _totalDuration?: number;
}

export interface DocLevelStats {
  totalWords: number;
  sessionsCount: number;
  totalDuration: number;
}

export interface KPIStats {
  totalWords: number;
  streakDays: number;
  sessionsCount: number;
  avgSessionMins: number;
  typicalHour: string;
  wordsPerDay: number;
}

interface ProfileStatsData {
  sessions: Session[];
  stats: DocLevelStats;
  streak: number;
  kpiStats: KPIStats;
}

interface CachedEntry {
  data: ProfileStatsData;
  timestamp: number;
}

const CACHE_TTL_MS = 30_000;
const profileStatsCache = new Map<string, CachedEntry>();

const EMPTY_STATS: DocLevelStats = { totalWords: 0, sessionsCount: 0, totalDuration: 0 };
const EMPTY_KPI: KPIStats = { totalWords: 0, streakDays: 0, sessionsCount: 0, avgSessionMins: 0, typicalHour: '—', wordsPerDay: 0 };

function computeDocStats(sessions: StatsSession[]): DocLevelStats {
  let totalWords = 0;
  let sessionsCount = 0;
  let totalDuration = 0;
  for (const s of sessions) {
    totalWords += s._totalWords ?? s.wordCount ?? 0;
    sessionsCount += s._sessionsCount ?? 1;
    totalDuration += s._totalDuration ?? s.duration ?? 0;
  }
  return { totalWords, sessionsCount, totalDuration };
}

function computeKPIStats(sessions: Session[], docStats: DocLevelStats): KPIStats {
  try {
    const dates = new Set<string>();
    const hours: number[] = Array.from({ length: 24 }, () => 0);

    sessions.forEach(s => {
      try {
        const ts = s.sessionStartTime ?? toTimestampMs(s.createdAt);
        if (!ts) return;
        const d = new Date(ts);
        if (isNaN(d.getTime())) return;
        dates.add(d.toDateString());
        const h = d.getHours();
        if (!isNaN(h) && h >= 0 && h < 24) {
          const val = hours[h];
          if (val !== undefined) hours[h] = val + 1;
        }
      } catch (e) { reportError(e, { action: 'parseSessionDate' }, 'warning'); }
    });

    const streak = calculateStreak(sessions);
    const avgMins = docStats.sessionsCount
      ? Math.round(docStats.totalDuration / docStats.sessionsCount / 60)
      : 0;

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
    return { ...EMPTY_KPI };
  }
}

export function useProfileStats(userId: string, user: User | null) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<DocLevelStats>(EMPTY_STATS);
  const [streak, setStreak] = useState(0);
  const [kpiStats, setKpiStats] = useState<KPIStats>(EMPTY_KPI);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const cached = profileStatsCache.get(userId);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        if (cancelled) return;
        setSessions(cached.data.sessions);
        setStats(cached.data.stats);
        setStreak(cached.data.streak);
        setKpiStats(cached.data.kpiStats);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const result = await loadAllSessions(userId, user);
        if (cancelled) return;
        const loaded = result.sessions as StatsSession[];
        const docStats = computeDocStats(loaded);
        const streakVal = calculateStreak(result.sessions);
        const kpi = computeKPIStats(result.sessions, docStats);
        const data: ProfileStatsData = {
          sessions: result.sessions,
          stats: docStats,
          streak: streakVal,
          kpiStats: kpi,
        };
        profileStatsCache.set(userId, { data, timestamp: Date.now() });
        setSessions(data.sessions);
        setStats(data.stats);
        setStreak(data.streak);
        setKpiStats(data.kpiStats);
      } catch (err) {
        if (cancelled) return;
        reportError(err, { page: 'profileStats', userId: user?.uid ?? 'guest' });
        setError('load_failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [userId, user, fetchKey]);

  const refresh = useCallback(() => {
    profileStatsCache.delete(userId);
    setFetchKey(k => k + 1);
  }, [userId]);

  return { sessions, stats, streak, kpiStats, loading, error, refresh };
}
