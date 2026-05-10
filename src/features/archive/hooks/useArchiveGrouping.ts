import { useMemo } from 'react';
import { format } from 'date-fns';
import { ArchiveSession } from '../types';

export function useArchiveGrouping(filteredSessions: ArchiveSession[]) {
  const groupedSessions = useMemo(() => {
    return filteredSessions.reduce((acc, session) => {
      const d = session.sessionStartTime ? new Date(session.sessionStartTime) : (session.createdAt instanceof Date ? session.createdAt : null);
      if (!d) return acc;
      const dateKey = format(d, 'yyyy-MM-dd');
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(session);
      return acc;
    }, {} as Record<string, ArchiveSession[]>);
  }, [filteredSessions]);

  const sortedDates = useMemo(() => Object.keys(groupedSessions).sort((a, b) => new Date(b).getTime() - new Date(a).getTime()), [groupedSessions]);

  return { groupedSessions, sortedDates };
}
