import React from 'react';
import { Sparkles } from 'lucide-react';
import { AchievementSection } from '../AchievementSection';
import { ACHIEVEMENTS } from '../../constants/achievements';

interface ProfileAchievementsProps {
  currentStreak: number;
  totalWords: number;
  totalNotes: number;
  maxSessionDuration: number;
}

export function ProfileAchievements({ currentStreak, totalWords, totalNotes, maxSessionDuration }: ProfileAchievementsProps) {
  return (
    <div className="space-y-6">
      <h3 className="text-2xl font-bold dark:text-stone-100 flex items-center gap-2">
        <Sparkles className="text-amber-500" /> Достижения
      </h3>
      
      <div className="space-y-8">
        <AchievementSection 
          title="Стрики (дни подряд)" 
          achievements={ACHIEVEMENTS.streaks} 
          currentValue={currentStreak} 
        />
        <AchievementSection 
          title="Общее количество слов" 
          achievements={ACHIEVEMENTS.words} 
          currentValue={totalWords} 
        />
        <AchievementSection 
          title="Количество заметок" 
          achievements={ACHIEVEMENTS.notes} 
          currentValue={totalNotes} 
        />
        <AchievementSection 
          title="Время сессий (макс. за одну)" 
          achievements={ACHIEVEMENTS.duration} 
          currentValue={maxSessionDuration} 
          suffix=" мин"
        />
      </div>
    </div>
  );
}
