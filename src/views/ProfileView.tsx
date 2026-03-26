import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { User } from 'firebase/auth';
import { onSnapshot, collection, query, where, orderBy } from 'firebase/firestore';
import { startOfWeek, endOfWeek } from 'date-fns';
import { db } from '../lib/firebase';
import { Session } from '../types';
import { calculateStreak, parseFirestoreDate } from '../lib/utils';
import { Calendar } from '../components/Calendar';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { ProfileHeader } from '../components/profile/ProfileHeader';
import { ProfileAchievements } from '../components/profile/ProfileAchievements';
import { ProfileActivity } from '../components/profile/ProfileActivity';
import { ProfileWordCloud } from '../components/profile/ProfileWordCloud';
import { ProfileFilteredSessions } from '../components/profile/ProfileFilteredSessions';
import { TagCloud } from '../components/TagCloud';
import { doc, updateDoc } from 'firebase/firestore';
import { useLanguage } from '../lib/i18n';

import { UserProfile } from '../types';

interface ProfileViewProps {
  user: User;
  profile: UserProfile | null;
}

export function ProfileView({ user, profile }: ProfileViewProps) {
  const { t } = useLanguage();
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

    // Remove orderBy to avoid composite index requirement
    const q = query(
      collection(db, 'sessions'),
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Session));
      // Sort client-side
      docs.sort((a, b) => {
        const dateA = parseFirestoreDate(a.createdAt).getTime();
        const dateB = parseFirestoreDate(b.createdAt).getTime();
        return dateB - dateA;
      });
      setSessions(docs);
      setLoading(false);
    }, (err) => {
      console.error('Profile load error:', err);
      setError(t('profile_load_error'));
      setLoading(false);
      try {
        handleFirestoreError(err, OperationType.LIST, 'sessions');
      } catch (e) {
        // Logged
      }
    });

    return unsubscribe;
  }, [user.uid, t]);

  const allTags = Array.from(new Set(sessions.flatMap(s => s.tags || [])));
  const currentStreak = calculateStreak(sessions);
  const totalWords = sessions.reduce((acc, s) => acc + s.wordCount, 0);
  const totalNotes = sessions.length;
  const maxSessionDuration = sessions.reduce((acc, s) => Math.max(acc, s.duration / 60), 0);

  if (loading) {
    return (
      <div className="text-stone-400 italic text-center py-24">{t('profile_loading')}</div>
    );
  }

  if (error) {
    return (
      <div className="p-12 text-center bg-red-50 dark:bg-red-900/10 rounded-3xl border border-red-100 dark:border-red-900/30">
        <p className="text-red-600 dark:text-red-400">{error}</p>
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
