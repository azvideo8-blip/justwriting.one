import { useState, useCallback, useEffect, useRef } from 'react';
import { Session } from '../../../types';
import { SessionService } from '../../../core/services/SessionService';
import { useLanguage } from '../../../core/i18n';
import { LocalSessionInfo } from '../types/session';
import { reportError } from '../../../core/errors/reportError';

interface UseSessionListReturn {
  userSessions: Session[];
  loadingSessions: boolean;
  fetchAllSessions: () => Promise<void>;
}

export function useSessionList(
  userId: string,
  fetchLocalSessions: () => Promise<LocalSessionInfo[]>,
  loadLocalSession: (id: string) => Promise<Record<string, unknown> | null>,
): UseSessionListReturn {
  const [userSessions, setUserSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const { t } = useLanguage();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const fetchAllSessions = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoadingSessions(true);
    try {
      const result = await SessionService.getAllSessions(userId, 50);
      if (ac.signal.aborted) return;
      const firestoreSessions = result.sessions;

      const localSessionsList = await fetchLocalSessions();
      if (ac.signal.aborted) return;
      const localResults = await Promise.allSettled(
        localSessionsList.map(async s => {
          const data = await loadLocalSession(s.id);
          return {
            id: s.id,
            userId: '',
            content: (data?.content as string) || '',
            duration: (data?.duration as number) || s.duration || 0,
            wordCount: (data?.wordCount as number) || s.wordCount || 0,
            charCount: 0,
            wpm: 0,
            title: (data?.title as string) || t('writing_local_session'),
            tags: (data?.tags as string[]) || [],
            createdAt: s.createdAt,
            _isLocal: true,
          } as Session;
        })
      );

      const localSessions = localResults
        .filter((r): r is PromiseFulfilledResult<Session> => r.status === 'fulfilled')
        .map(r => r.value);

      if (ac.signal.aborted) return;
      setUserSessions([...firestoreSessions, ...localSessions]);
    } catch (e) {
      if (ac.signal.aborted) return;
      reportError(e, { action: 'sessionList/fetchAll' });
    } finally {
      if (!ac.signal.aborted) setLoadingSessions(false);
    }
  }, [userId, fetchLocalSessions, loadLocalSession, t]);

  return { userSessions, loadingSessions, fetchAllSessions };
}
