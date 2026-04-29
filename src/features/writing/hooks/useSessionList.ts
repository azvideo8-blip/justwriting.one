import { useState, useCallback } from 'react';
import { Session } from '../../../types';
import { SessionService } from '../services/SessionService';
import { useLanguage } from '../../../core/i18n';
import { LocalSessionInfo } from './useGuestWritingSession';

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

  const fetchAllSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const result = await SessionService.getAllSessions(userId, 50);
      const firestoreSessions = result.sessions;

      const localSessionsList = await fetchLocalSessions();
      const localSessions = await Promise.all(
        localSessionsList.map(async s => {
          const data = await loadLocalSession(s.id);
          return {
            id: s.id,
            userId: '',
            authorName: '',
            authorPhoto: '',
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

      setUserSessions([...firestoreSessions, ...localSessions]);
    } catch (e) {
      console.error('Error fetching sessions:', e);
    } finally {
      setLoadingSessions(false);
    }
  }, [userId, fetchLocalSessions, loadLocalSession, t]);

  return { userSessions, loadingSessions, fetchAllSessions };
}
