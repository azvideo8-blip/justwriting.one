import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { User } from 'firebase/auth';
import { startOfWeek, endOfWeek } from 'date-fns';
import { ACHIEVEMENTS } from '../constants/achievements';
import { ProfileService } from '../services/ProfileService';
import { Session, UserProfile } from '../../../types';
import { calculateStreak } from '../../../core/utils/utils';
import { Calendar } from '../../calendar/components/Calendar';
import { SessionService } from '../../writing/services/SessionService';
import { LocalDocumentService } from '../../writing/services/LocalDocumentService';
import { LocalVersionService } from '../../writing/services/LocalVersionService';
import { getOrCreateGuestId } from '../../../shared/lib/localDb';
import { AdaptiveContainer } from '../../../shared/components/Layout/AdaptiveContainer';
import { ProfileHeader } from '../components/ProfileHeader';
import { ProfileAchievements } from '../components/ProfileAchievements';
import { ProfileActivity } from '../components/ProfileActivity';
import { ProfileWordCloud } from '../components/ProfileWordCloud';
import { ProfileFilteredSessions } from '../components/ProfileFilteredSessions';
import { TagCloud } from '../../writing/components/TagCloud';
import { useLanguage } from '../../../core/i18n';

interface ProfilePageProps {
  user: User | null;
  profile: UserProfile | null;
}

export function ProfilePage({ user, profile }: ProfilePageProps) {
  const { t } = useLanguage();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const isGuest = !user;

  // Date range for activity chart - Default to current week
  const [startDate, setStartDate] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [endDate, setEndDate] = useState<Date>(() => endOfWeek(new Date(), { weekStartsOn: 1 }));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const userId = user?.uid ?? getOrCreateGuestId();

  useEffect(() => {
    const fetchSessions = async () => {
      setLoading(true);
      setError(null);
      try {
        if (isGuest) {
          const localDocs = await LocalDocumentService.getGuestDocuments(userId);
          const guestSessions = await Promise.all(localDocs.map(async doc => {
            const content = await LocalVersionService.getLatestContent(doc.id);
            return {
              id: doc.id,
              userId: doc.guestId,
              authorName: '',
              authorPhoto: '',
              content,
              duration: doc.totalDuration,
              wordCount: doc.totalWords,
              charCount: 0,
              wpm: 0,
              isPublic: false,
              title: doc.title,
              tags: doc.tags,
              createdAt: new Date(doc.lastSessionAt),
              _isLocal: true,
            } as Session & { _isLocal?: boolean };
          }));
          setSessions(guestSessions);
        } else {
          const [result, localDocs] = await Promise.all([
            SessionService.getAllSessions(user.uid, 50),
            LocalDocumentService.getGuestDocuments(user.uid).catch(() => []),
          ]);

          const localSessions = await Promise.all(localDocs.map(async doc => {
            const content = await LocalVersionService.getLatestContent(doc.id);
            return {
              id: doc.id,
              userId: doc.guestId,
              authorName: '',
              authorPhoto: '',
              content,
              duration: doc.totalDuration,
              wordCount: doc.totalWords,
              charCount: 0,
              wpm: 0,
              isPublic: false,
              title: doc.title,
              tags: doc.tags,
              createdAt: new Date(doc.lastSessionAt),
              _isLocal: true,
            } as Session;
          }));

          const allSessions = [...result.sessions, ...localSessions];
          const seenIds = new Set<string>();
          const deduped = allSessions.filter(s => {
            if (seenIds.has(s.id)) return false;
            seenIds.add(s.id);
            return true;
          });
          setSessions(deduped);

          const allAchievements = [
            ...ACHIEVEMENTS.streaks,
            ...ACHIEVEMENTS.words,
            ...ACHIEVEMENTS.notes,
            ...ACHIEVEMENTS.duration,
          ];

          const currentMetrics: Record<string, number> = {
            streak: calculateStreak(allSessions),
            words: allSessions.reduce((acc, s) => acc + s.wordCount, 0),
            notes: allSessions.length,
            duration: allSessions.reduce((acc, s) => Math.max(acc, s.duration / 60), 0),
          };

          const getMetricForAchievement = (id: string) => {
            if (id.startsWith('streak_')) return currentMetrics.streak;
            if (id.startsWith('words_')) return currentMetrics.words;
            if (id.startsWith('notes_')) return currentMetrics.notes;
            if (id.startsWith('duration_')) return currentMetrics.duration;
            return 0;
          };

          const alreadyEarned = new Set(profile?.earnedAchievements || []);
          const newlyEarned = allAchievements
            .filter(a => !alreadyEarned.has(a.id) && getMetricForAchievement(a.id) >= a.threshold)
            .map(a => a.id);

          if (newlyEarned.length > 0) {
            const updated = [...alreadyEarned, ...newlyEarned];
            await ProfileService.updateEarnedAchievements(user.uid, updated);
          }
        }
      } catch (err) {
        console.error('Profile load error:', err);
        setError(t('profile_load_error'));
      } finally {
        setLoading(false);
      }
    };

    fetchSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, t]);

  const allTags = Array.from(new Set(sessions.flatMap(s => s.tags || [])));
  const currentStreak = calculateStreak(sessions);
  const totalWords = sessions.reduce((acc, s) => acc + s.wordCount, 0);
  const totalNotes = sessions.length;
  const maxSessionDuration = sessions.reduce((acc, s) => Math.max(acc, s.duration / 60), 0);

  if (loading) {
    return (
      <div className="italic text-center py-24 text-text-main/50">{t('profile_loading')}</div>
    );
  }

  if (error) {
    return (
      <div className="p-12 text-center rounded-3xl border bg-red-500/10 border-red-500/30">
        <p className="text-red-400">{error}</p>
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
    <AdaptiveContainer className="pb-10">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-12"
      >
        <div className="flex flex-col md:flex-row gap-8 items-start">
          <div className="flex-1 space-y-8">
            <div className="p-8 rounded-3xl transition-all bg-surface-card backdrop-blur-2xl border border-border-subtle shadow-sm">
              <ProfileHeader 
                user={user} 
                profile={profile} 
                currentStreak={currentStreak} 
                totalWords={totalWords} 
              />
            </div>

            <ProfileAchievements 
              currentStreak={currentStreak}
              totalWords={totalWords}
              totalNotes={totalNotes}
              maxSessionDuration={maxSessionDuration}
              earnedAchievements={profile?.earnedAchievements || []}
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
    </AdaptiveContainer>
  );
}
