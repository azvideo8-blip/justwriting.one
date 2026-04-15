import { useState } from 'react';
import { Session } from '../../../types';
import { SessionService } from '../services/SessionService';
import { useLanguage } from '../../../core/i18n';

interface UseSessionListReturn {
  userSessions: Session[];
  loadingSessions: boolean;
  fetchAllSessions: () => Promise<void>;
}

export function useSessionList(
  userId: string,
  fetchLocalSessions: () => { id: string }[],
  loadLocalSession: (id: string) => Record<string, unknown> | null,
): UseSessionListReturn {
  const [userSessions, setUserSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const { t } = useLanguage();

  const fetchAllSessions = async () => {
    setLoadingSessions(true);
    try {
      const result = await SessionService.getAllSessions(userId, 50);
      const firestoreSessions = result.sessions;

      const localSessions = fetchLocalSessions().map(s => {
        const data = loadLocalSession(s.id);
        return {
          ...s,
          title: data?.title || t('writing_local_session'),
          content: data?.content || '',
          wordCount: data?.wordCount || 0,
          duration: data?.duration || 0,
          isLocal: true,
        };
      });

      setUserSessions([...firestoreSessions, ...localSessions] as Session[]);
    } catch (e) {
      console.error('Error fetching sessions:', e);
    } finally {
      setLoadingSessions(false);
    }
  };

  return { userSessions, loadingSessions, fetchAllSessions };
}
