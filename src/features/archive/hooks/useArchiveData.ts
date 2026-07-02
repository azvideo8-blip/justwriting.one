import { useMemo } from 'react';
import { User } from 'firebase/auth';
import { format } from 'date-fns';
import { Label } from '../../../types';
import { useArchiveFilters } from './useArchiveFilters';
import { useArchiveSearch } from './useArchiveSearch';
import { useArchiveSessions } from './useArchiveSessions';
import { useArchiveWordCloud } from './useArchiveWordCloud';
import { useArchiveGrouping } from './useArchiveGrouping';
import { getDateLocale } from '../../../core/utils/dateUtils';

export function useArchiveData(user: User | null, userId: string, t: (key: string) => string, language: string, labels?: Label[]) {
  const sessionsData = useArchiveSessions(user, userId, t);

  const {
    selectedDate, setSelectedDate,
    selectedMonth, setSelectedMonth,
    selectedTags, setSelectedTags,
    selectedLabels, setSelectedLabels, toggleLabel,
    filteredSessions: filteredByFilters
  } = useArchiveFilters(sessionsData.sessions);
  const {
    searchQuery, setSearchQuery,
    searchedSessions: filteredSessions
  } = useArchiveSearch(filteredByFilters);

  const allTags = useMemo(() => Array.from(new Set(sessionsData.sessions.flatMap(s => s.tags || []))), [sessionsData.sessions]);

  const sessionsByDate = useMemo(() => {
    const map: Record<string, number> = {};
    sessionsData.sessions.forEach(s => {
      const d = s.sessionStartTime ? new Date(s.sessionStartTime) : (s.createdAt instanceof Date ? s.createdAt : null);
      if (!d) return;
      const key = format(d, 'yyyy-MM-dd');
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [sessionsData.sessions]);

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

  const entriesLabel = (n: number) =>
    language === 'ru'
      ? n === 1 ? t('archive_entry_1') :
        n >= 2 && n <= 4 ? t('archive_entry_2') :
        t('archive_entry_5')
      : n === 1 ? t('archive_entry_1') : t('archive_entry_2');

  return {
    ...sessionsData,
    allTags, filteredByFilters, filteredSessions,
    searchQuery, setSearchQuery,
    selectedDate, setSelectedDate,
    selectedMonth, setSelectedMonth,
    selectedTags, setSelectedTags,
    selectedLabels, setSelectedLabels, toggleLabel,
    statsTitle, hasActiveFilter, resetStatsFilter,
    sessionsByDate, wordCloud, maxCount,
    groupedSessions, sortedDates, dateLocale, entriesLabel,
  };
}
