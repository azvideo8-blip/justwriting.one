import React, { useState } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, subMonths, addMonths } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, parseFirestoreDate, getSessionDate } from '../../../core/utils/utils';
import { Session } from '../../../types';
import { useLanguage } from '../../../core/i18n';

interface CalendarProps {
  sessions: Session[];
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  onSelectMonth?: (d: Date) => void;
}

export function Calendar({ sessions, selectedDate, onSelectDate, onSelectMonth }: CalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const { language } = useLanguage();
  const locale = language === 'ru' ? ru : enUS;
  const start = startOfMonth(currentMonth);
  const end = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start, end });
  const startDay = start.getDay(); // 0 (Sun) to 6 (Sat)
  // Adjust for Monday start (0=Mon, ..., 6=Sun)
  const offset = (startDay === 0 ? 6 : startDay - 1);

  const activeDays = sessions.map(s => getSessionDate(s));

  return (
    <div className="p-6 rounded-3xl transition-all space-y-6 bg-surface-card backdrop-blur-xl border border-border-subtle shadow-sm">
      <div className="flex items-center justify-between">
        <button onClick={() => onSelectMonth?.(currentMonth)} className="font-bold text-xl capitalize transition-colors text-text-main hover:text-text-main/70">{format(currentMonth, 'LLLL yyyy', { locale })}</button>
        <div className="flex items-center gap-1">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-1 rounded transition-colors text-text-main/50 hover:bg-surface-base/10 hover:text-text-main"><ChevronLeft size={18} /></button>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-1 rounded transition-colors text-text-main/50 hover:bg-surface-base/10 hover:text-text-main"><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {(language === 'ru' ? ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']).map((d, i) => (
          <div key={`${d}-${i}`} className="text-[11px] font-bold text-center py-1 text-text-main/40">{d}</div>
        ))}
        {Array.from({ length: offset }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {days.map(day => {
          const isActive = activeDays.some(ad => isSameDay(ad, day));
          const isSelected = isSameDay(day, selectedDate);
          return (
            <button 
              key={day.toString()}
              onClick={() => onSelectDate(day)}
              className={cn(
                "aspect-square rounded-lg flex items-center justify-center text-xs transition-all relative",
                isActive 
                  ? "bg-text-main/20 text-text-main font-bold" 
                  : "text-text-main/50 hover:bg-surface-base/10",
                isSelected && !isActive && "ring-1 ring-text-main/50 ring-offset-2 ring-offset-surface-base",
                isSelected && isActive && "ring-1 ring-text-main ring-offset-2 ring-offset-surface-base",
                isToday(day) && !isActive && !isSelected && "border border-text-main/40 text-text-main"
              )}
            >
              {format(day, 'd')}
              {isActive && (
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-text-main" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
