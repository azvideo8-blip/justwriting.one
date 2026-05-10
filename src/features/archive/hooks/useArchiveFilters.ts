import { useState, useMemo } from 'react';
import { Session } from '../../../types';
import { getSessionDate } from '../../../core/utils/utils';
import { isSameDay } from 'date-fns';

export function useArchiveFilters<T extends Session>(sessions: T[]) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<Date | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);

  const toggleLabel = (labelId: string) => {
    setSelectedLabels(prev => prev.includes(labelId) ? prev.filter(id => id !== labelId) : [...prev, labelId]);
  };

  const filteredSessions = useMemo(() => {
    return sessions.filter(s => {
      const sDate = getSessionDate(s);
      if (!sDate) return false;
      const matchesDate = !selectedDate || isSameDay(sDate, selectedDate);
      const matchesMonth = !selectedMonth || (sDate.getMonth() === selectedMonth.getMonth() && sDate.getFullYear() === selectedMonth.getFullYear());
      const matchesTags = selectedTags.length === 0 || selectedTags.every(t => s.tags?.includes(t));
      const matchesLabels = selectedLabels.length === 0 || selectedLabels.includes(s.labelId ?? '');
      return matchesDate && matchesMonth && matchesTags && matchesLabels;
    });
  }, [sessions, selectedDate, selectedMonth, selectedTags, selectedLabels]);

  return {
    selectedDate,
    setSelectedDate,
    selectedMonth,
    setSelectedMonth,
    selectedTags,
    setSelectedTags,
    selectedLabels,
    setSelectedLabels,
    toggleLabel,
    filteredSessions
  };
}
