import React from 'react';
import { Sparkles } from 'lucide-react';
import { AchievementSection } from '../AchievementSection';
import { ACHIEVEMENTS } from '../../constants/achievements';
import { useLanguage } from '../../lib/i18n';

interface ProfileAchievementsProps {
  currentStreak: number;
  totalWords: number;
  totalNotes: number;
  maxSessionDuration: number;
}

export function ProfileAchievements({ currentStreak, totalWords, totalNotes, maxSessionDuration }: ProfileAchievementsProps) {
  const { t } = useLanguage();
  return (
    <div className="space-y-6">
      <h3 className="text-2xl font-bold dark:text-stone-100 flex items-center gap-2">
        <Sparkles className="text-amber-500" /> {t('profile_achievements')}
      </h3>
      
      <div className="space-y-8">
        <AchievementSection 
          title={t('ach_section_streaks')} 
          achievements={ACHIEVEMENTS.streaks} 
          currentValue={currentStreak} 
        />
        <AchievementSection 
          title={t('ach_section_words')} 
          achievements={ACHIEVEMENTS.words} 
          currentValue={totalWords} 
        />
        <AchievementSection 
          title={t('ach_section_notes')} 
          achievements={ACHIEVEMENTS.notes} 
          currentValue={totalNotes} 
        />
        <AchievementSection 
          title={t('ach_section_duration')} 
          achievements={ACHIEVEMENTS.duration} 
          currentValue={maxSessionDuration} 
          suffix=" min"
        />
      </div>
    </div>
  );
}
