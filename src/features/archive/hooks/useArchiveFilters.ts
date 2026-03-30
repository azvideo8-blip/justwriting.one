import { useState, useMemo } from 'react';
import { Session } from '../../../types';
import { parseFirestoreDate } from '../../../core/utils/utils';
import { isSameDay } from 'date-fns';

export function useArchiveFilters(sessions: Session[]) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [selectedMonth, setSelectedMonth] = useState<Date | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const filteredSessions = useMemo(() => {
    return sessions.filter(s => {
      const sDate = parseFirestoreDate(s.createdAt);
      const matchesDate = !selectedDate || isSameDay(sDate, selectedDate);
      const matchesMonth = !selectedMonth || (sDate.getMonth() === selectedMonth.getMonth() && sDate.getFullYear() === selectedMonth.getFullYear());
      const matchesTags = selectedTags.length === 0 || selectedTags.every(t => s.tags?.includes(t));
      return matchesDate && matchesMonth && matchesTags;
    });
  }, [sessions, selectedDate, selectedMonth, selectedTags]);

  return {
    selectedDate,
    setSelectedDate,
    selectedMonth,
    setSelectedMonth,
    selectedTags,
    setSelectedTags,
    filteredSessions
  };
}
