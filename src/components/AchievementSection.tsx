import React from 'react';
import { AchievementBadge } from './AchievementBadge';
import { useUI } from '../contexts/UIContext';
import { cn } from '../lib/utils';

interface AchievementSectionProps {
  title: string;
  achievements: any[];
  currentValue: number;
  suffix?: string;
}

export function AchievementSection({ title, achievements, currentValue, suffix = '' }: AchievementSectionProps) {
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className={cn("text-sm font-bold uppercase tracking-widest", isV2 ? "text-white/50" : "text-stone-400 dark:text-stone-500")}>{title}</h4>
        <span className={cn("text-xs font-mono", isV2 ? "text-white/30" : "text-stone-500")}>{currentValue}{suffix}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {achievements.map(a => (
          <AchievementBadge key={a.id} achievement={a} earned={currentValue >= a.threshold} />
        ))}
      </div>
    </div>
  );
}
