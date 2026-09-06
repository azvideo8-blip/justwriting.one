import { useState, useMemo } from 'react';
import { isSameDay } from 'date-fns';
import { getSessionDates } from '../../../core/utils/utils';
import { ArchiveSession } from '../types';

export function useArchiveFilters(sessions: ArchiveSession[]) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<Date | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);

  const toggleLabel = (labelId: string) => {
    setSelectedLabels(prev => prev.includes(labelId) ? prev.filter(id => id !== labelId) : [...prev, labelId]);
  };

  const filteredSessions = useMemo(() => {
    return sessions.filter(s => {
      const dates = getSessionDates(s);
      if (dates.length === 0) return false;
      const matchesDate = !selectedDate || dates.some(d => isSameDay(d, selectedDate));
      const matchesMonth = !selectedMonth || dates.some(d => d.getMonth() === selectedMonth.getMonth() && d.getFullYear() === selectedMonth.getFullYear());
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
