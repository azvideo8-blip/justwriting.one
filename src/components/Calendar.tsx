import React, { useState } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, subMonths, addMonths } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, parseFirestoreDate } from '../core/utils/utils';
import { Session } from '../types';
import { useLanguage } from '../core/i18n';
import { useUI } from '../contexts/UIContext';

  interface CalendarProps {
  sessions: Session[];
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  onSelectMonth?: (d: Date) => void;
}

export function Calendar({ sessions, selectedDate, onSelectDate, onSelectMonth }: CalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const { language } = useLanguage();
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';
  const locale = language === 'ru' ? ru : enUS;
  const start = startOfMonth(currentMonth);
  const end = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start, end });

  const activeDays = sessions.map(s => parseFirestoreDate(s.createdAt));

  return (
    <div className={cn(
      "p-6 rounded-3xl transition-all space-y-6",
      isV2 
        ? "bg-white/5 backdrop-blur-xl border border-white/10 text-[#E5E5E0]" 
        : "bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-sm"
    )}>
      <div className="flex items-center justify-between">
        <button onClick={() => onSelectMonth?.(currentMonth)} className={cn("font-bold text-xl capitalize transition-colors", isV2 ? "text-white hover:text-white/70" : "dark:text-stone-100 hover:text-emerald-500")}>{format(currentMonth, 'LLLL yyyy', { locale })}</button>
        <div className="flex items-center gap-1">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className={cn("p-1 rounded transition-colors", isV2 ? "text-white/50 hover:bg-white/10 hover:text-white" : "hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400")}><ChevronLeft size={18} /></button>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className={cn("p-1 rounded transition-colors", isV2 ? "text-white/50 hover:bg-white/10 hover:text-white" : "hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400")}><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {(language === 'ru' ? ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']).map((d, i) => (
          <div key={`${d}-${i}`} className={cn("text-[10px] font-bold text-center py-1", isV2 ? "text-white/30" : "text-stone-300 dark:text-stone-600")}>{d}</div>
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
                  ? (isV2 ? "bg-white/20 text-white font-bold" : "bg-emerald-500 dark:bg-emerald-400 text-white dark:text-stone-900 font-bold") 
                  : (isV2 ? "text-white/50 hover:bg-white/10" : "text-stone-400 dark:text-stone-500 hover:bg-stone-50 dark:hover:bg-stone-800"),
                isSelected && !isActive && (isV2 ? "ring-1 ring-white/50 ring-offset-2 ring-offset-[#0A0A0B]" : "ring-2 ring-stone-900 dark:ring-stone-100 ring-offset-2 dark:ring-offset-stone-900"),
                isSelected && isActive && (isV2 ? "ring-1 ring-white ring-offset-2 ring-offset-[#0A0A0B]" : "ring-2 ring-emerald-500 ring-offset-2 dark:ring-offset-stone-900"),
                isToday(day) && !isActive && !isSelected && (isV2 ? "border border-white/30 text-white" : "border border-stone-900 dark:border-stone-100 text-stone-900 dark:text-stone-100")
              )}
            >
              {format(day, 'd')}
              {isActive && (
                <div className={cn("absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full", isV2 ? "bg-white" : "bg-white dark:bg-stone-900")} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
