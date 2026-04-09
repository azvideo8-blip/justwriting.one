import React from 'react';
import { Sparkles } from 'lucide-react';
import { AchievementSection } from './AchievementSection';
import { ACHIEVEMENTS } from '../constants/achievements';
import { useLanguage } from '../../../core/i18n';
import { cn } from '../../../core/utils/utils';

interface ProfileAchievementsProps {
  currentStreak: number;
  totalWords: number;
  totalNotes: number;
  maxSessionDuration: number;
  earnedAchievements: string[];
}

export function ProfileAchievements({ currentStreak, totalWords, totalNotes, maxSessionDuration, earnedAchievements }: ProfileAchievementsProps) {
  const { t } = useLanguage();
  const earnedSet = new Set(earnedAchievements);

  return (
    <div className="space-y-6">
      <h3 className="text-2xl font-bold flex items-center gap-2 text-text-main">
        <Sparkles className="text-amber-400" /> {t('profile_achievements')}
      </h3>
      
      <div className="space-y-8">
        <AchievementSection 
          title={t('ach_section_streaks')} 
          achievements={ACHIEVEMENTS.streaks} 
          currentValue={currentStreak}
          earnedAchievements={earnedSet}
        />
        <AchievementSection 
          title={t('ach_section_words')} 
          achievements={ACHIEVEMENTS.words} 
          currentValue={totalWords}
          earnedAchievements={earnedSet}
        />
        <AchievementSection 
          title={t('ach_section_notes')} 
          achievements={ACHIEVEMENTS.notes} 
          currentValue={totalNotes}
          earnedAchievements={earnedSet}
        />
        <AchievementSection 
          title={t('ach_section_duration')} 
          achievements={ACHIEVEMENTS.duration} 
          currentValue={maxSessionDuration} 
          suffix=" min"
          earnedAchievements={earnedSet}
        />
      </div>
    </div>
  );
}
