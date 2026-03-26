import React from 'react';
import { AchievementBadge } from './AchievementBadge';
import { Achievement } from '../types';

interface AchievementSectionProps {
  title: string;
  achievements: Achievement[];
  currentValue: number;
  suffix?: string;
}

export function AchievementSection({ title, achievements, currentValue, suffix = '' }: AchievementSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">{title}</h4>
        <span className="text-xs font-mono text-stone-500">{currentValue}{suffix}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {achievements.map(a => (
          <AchievementBadge key={a.id} achievement={a} earned={currentValue >= a.threshold} />
        ))}
      </div>
    </div>
  );
}
