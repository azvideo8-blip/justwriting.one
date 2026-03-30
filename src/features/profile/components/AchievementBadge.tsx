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
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';

  return (
    <div className={cn(
      "flex flex-col items-center p-4 rounded-2xl border transition-all",
      earned 
        ? (isV2 ? "bg-white/5 border-white/20 shadow-[0_0_15px_rgba(255,255,255,0.05)]" : "bg-white dark:bg-stone-900 border-emerald-100 dark:border-emerald-900 shadow-sm") 
        : (isV2 ? "bg-white/5 border-white/5 opacity-40 grayscale" : "bg-stone-50/50 dark:bg-stone-950/50 border-stone-100 dark:border-stone-800 opacity-40 grayscale")
    )}>
      <div className="text-3xl mb-2">{achievement.icon}</div>
      <span className={cn("text-[10px] font-bold uppercase tracking-widest text-center leading-tight", isV2 ? "text-white/80" : "text-stone-400 dark:text-stone-500")}>
        {t(achievement.title)}
      </span>
      {earned && (
        <div className={cn("mt-2 px-3 py-1 text-[9px] font-black rounded-full uppercase tracking-[0.2em]", 
          isV2 ? "bg-white text-black border-none" : "bg-emerald-500 text-white"
        )}>
          {t('ach_earned')}
        </div>
      )}
    </div>
  );
}
