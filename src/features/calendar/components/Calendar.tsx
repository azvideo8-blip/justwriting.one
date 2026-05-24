import React, { useState, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, subMonths, addMonths } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, getSessionDate } from '../../../core/utils/utils';
import { Session } from '../../../types';
import { useLanguage } from '../../../core/i18n';

interface CalendarProps {
  sessions: Session[];
  sessionsByDate?: Record<string, number>;
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  onSelectMonth?: (d: Date) => void;
}

export function Calendar({ sessions, sessionsByDate, selectedDate, onSelectDate, onSelectMonth }: CalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const { t, language } = useLanguage();
  const locale = language === 'ru' ? ru : enUS;
  const start = startOfMonth(currentMonth);
  const end = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start, end });
  const startDay = start.getDay(); // 0 (Sun) to 6 (Sat)
  // Adjust for Monday start (0=Mon, ..., 6=Sun)
  const offset = (startDay === 0 ? 6 : startDay - 1);

  const activeDays = useMemo(() => sessions.map(s => getSessionDate(s)).filter((d): d is Date => d !== null), [sessions]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => onSelectMonth?.(currentMonth)} className="text-sm font-medium text-text-main px-1 capitalize transition-colors hover:text-text-main/70">{format(currentMonth, 'LLLL yyyy', { locale })}</button>
        <div className="flex items-center gap-1">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-1 rounded transition-colors text-text-main/50 hover:bg-text-main/5 hover:text-text-main"><ChevronLeft size={18} /></button>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-1 rounded transition-colors text-text-main/50 hover:bg-text-main/5 hover:text-text-main"><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {['calendar_mon', 'calendar_tue', 'calendar_wed', 'calendar_thu', 'calendar_fri', 'calendar_sat', 'calendar_sun'].map((key, i) => (
          <div key={`${key}-${i}`} className="text-label text-text-main/30 uppercase tracking-wider text-center">{t(key)}</div>
        ))}
        {Array.from({ length: offset }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {days.map(day => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const sessionCount = sessionsByDate?.[dateKey] ?? (activeDays.some(ad => isSameDay(ad, day)) ? 1 : 0);
          const hasSessions = sessionCount > 0;
          const isSelected = isSameDay(day, selectedDate);
          const today = isToday(day);
          return (
            <button 
              key={day.toString()}
              onClick={() => onSelectDate(day)}
              className={cn(
                "aspect-square rounded-lg flex items-center justify-center text-sm transition-colors relative flex-col gap-0",
                hasSessions 
                  ? "text-text-main/80 font-medium" 
                  : "text-text-main/20 hover:text-text-main/40",
                today && !hasSessions && "bg-text-main/10 border border-text-main/20 rounded-lg text-text-main",
                isSelected && "ring-2 ring-text-main/30"
              )}
            >
              {format(day, 'd')}
              {sessionCount > 0 && (
                <div className="flex gap-0.5 justify-center mt-0.5">
                  {Array.from({ length: Math.min(sessionCount, 3) }).map((_, i) => (
                    <div
                      key={i}
                      className="w-1 h-1 rounded-full opacity-70"
                      style={{ background: 'var(--flow-pulse-color, oklch(0.72 0.13 155))' }}
                    />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
