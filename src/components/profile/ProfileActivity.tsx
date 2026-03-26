import React from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { SessionChart } from '../SessionChart';
import { Session } from '../../types';
import { useUI } from '../../contexts/UIContext';
import { cn } from '../../lib/utils';

interface ProfileActivityProps {
  sessions: Session[];
  startDate: Date;
  endDate: Date;
  onStartDateChange: (date: Date) => void;
  onEndDateChange: (date: Date) => void;
}

export function ProfileActivity({ sessions, startDate, endDate, onStartDateChange, onEndDateChange }: ProfileActivityProps) {
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';

  return (
    <div className={cn(
      "p-8 rounded-3xl transition-all space-y-6",
      isV2 
        ? "bg-[#0A0A0B]/80 backdrop-blur-2xl border border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.8)]" 
        : "bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-sm"
    )}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className={cn("text-xl font-bold", isV2 ? "text-white" : "dark:text-stone-100")}>Активность</h3>
          <p className={cn("text-xs font-medium", isV2 ? "text-white/50" : "text-stone-400")}>
            {format(startDate, 'd MMM')} — {format(endDate, 'd MMM')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn(
            "flex items-center gap-2 p-1 rounded-xl border",
            isV2 ? "bg-white/5 border-white/10" : "bg-stone-50 dark:bg-stone-800 border-stone-100 dark:border-stone-700"
          )}>
            <div className="flex items-center gap-1 px-2">
              <CalendarIcon size={12} className={isV2 ? "text-white/50" : "text-stone-400"} />
              <input 
                type="date" 
                value={format(startDate, 'yyyy-MM-dd')}
                onChange={(e) => onStartDateChange(new Date(e.target.value))}
                className={cn("bg-transparent text-[10px] font-bold outline-none", isV2 ? "text-white" : "dark:text-stone-100")}
              />
            </div>
            <div className={cn("w-px h-4", isV2 ? "bg-white/10" : "bg-stone-200 dark:bg-stone-700")} />
            <div className="flex items-center gap-1 px-2">
              <input 
                type="date" 
                value={format(endDate, 'yyyy-MM-dd')}
                onChange={(e) => onEndDateChange(new Date(e.target.value))}
                className={cn("bg-transparent text-[10px] font-bold outline-none", isV2 ? "text-white" : "dark:text-stone-100")}
              />
            </div>
          </div>
        </div>
      </div>
      <SessionChart sessions={sessions} startDate={startDate} endDate={endDate} />
    </div>
  );
}
