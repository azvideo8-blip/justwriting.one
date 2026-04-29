import { useState, useMemo } from 'react';
import { Session } from '../../../types';
import { useDebounce } from '../../../shared/hooks/useDebounce';

export function useArchiveSearch<T extends Session>(sessions: T[]) {
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  const searchedSessions = useMemo(() => {
    if (!debouncedSearchQuery) return sessions;
    return sessions.filter(s => 
      s.content.toLowerCase().includes(debouncedSearchQuery.toLowerCase()) || 
      s.title?.toLowerCase().includes(debouncedSearchQuery.toLowerCase())
    );
  }, [sessions, debouncedSearchQuery]);

  return {
    searchQuery,
    setSearchQuery,
    searchedSessions
  };
}
