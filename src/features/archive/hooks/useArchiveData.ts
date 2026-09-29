import { useMemo } from 'react';
import type { AppUser } from '../../../core/auth/types';
import { format } from 'date-fns';
import { Label } from '../../../types';
import { useArchiveFilters } from './useArchiveFilters';
import { useArchiveSearch } from './useArchiveSearch';
import { useArchiveSessions } from './useArchiveSessions';
import { useArchiveWordCloud } from './useArchiveWordCloud';
import { useArchiveGrouping } from './useArchiveGrouping';
import { getDateLocale } from '../../../core/utils/dateUtils';

export function useArchiveData(user: AppUser | null, userId: string, t: (key: string) => string, language: string, labels?: Label[]) {
  const sessionsData = useArchiveSessions(user, userId, t);

  const {
    selectedDate, setSelectedDate,
    selectedMonth, setSelectedMonth,
    selectedTags, setSelectedTags,
    selectedLabels, setSelectedLabels, toggleLabel,
    filteredSessions: filteredByFilters
  } = useArchiveFilters(sessionsData.activeSessions);
  const {
    searchQuery, setSearchQuery,
    searchedSessions: filteredSessions
  } = useArchiveSearch(filteredByFilters);

  const allTags = useMemo(() => Array.from(new Set(sessionsData.activeSessions.flatMap(s => s.tags || []))), [sessionsData.activeSessions]);

  const { tagCounts, labelCounts } = useMemo(() => {
    const tags: Record<string, number> = {};
    const labels: Record<string, number> = {};
    for (const s of sessionsData.activeSessions) {
      if (s.tags) {
        for (const tag of s.tags) {
          tags[tag] = (tags[tag] || 0) + 1;
        }
      }
      if (s.labelId) {
        labels[s.labelId] = (labels[s.labelId] || 0) + 1;
      }
    }
    return { tagCounts: tags, labelCounts: labels };
  }, [sessionsData.activeSessions]);

  const sessionsByDate = useMemo(() => {
    const map: Record<string, number> = {};
    sessionsData.activeSessions.forEach(s => {
      const d = s.sessionStartTime ? new Date(s.sessionStartTime) : (s.createdAt instanceof Date ? s.createdAt : null);
      if (!d) return;
      const key = format(d, 'yyyy-MM-dd');
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [sessionsData.activeSessions]);

  const wordsByDate = useMemo(() => {
    const map: Record<string, number> = {};
    sessionsData.activeSessions.forEach(s => {
      const d = s.sessionStartTime ? new Date(s.sessionStartTime) : (s.createdAt instanceof Date ? s.createdAt : null);
      if (!d) return;
      const key = format(d, 'yyyy-MM-dd');
      map[key] = (map[key] || 0) + (s.sessionWordsAdded || s.wordCount || 0);
    });
    return map;
  }, [sessionsData.activeSessions]);

  const statsTitle = useMemo(() => {
    if (selectedLabels.length > 0) {
      const names = selectedLabels.map(id => labels?.find(l => l.id === id)?.name).filter(Boolean);
      return names.length > 0 ? names.join(', ') : t('archive_stats_title');
    }
    if (selectedTags.length > 0) {
      return t('archive_stats_by_tag') + ' ' + selectedTags.map(t => '#' + t).join(', ');
    }
    if (selectedMonth) {
      return t('archive_stats_by_month') + ' ' + format(selectedMonth, 'LLLL yyyy', { locale: getDateLocale(language) });
    }
    return t('archive_stats_title');
  }, [selectedLabels, selectedTags, selectedMonth, t, language, labels]);

  const hasActiveFilter = selectedTags.length > 0 || selectedLabels.length > 0 || !!selectedMonth || !!selectedDate;

  const resetStatsFilter = () => {
    setSelectedTags([]);
    setSelectedLabels([]);
    setSelectedMonth(null);
    setSelectedDate(null);
  };

  const { wordCloud, maxCount } = useArchiveWordCloud();
  const { groupedSessions, sortedDates } = useArchiveGrouping(filteredSessions);

  const dateLocale = getDateLocale(language);

  return {
    ...sessionsData,
    allTags, tagCounts, labelCounts, filteredByFilters, filteredSessions,
    searchQuery, setSearchQuery,
    selectedDate, setSelectedDate,
    selectedMonth, setSelectedMonth,
    selectedTags, setSelectedTags,
    selectedLabels, setSelectedLabels, toggleLabel,
    statsTitle, hasActiveFilter, resetStatsFilter,
    sessionsByDate, wordsByDate, wordCloud, maxCount,
    groupedSessions, sortedDates, dateLocale,
  };
}
