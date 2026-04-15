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
import { Session } from '../../../types';
import { parseFirestoreDate, cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';

interface SessionChartProps {
  sessions: Session[];
  startDate: Date;
  endDate: Date;
}

export function SessionChart({ sessions, startDate, endDate }: SessionChartProps) {
  const { t } = useLanguage();
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
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border-subtle)" className="opacity-40" />
          <XAxis 
            dataKey="date" 
            axisLine={false} 
            tickLine={false} 
            tick={{ fontSize: 10, fill: 'var(--color-text-main)', opacity: 0.5 }}
            dy={10}
            className="text-text-main/50"
          />
          <YAxis hide />
          <Tooltip 
            cursor={{ fill: 'var(--color-text-main)', opacity: 0.05 }}
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="p-3 rounded-xl shadow-xl border bg-surface-card backdrop-blur-xl border-border-subtle text-text-main">
                    <p className="font-bold text-sm mb-1">{payload[0].payload.date}</p>
                    <p className="text-xs text-text-main/70">{t('chart_time')} {Math.round(payload[0].value as number)} {t('unit_min')}</p>
                    <p className="text-xs text-text-main/70">{t('chart_words')} {payload[0].payload.wordCount}</p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Bar 
            dataKey="duration" 
            fill="var(--color-text-main)" 
            className="text-text-main" 
            radius={[6, 6, 0, 0]} 
            barSize={24}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
