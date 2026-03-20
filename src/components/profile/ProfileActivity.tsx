import React from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { SessionChart } from '../SessionChart';
import { Session } from '../../types';

interface ProfileActivityProps {
  sessions: Session[];
  startDate: Date;
  endDate: Date;
  onStartDateChange: (date: Date) => void;
  onEndDateChange: (date: Date) => void;
}

export function ProfileActivity({ sessions, startDate, endDate, onStartDateChange, onEndDateChange }: ProfileActivityProps) {
  return (
    <div className="bg-white dark:bg-stone-900 p-8 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-xl font-bold dark:text-stone-100">Активность</h3>
          <p className="text-xs text-stone-400 font-medium">
            {format(startDate, 'd MMM')} — {format(endDate, 'd MMM')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-stone-50 dark:bg-stone-800 p-1 rounded-xl border border-stone-100 dark:border-stone-700">
            <div className="flex items-center gap-1 px-2">
              <CalendarIcon size={12} className="text-stone-400" />
              <input 
                type="date" 
                value={format(startDate, 'yyyy-MM-dd')}
                onChange={(e) => onStartDateChange(new Date(e.target.value))}
                className="bg-transparent text-[10px] font-bold outline-none dark:text-stone-100"
              />
            </div>
            <div className="w-px h-4 bg-stone-200 dark:bg-stone-700" />
            <div className="flex items-center gap-1 px-2">
              <input 
                type="date" 
                value={format(endDate, 'yyyy-MM-dd')}
                onChange={(e) => onEndDateChange(new Date(e.target.value))}
                className="bg-transparent text-[10px] font-bold outline-none dark:text-stone-100"
              />
            </div>
          </div>
        </div>
      </div>
      <SessionChart sessions={sessions} startDate={startDate} endDate={endDate} />
    </div>
  );
}
