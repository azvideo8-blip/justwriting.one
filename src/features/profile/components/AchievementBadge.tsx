import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../shared/i18n';
import { Rarity } from './Achievements';

const TIER_STYLES: Record<Rarity, string> = {
  common:    'border-border-subtle bg-surface-card text-text-main/70',
  rare:      'border-brand-soft/30 bg-brand-soft/10 text-brand-soft',
  epic:      'border-accent-info/30 bg-accent-info/10 text-accent-info',
  legendary: 'border-accent-warning/40 bg-accent-warning/10 text-accent-warning',
};

interface AchievementBadgeProps {
  achievement: {
    id: string;
    title: string;
    icon: string;
    threshold: number;
    tier: Rarity;
  };
  earned: boolean;
}

export function AchievementBadge({ achievement, earned }: AchievementBadgeProps) {
  const { t } = useLanguage();

  return (
    <div className={cn(
      "flex flex-col items-center gap-2 p-4 rounded-2xl border transition-colors",
      earned ? TIER_STYLES[achievement.tier] ?? 'border-border-subtle opacity-30 grayscale' : 'border-border-subtle opacity-30 grayscale'
    )}>
      <span className="text-3xl">{achievement.icon}</span>
      <span className="text-xs font-bold text-center leading-tight">
        {t(achievement.title)}
      </span>
      {earned && (
        <span className="text-label-sm uppercase tracking-widest opacity-60">
          {t(`badge_tier_${achievement.tier}`)}
        </span>
      )}
    </div>
  );
}
