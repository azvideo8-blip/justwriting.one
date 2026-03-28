import React from 'react';
import { format, eachDayOfInterval } from 'date-fns';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { Session } from '../types';
import { parseFirestoreDate, cn } from '../core/utils/utils';
import { useUI } from '../contexts/UIContext';

interface SessionChartProps {
  sessions: Session[];
  startDate: Date;
  endDate: Date;
}

export function SessionChart({ sessions, startDate, endDate }: SessionChartProps) {
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';

  const days = eachDayOfInterval({
    start: startDate,
    end: endDate
  });

  const data = days.map(day => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const daySessions = sessions.filter(s => {
      const sDate = parseFirestoreDate(s.createdAt);
      return format(sDate, 'yyyy-MM-dd') === dateStr;
    });
    return {
      date: format(day, 'd MMM'),
      duration: daySessions.reduce((acc, s) => acc + s.duration, 0) / 60, // in minutes
      wordCount: daySessions.reduce((acc, s) => acc + s.wordCount, 0),
    };
  });

  return (
    <div className="h-[300px] w-full min-h-[300px]">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isV2 ? "rgba(255,255,255,0.1)" : "#e5e7eb"} className={isV2 ? "" : "opacity-30"} />
          <XAxis 
            dataKey="date" 
            axisLine={false} 
            tickLine={false} 
            tick={{ fontSize: 10, fill: isV2 ? 'rgba(255,255,255,0.5)' : 'currentColor' }}
            dy={10}
            className={isV2 ? "" : "text-stone-400"}
          />
          <YAxis hide />
          <Tooltip 
            cursor={{ fill: isV2 ? 'rgba(255,255,255,0.05)' : 'transparent' }}
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                return (
                  <div className={cn(
                    "p-3 rounded-xl shadow-xl border",
                    isV2 ? "bg-[#0A0A0B]/90 backdrop-blur-xl border-white/10 text-white" : "bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-800"
                  )}>
                    <p className="font-bold text-sm mb-1">{payload[0].payload.date}</p>
                    <p className={cn("text-xs", isV2 ? "text-white/70" : "text-stone-500")}>Время: {Math.round(payload[0].value as number)} мин</p>
                    <p className={cn("text-xs", isV2 ? "text-white/70" : "text-stone-500")}>Слова: {payload[0].payload.wordCount}</p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Bar 
            dataKey="duration" 
            fill="currentColor" 
            className={isV2 ? "text-white/80" : "text-stone-900 dark:text-stone-100"} 
            radius={[6, 6, 0, 0]} 
            barSize={24}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
