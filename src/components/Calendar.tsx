import React, { useState } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, subMonths, addMonths } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, parseFirestoreDate } from '../lib/utils';
import { Session } from '../types';
import { useLanguage } from '../lib/i18n';

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

  const activeDays = sessions.map(s => parseFirestoreDate(s.createdAt));

  return (
    <div className="bg-white dark:bg-stone-900 p-6 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm space-y-6">
      <div className="flex items-center justify-between">
        <button onClick={() => onSelectMonth?.(currentMonth)} className="font-bold text-xl dark:text-stone-100 capitalize hover:text-emerald-500 transition-colors">{format(currentMonth, 'LLLL yyyy', { locale })}</button>
        <div className="flex items-center gap-1">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-1 hover:bg-stone-100 dark:hover:bg-stone-800 rounded transition-colors text-stone-400"><ChevronLeft size={18} /></button>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-1 hover:bg-stone-100 dark:hover:bg-stone-800 rounded transition-colors text-stone-400"><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {(language === 'ru' ? ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']).map((d, i) => (
          <div key={`${d}-${i}`} className="text-[10px] font-bold text-stone-300 dark:text-stone-600 text-center py-1">{d}</div>
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
                isActive ? "bg-emerald-500 dark:bg-emerald-400 text-white dark:text-stone-900 font-bold" : "text-stone-400 dark:text-stone-500 hover:bg-stone-50 dark:hover:bg-stone-800",
                isSelected && !isActive && "ring-2 ring-stone-900 dark:ring-stone-100 ring-offset-2 dark:ring-offset-stone-900",
                isSelected && isActive && "ring-2 ring-emerald-500 ring-offset-2 dark:ring-offset-stone-900",
                isToday(day) && !isActive && !isSelected && "border border-stone-900 dark:border-stone-100 text-stone-900 dark:text-stone-100"
              )}
            >
              {format(day, 'd')}
              {isActive && (
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-white dark:bg-stone-900 rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
