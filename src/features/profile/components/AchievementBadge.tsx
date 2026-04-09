import React from 'react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';
import { useUI } from '../../../contexts/UIContext';

interface AchievementBadgeProps {
  achievement: {
    id: string;
    title: string;
    icon: string;
    threshold: number;
  };
  earned: boolean;
}

export function AchievementBadge({ achievement, earned }: AchievementBadgeProps) {
  const { t } = useLanguage();

  return (
    <div className={cn(
      "flex flex-col items-center p-4 rounded-2xl border transition-all",
      earned 
        ? "bg-surface-card border-border-subtle shadow-[0_0_15px_rgba(255,255,255,0.05)]" 
        : "bg-surface-base/5 border-border-subtle/5 opacity-40 grayscale"
    )}>
      <div className="text-3xl mb-2">{achievement.icon}</div>
      <span className="text-[10px] font-bold uppercase tracking-widest text-center leading-tight text-text-main/80">
        {t(achievement.title)}
      </span>
      {earned && (
        <div className="mt-2 px-3 py-1 text-[9px] font-black rounded-full uppercase tracking-[0.2em] bg-text-main text-surface-base border-none">
          {t('ach_earned')}
        </div>
      )}
    </div>
  );
}
