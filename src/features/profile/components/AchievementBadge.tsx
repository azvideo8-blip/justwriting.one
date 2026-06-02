import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../shared/i18n';
import { Rarity } from './Achievements';

const TIER_STYLES: Record<Rarity, string> = {
  common:    'border-border-subtle bg-surface-card text-text-main/60',
  rare:      'border-purple-500/30 bg-purple-500/10 text-purple-400',
  epic:      'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
  legendary: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
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
