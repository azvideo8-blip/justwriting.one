import { useState, useMemo } from 'react';
import Fuse from 'fuse.js';
import { Session } from '../../../types';
import { useDebounce } from '../../../shared/hooks/useDebounce';

export function useArchiveSearch<T extends Session>(sessions: T[]) {
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Memoize the Fuse instance so it only gets re-created when the sessions list changes
  const fuse = useMemo(() => {
    return new Fuse(sessions, {
      keys: [
        { name: 'title', weight: 0.7 },
        { name: 'content', weight: 0.5 },
        { name: 'tags', weight: 0.4 }
      ],
      threshold: 0.35,
      ignoreLocation: true
    });
  }, [sessions]);

  const searchedSessions = useMemo(() => {
    if (!debouncedSearchQuery.trim()) return sessions;
    const results = fuse.search(debouncedSearchQuery);
    return results.map(r => r.item);
  }, [sessions, debouncedSearchQuery, fuse]);

  return {
    searchQuery,
    setSearchQuery,
    searchedSessions
  };
}
