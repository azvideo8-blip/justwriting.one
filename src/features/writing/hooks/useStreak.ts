import { useState, useEffect, useMemo, useRef } from 'react';
import { User } from 'firebase/auth';
import { Session } from '../../../types';
import { loadAllSessions } from '../services/UnifiedSessionLoader';
import { calculateStreak } from '../../../core/utils/utils';

export function useStreak(userId: string, user: User | null, isGuest: boolean): number {
  const [sessions, setSessions] = useState<Session[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    loadAllSessions(userId, user).then(result => {
      if (cancelled || !mountedRef.current) return;
      setSessions(result.sessions);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId, user, isGuest]);

  const streakDays = useMemo(() => {
    if (isGuest) return 0;
    return calculateStreak(sessions);
  }, [sessions, isGuest]);

  return streakDays;
}
