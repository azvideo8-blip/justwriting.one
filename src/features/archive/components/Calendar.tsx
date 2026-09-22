import { useState, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, subMonths, addMonths } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, getSessionDates } from '../../../core/utils/utils';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { ArchiveSession } from '../types';
import { useLanguage } from '../../../shared/i18n';
import { calculateQuartiles, levelOf, HEATMAP_BG_CLASSES } from '../utils/calendarHeatmap';

const EMPTY_WORDS: Record<string, number> = {};

interface CalendarProps {
  sessions: ArchiveSession[];
  sessionsByDate?: Record<string, number>;
  wordsByDate?: Record<string, number> | undefined;
  selectedDate: Date | null;
  onSelectDate: (date: Date | null) => void;
  onSelectMonth?: (month: Date) => void;
}

export function Calendar({ sessions, sessionsByDate, wordsByDate, selectedDate, onSelectDate, onSelectMonth }: CalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const { t, tp, language } = useLanguage();
  const locale = language === 'ru' ? ru : enUS;
  const start = startOfMonth(currentMonth);
  const end = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start, end });
  const startDay = start.getDay(); // 0 (Sun) to 6 (Sat)
  // Adjust for Monday start (0=Mon, ..., 6=Sun)
  const offset = (startDay === 0 ? 6 : startDay - 1);

  const activeDays = useMemo(() => sessions.flatMap(s => getSessionDates(s)), [sessions]);

  // Both mount points pass wordsByDate from useArchiveData; the empty map is
  // only for tests that render the calendar bare.
  const computedWordsByDate = wordsByDate ?? EMPTY_WORDS;

  // Compute quartiles across days of the visible month
  const monthThresholds = useMemo(() => {
    const monthValues = days.map(day => {
      const dateKey = format(day, 'yyyy-MM-dd');
      const words = computedWordsByDate[dateKey] ?? 0;
      if (words > 0) return words;
      return sessionsByDate ? (sessionsByDate[dateKey] ?? 0) : 0;
    });
    return calculateQuartiles(monthValues);
  }, [days, computedWordsByDate, sessionsByDate]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button onClick={() => onSelectMonth?.(currentMonth)} className="text-sm font-medium text-text-main px-1 capitalize transition-colors hover:text-text-main/70">{format(currentMonth, 'LLLL yyyy', { locale })}</Button>
        <div className="flex items-center gap-1">
          <IconButton onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-1 rounded transition-colors text-text-main/60 hover:bg-text-main/5 hover:text-text-main" label="Previous month" icon={<ChevronLeft size={18} />} />
          <IconButton onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-1 rounded transition-colors text-text-main/60 hover:bg-text-main/5 hover:text-text-main" label="Next month" icon={<ChevronRight size={18} />} />
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {['calendar_mon', 'calendar_tue', 'calendar_wed', 'calendar_thu', 'calendar_fri', 'calendar_sat', 'calendar_sun'].map((key, i) => (
          <div key={`${key}-${i}`} className="text-label text-text-main/60 uppercase tracking-wider text-center">{t(key)}</div>
        ))}
        {Array.from({ length: offset }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {days.map(day => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const sessionCount = sessionsByDate ? (sessionsByDate[dateKey] ?? 0) : (activeDays.some(ad => isSameDay(ad, day)) ? 1 : 0);
          const wordCount = computedWordsByDate[dateKey] ?? 0;
          const heatMetric = wordCount > 0 ? wordCount : sessionCount;
          const heatLevel = levelOf(heatMetric, monthThresholds);
          const hasSessions = sessionCount > 0;
          const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
          const today = isToday(day);

          let cellTitle: string | undefined = undefined;
          if (sessionCount > 0) {
            const notesStr = tp('archive_note_count', sessionCount);
            if (wordCount > 0) {
              const formattedWords = wordCount.toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US');
              const wordsStr = tp('archive_word_count', wordCount).replace(String(wordCount), formattedWords);
              cellTitle = `${notesStr} · ${wordsStr}`;
            } else {
              cellTitle = notesStr;
            }
          }

          return (
            <Button
              key={day.toString()}
              onClick={() => onSelectDate(day)}
              title={cellTitle}
              className={cn(
                "aspect-square w-full p-0 min-w-0 rounded-lg flex items-center justify-center text-xs md:text-sm transition-colors relative flex-col gap-0",
                HEATMAP_BG_CLASSES[heatLevel],
                heatLevel === 4
                  ? "text-surface-base font-semibold"
                  : hasSessions
                    ? "text-text-main font-medium"
                    : "text-text-main/60 hover:text-text-main/60 hover:bg-text-main/5",
                today && "ring-1 ring-text-main/40",
                isSelected && "ring-2 ring-text-main/50"
              )}
            >
              {format(day, 'd')}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
