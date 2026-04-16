import React from 'react';
import { AchievementBadge } from './AchievementBadge';
import { Achievement } from '../../../types';

interface AchievementSectionProps {
  title: string;
  achievements: Achievement[];
  currentValue: number;
  suffix?: string;
  earnedAchievements: Set<string>;
}

export function AchievementSection({ title, achievements, currentValue, suffix = '', earnedAchievements }: AchievementSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold uppercase tracking-widest text-text-main/50">{title}</h4>
        <span className="text-xs font-mono text-text-main/40">{currentValue}{suffix}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {achievements.map(a => (
          <AchievementBadge key={a.id} achievement={a} earned={earnedAchievements.has(a.id)} />
        ))}
      </div>
    </div>
  );
}
