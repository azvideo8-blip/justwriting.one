import React from 'react';
import { format, subDays } from 'date-fns';
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

import { parseFirestoreDate } from '../lib/utils';

interface SessionChartProps {
  sessions: Session[];
}

export function SessionChart({ sessions }: SessionChartProps) {
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = subDays(new Date(), i);
    return format(d, 'yyyy-MM-dd');
  }).reverse();

  const data = last7Days.map(date => {
    const daySessions = sessions.filter(s => {
      const sDate = parseFirestoreDate(s.createdAt);
      return format(sDate, 'yyyy-MM-dd') === date;
    });
    return {
      date: format(new Date(date), 'd MMM'),
      duration: daySessions.reduce((acc, s) => acc + s.duration, 0) / 60, // in minutes
      wordCount: daySessions.reduce((acc, s) => acc + s.wordCount, 0),
      charCount: daySessions.reduce((acc, s) => acc + (s.charCount || 0), 0),
    };
  });

  return (
    <div className="h-[300px] w-full min-h-[300px]">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
          <XAxis 
            dataKey="date" 
            axisLine={false} 
            tickLine={false} 
            tick={{ fontSize: 12, fill: '#9ca3af' }}
            dy={10}
          />
          <YAxis hide />
          <Tooltip 
            cursor={{ fill: 'transparent' }}
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="bg-white dark:bg-stone-900 p-3 rounded-xl border border-stone-200 dark:border-stone-800 shadow-xl">
                    <p className="font-bold text-sm mb-1">{payload[0].payload.date}</p>
                    <p className="text-xs text-stone-500">Время: {Math.round(payload[0].value as number)} мин</p>
                    <p className="text-xs text-stone-500">Слова: {payload[0].payload.wordCount}</p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Bar 
            dataKey="duration" 
            fill="currentColor" 
            className="text-stone-900 dark:text-stone-100" 
            radius={[6, 6, 0, 0]} 
            barSize={32}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
