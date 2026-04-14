import React from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { SessionChart } from '../../writing/components/SessionChart';
import { Session } from '../../../types';
import { cn } from '../../../core/utils/utils';

interface ProfileActivityProps {
  sessions: Session[];
  startDate: Date;
  endDate: Date;
  onStartDateChange: (date: Date) => void;
  onEndDateChange: (date: Date) => void;
}

export function ProfileActivity({ sessions, startDate, endDate, onStartDateChange, onEndDateChange }: ProfileActivityProps) {
  return (
    <div className="p-8 rounded-3xl transition-all space-y-6 bg-surface-card backdrop-blur-2xl border border-border-subtle shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-xl font-bold text-text-main">Активность</h3>
          <p className="text-xs font-medium text-text-main/50">
            {format(startDate, 'd MMM')} — {format(endDate, 'd MMM')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 p-1 rounded-xl border bg-surface-base/5 border-border-subtle">
            <div className="flex items-center gap-1 px-2">
              <CalendarIcon size={12} className="text-text-main/50" />
              <input 
                type="date" 
                value={format(startDate, 'yyyy-MM-dd')}
                onChange={(e) => onStartDateChange(new Date(e.target.value))}
                className="bg-transparent text-[11px] font-bold outline-none text-text-main"
              />
            </div>
            <div className="w-px h-4 bg-border-subtle" />
            <div className="flex items-center gap-1 px-2">
              <input 
                type="date" 
                value={format(endDate, 'yyyy-MM-dd')}
                onChange={(e) => onEndDateChange(new Date(e.target.value))}
                className="bg-transparent text-[11px] font-bold outline-none text-text-main"
              />
            </div>
          </div>
        </div>
      </div>
      <SessionChart sessions={sessions} startDate={startDate} endDate={endDate} />
    </div>
  );
}
