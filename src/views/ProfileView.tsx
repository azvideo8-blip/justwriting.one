import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { User } from 'firebase/auth';
import { startOfWeek, endOfWeek } from 'date-fns';
import { Session } from '../types';
import { calculateStreak, parseFirestoreDate, cn } from '../core/utils/utils';
import { Calendar } from '../components/Calendar';
import { SessionService } from '../services/SessionService';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { ProfileHeader } from '../components/profile/ProfileHeader';
import { ProfileAchievements } from '../components/profile/ProfileAchievements';
import { ProfileActivity } from '../components/profile/ProfileActivity';
import { ProfileWordCloud } from '../components/profile/ProfileWordCloud';
import { ProfileFilteredSessions } from '../components/profile/ProfileFilteredSessions';
import { TagCloud } from '../components/TagCloud';
import { useLanguage } from '../core/i18n';
import { useUI } from '../contexts/UIContext';

import { UserProfile } from '../types';

interface ProfileViewProps {
  user: User;
  profile: UserProfile | null;
}

export function ProfileView({ user, profile }: ProfileViewProps) {
  const { t } = useLanguage();
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedWord, setSelectedWord] = useState<string | null>(null);

  // Date range for activity chart - Default to current week
  const [startDate, setStartDate] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [endDate, setEndDate] = useState<Date>(() => endOfWeek(new Date(), { weekStartsOn: 1 }));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const unsubscribe = SessionService.subscribeToSessions(
      user.uid,
      (docs) => {
        // Sort client-side
        docs.sort((a, b) => {
          const dateA = parseFirestoreDate(a.createdAt).getTime();
          const dateB = parseFirestoreDate(b.createdAt).getTime();
          return dateB - dateA;
        });
        setSessions(docs);
        setLoading(false);
      },
      (err) => {
        console.error('Profile load error:', err);
        setError(t('profile_load_error'));
        setLoading(false);
        try {
          handleFirestoreError(err, OperationType.LIST, 'sessions');
        } catch (e) {
          // Logged
        }
      }
    );

    return unsubscribe;
  }, [user.uid, t]);

  const allTags = Array.from(new Set(sessions.flatMap(s => s.tags || [])));
  const currentStreak = calculateStreak(sessions);
  const totalWords = sessions.reduce((acc, s) => acc + s.wordCount, 0);
  const totalNotes = sessions.length;
  const maxSessionDuration = sessions.reduce((acc, s) => Math.max(acc, s.duration / 60), 0);

  if (loading) {
    return (
      <div className={cn("italic text-center py-24", isV2 ? "text-white/50" : "text-stone-400")}>{t('profile_loading')}</div>
    );
  }

  if (error) {
    return (
      <div className={cn("p-12 text-center rounded-3xl border", isV2 ? "bg-red-500/10 border-red-500/30" : "bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30")}>
        <p className={cn(isV2 ? "text-red-400" : "text-red-600 dark:text-red-400")}>{error}</p>
      </div>
    );
  }

  if (selectedWord) {
    return (
      <ProfileFilteredSessions 
        selectedWord={selectedWord} 
        sessions={sessions} 
        labels={profile?.labels || []}
        onBack={() => setSelectedWord(null)} 
      />
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-12 pb-10"
    >
      <div className="flex flex-col md:flex-row gap-8 items-start">
        <div className="flex-1 space-y-8">
          <ProfileHeader 
            user={user} 
            profile={profile} 
            currentStreak={currentStreak} 
            totalWords={totalWords} 
          />

          <ProfileAchievements 
            currentStreak={currentStreak}
            totalWords={totalWords}
            totalNotes={totalNotes}
            maxSessionDuration={maxSessionDuration}
          />

          <ProfileActivity 
            sessions={sessions}
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />
        </div>

        {/* Sidebar */}
        <div className="w-full md:w-80 shrink-0 space-y-8">
          <Calendar sessions={sessions} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
          
          <ProfileWordCloud 
            sessions={sessions} 
            onWordClick={setSelectedWord} 
          />

          <TagCloud tags={allTags} />
        </div>
      </div>
    </motion.div>
  );
}
