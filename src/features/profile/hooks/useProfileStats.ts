import { useState, useEffect, useCallback } from 'react';
import type { AppUser } from '../../../core/auth/types';
import { Session } from '../../../types';
import { loadAllSessions } from '../../../core/services/UnifiedSessionLoader';
import { calculateStreak, consumeStreakFreezes, getActiveDayKeys } from '../../../core/utils/utils';
import { syncStreakFreezesWithCloud } from '../../../core/utils/streakFreeze';
import { toTimestampMs } from '../../../core/utils/dateUtils';
import { reportError } from '../../../shared/errors/reportError';
import { loadState, type LoadState } from '../../../shared/loadState';

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

export interface ProfileStatsData {
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
        if (s.sittings && s.sittings.length > 0) {
          s.sittings.forEach(sitting => {
            const ts = sitting.savedAt || sitting.sessionStartedAt;
            if (!ts) return;
            const d = new Date(ts);
            if (isNaN(d.getTime())) return;
            dates.add(d.toDateString());
            const h = d.getHours();
            if (!isNaN(h) && h >= 0 && h < 24) {
              const val = hours[h];
              if (val !== undefined) hours[h] = val + 1;
            }
          });
        } else {
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
        }
      } catch (e) { reportError(e, { action: 'parseSessionDate' }, 'warning'); }
    });

    // День, поставленный заметке вручную, — тот же набор, что у числа серии.
    for (const key of getActiveDayKeys(sessions)) dates.add(key);

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

/** Прочитано целиком, записей нет: нули для экранов, где «пусто» — те же виджеты. */
export const EMPTY_PROFILE_STATS: ProfileStatsData = { sessions: [], stats: EMPTY_STATS, streak: 0, kpiStats: EMPTY_KPI };

const hasNoSessions = (data: ProfileStatsData) => data.sessions.length === 0;

export function useProfileStats(userId: string, user: AppUser | null) {
  // Одно состояние вместо loading/error/cloudLoadFailed/sessions порознь:
  // нули статистики нельзя нарисовать, не разобрав ошибку (shared/loadState).
  const [state, setState] = useState<LoadState<ProfileStatsData>>(loadState.loading());
  const [fetchKey, setFetchKey] = useState(0);

  // Повтор едет внутри состояния (error.retry, partial.retry): экрану не из чего
  // собрать ошибку без выхода.
  const refresh = useCallback(() => {
    profileStatsCache.delete(userId);
    setFetchKey(k => k + 1);
  }, [userId]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const cached = profileStatsCache.get(userId);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        if (cancelled) return;
        setState(loadState.settled(cached.data, hasNoSessions));
        return;
      }

      // Тот же объект, если уже читаем: новый объект на каждый запуск эффекта
      // при нестабильном `user` даёт бесконечный рендер (setLoading(true) его глушил сам).
      setState(prev => (prev.status === 'loading' ? prev : loadState.loading()));
      try {
        const result = await loadAllSessions(userId, user);
        if (cancelled) return;
        if (user && !userId.startsWith('guest')) {
          try {
            await syncStreakFreezesWithCloud(userId);
          } catch {
            // offline fallback
          }
        }
        if (cancelled) return;
        const loaded = result.sessions as StatsSession[];
        const docStats = computeDocStats(loaded);
        const frozen = consumeStreakFreezes(result.sessions, userId);
        const streakVal = calculateStreak(result.sessions, frozen, userId);
        const kpi = computeKPIStats(result.sessions, docStats);
        const data: ProfileStatsData = {
          sessions: result.sessions,
          stats: docStats,
          streak: streakVal,
          kpiStats: kpi,
        };
        // D-2: облако не прочиталось — статистика только по устройству, в кэш не кладём.
        if (!result.cloudLoadFailed) profileStatsCache.set(userId, { data, timestamp: Date.now() });
        setState(loadState.settled(data, hasNoSessions, result.cloudLoadFailed ? { retry: refresh } : null));
      } catch (err) {
        if (cancelled) return;
        reportError(err, { page: 'profileStats', userId: user?.uid ?? 'guest' });
        setState(loadState.error(refresh));
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [userId, user, fetchKey, refresh]);

  return state;
}
