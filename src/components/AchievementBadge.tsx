import React from 'react';
import { cn } from '../lib/utils';
import { useLanguage } from '../lib/i18n';
import { Achievement } from '../types';

interface AchievementBadgeProps {
  achievement: Achievement;
  earned: boolean;
}

export function AchievementBadge({ achievement, earned }: AchievementBadgeProps) {
  const { t } = useLanguage();
  return (
    <div className={cn(
      "flex flex-col items-center p-4 rounded-2xl border transition-all",
      earned 
        ? "bg-white dark:bg-stone-900 border-emerald-100 dark:border-emerald-900 shadow-sm" 
        : "bg-stone-50/50 dark:bg-stone-950/50 border-stone-100 dark:border-stone-800 opacity-40 grayscale"
    )}>
      <div className="text-3xl mb-2">{achievement.icon}</div>
      <span className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest text-center leading-tight">
        {t(achievement.title)}
      </span>
      {earned && (
        <div className="mt-2 px-2 py-0.5 bg-emerald-500 text-[8px] text-white font-bold rounded-full uppercase tracking-tighter">
          {t('ach_earned')}
        </div>
      )}
    </div>
  );
}
