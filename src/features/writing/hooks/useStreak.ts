import { useMemo } from 'react';
import { Session } from '../../../types';
import { calculateStreak } from '../../../core/utils/utils';

export function useStreak(sessionGroups: { date: Date; sessions: Session[] }[]): number {
  return useMemo(() => {
    const sessions = sessionGroups.flatMap(g => g.sessions);
    return calculateStreak(sessions);
  }, [sessionGroups]);
}
