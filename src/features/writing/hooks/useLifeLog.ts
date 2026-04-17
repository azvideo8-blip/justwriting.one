import { useState, useEffect, useCallback, useMemo } from 'react';
import { Session } from '../../../types';
import { SessionService } from '../services/SessionService';
import { parseFirestoreDate } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';

interface DailySummary {
  totalWords: number;
  totalMinutes: number;
}

interface SessionGroup {
  label: string;
  date: Date;
  sessions: Session[];
}

interface UseLifeLogReturn {
  sessionGroups: SessionGroup[];
  summary: DailySummary;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useLifeLog(userId: string): UseLifeLogReturn {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useLanguage();

  const startOfToday = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await SessionService.getAllSessions(userId, 100);
      setSessions(result.sessions);
    } catch (e) {
      console.error('useLifeLog fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const todaySessions = sessions.filter(s => {
    const date = parseFirestoreDate(s.createdAt);
    return date && date >= startOfToday;
  });

  const summary: DailySummary = {
    totalWords: todaySessions.reduce((sum, s) => sum + (s.wordCount || 0), 0),
    totalMinutes: Math.round(todaySessions.reduce((sum, s) => sum + (s.duration || 0), 0) / 60),
  };

  const sessionGroups = useMemo(() => {
    const groups = new Map<string, SessionGroup>();
    const yesterday = new Date(startOfToday);
    yesterday.setDate(yesterday.getDate() - 1);

    sessions.forEach(session => {
      const date = parseFirestoreDate(session.createdAt);
      if (!date) return;

      const sessionDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const key = sessionDay.toISOString();

      if (!groups.has(key)) {
        let label: string;
        if (sessionDay.getTime() === startOfToday.getTime()) {
          label = t('lifelog_group_today');
        } else if (sessionDay.getTime() === yesterday.getTime()) {
          label = t('lifelog_group_yesterday');
        } else {
          label = date.toLocaleDateString('ru', {
            day: 'numeric',
            month: 'long',
          });
        }
        groups.set(key, { label, date: sessionDay, sessions: [] });
      }

      groups.get(key)!.sessions.push(session);
    });

    return Array.from(groups.values())
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [sessions, startOfToday, t]);

  return {
    sessionGroups,
    summary,
    loading,
    refresh: fetchSessions,
  };
}
