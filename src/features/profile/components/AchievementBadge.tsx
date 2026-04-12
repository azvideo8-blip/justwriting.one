import React from 'react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';

type AchievementTier = 'common' | 'rare' | 'legendary';

const TIER_STYLES: Record<AchievementTier, string> = {
  common:    'border-border-subtle bg-surface-card text-text-main/60',
  rare:      'border-purple-500/30 bg-purple-500/10 text-purple-400',
  legendary: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
};

const TIER_LABELS: Record<AchievementTier, { ru: string; en: string }> = {
  common:    { ru: 'обычное',      en: 'common' },
  rare:      { ru: 'редкое',       en: 'rare' },
  legendary: { ru: 'легендарное',  en: 'legendary' },
};

interface AchievementBadgeProps {
  achievement: {
    id: string;
    title: string;
    icon: string;
    threshold: number;
    tier: AchievementTier;
  };
  earned: boolean;
}

export function AchievementBadge({ achievement, earned }: AchievementBadgeProps) {
  const { t, language } = useLanguage();

  return (
    <div className={cn(
      "flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all",
      earned ? TIER_STYLES[achievement.tier] : 'border-border-subtle opacity-30 grayscale'
    )}>
      <span className="text-3xl">{achievement.icon}</span>
      <span className="text-xs font-bold text-center leading-tight">
        {t(achievement.title)}
      </span>
      {earned && (
        <span className="text-[9px] uppercase tracking-widest opacity-60">
          {TIER_LABELS[achievement.tier][language]}
        </span>
      )}
    </div>
  );
}
