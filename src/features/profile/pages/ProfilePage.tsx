import React, { useState, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { startOfWeek, endOfWeek } from 'date-fns';
import { ACHIEVEMENTS } from '../constants/achievements';
import { ProfileService } from '../services/ProfileService';
import { Session, UserProfile } from '../../../types';
import { calculateStreak, parseFirestoreDate, cn, getSessionDate } from '../../../core/utils/utils';
import { Calendar } from '../../calendar/components/Calendar';
import { SessionService } from '../../writing/services/SessionService';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';
import { AdaptiveContainer } from '../../../shared/components/Layout/AdaptiveContainer';
import { ProfileHeader } from '../components/ProfileHeader';
import { ProfileAchievements } from '../components/ProfileAchievements';
import { ProfileActivity } from '../components/ProfileActivity';
import { ProfileWordCloud } from '../components/ProfileWordCloud';
import { ProfileFilteredSessions } from '../components/ProfileFilteredSessions';
import { TagCloud } from '../../writing/components/TagCloud';
import { DataTransfer } from '../../settings/components/DataTransfer';
import { useLanguage } from '../../../core/i18n';
import { useTheme, THEMES } from '../../../core/theme/ThemeProvider';

import { useLocalStorage } from '../../../shared/hooks/useLocalStorage';
import { z } from 'zod';

function ProfileSettingsPanel({ userId }: { userId: string }) {
  const { t, language } = useLanguage();
  const { themeId, setThemeId, themes } = useTheme();
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // Stub toggles — no logic, UI only, state not persisted
  const [betaMode, setBetaMode] = useLocalStorage('beta-mode', false, z.boolean());
  const [communityMode, setCommunityMode] = useState(false);
  const [encryption, setEncryption] = useState(false);
  const [aiAssistance, setAiAssistance] = useState(false);

  const toggles = [
    { key: 'beta', label: t('profile_settings_beta'), value: betaMode, set: setBetaMode },
    { key: 'community', label: t('profile_settings_community'), value: communityMode, set: setCommunityMode },
    { key: 'encryption', label: t('profile_settings_encryption'), value: encryption, set: setEncryption },
    { key: 'ai', label: t('profile_settings_ai'), value: aiAssistance, set: setAiAssistance },
  ];

  return (
    <div className="border-t border-border-subtle mt-4 pt-4">
      {/* Accordion trigger */}
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-sm font-medium text-text-main/50 hover:text-text-main transition-colors w-full"
      >
        <Settings size={14} />
        <span className="uppercase tracking-widest text-[10px] font-bold">
          {t('profile_settings_title')}
        </span>
        <span className={cn("ml-auto transition-transform duration-200 text-xs", open ? "rotate-180" : "")}>
          ▾
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-4 space-y-4">

              {/* Theme selector */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-text-main/40">
                  {t('profile_theme_title')}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {Object.values(themes).map(theme => {
                    const THEME_ACCENT: Record<string, string> = {
                      modern:  '#1a1a1e',
                      stripe:  '#7c3aed',
                      notion:  '#f6f5f4',
                      spotify: '#1ed760',
                    };
                    return (
                      <button
                        key={theme.id}
                        onClick={() => setThemeId(theme.id)}
                        className={cn(
                          "px-4 py-2.5 rounded-xl border text-sm font-medium transition-all text-left",
                          themeId === theme.id
                            ? "border-text-main bg-text-main text-surface-base"
                            : "border-border-subtle text-text-main/60 hover:text-text-main hover:border-text-main/30"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full border border-white/20 shrink-0"
                            style={{ backgroundColor: THEME_ACCENT[theme.id] }}
                          />
                          <span className={cn("text-sm", themeId === theme.id ? "text-surface-base" : "text-text-main")}>
                            {language === 'ru' ? theme.nameRu : theme.nameEn}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Feature toggles (stubs) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {toggles.map(toggle => (
                  <button
                    key={toggle.key}
                    onClick={() => toggle.set(!toggle.value)}
                    className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-border-subtle hover:bg-text-main/5 transition-all"
                  >
                    <span className="text-sm text-text-main/70">{toggle.label}</span>
                    <div className={cn(
                      "w-8 h-4 rounded-full relative transition-colors duration-200 shrink-0",
                      toggle.value ? "bg-text-main" : "bg-text-main/20"
                    )}>
                      <div className={cn(
                        "absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200",
                        toggle.value ? "translate-x-4" : "translate-x-0"
                      )} />
                    </div>
                  </button>
                ))}
              </div>

              {/* Reset achievements */}
              <div className="pt-1">
                {!confirmReset ? (
                  <button
                    onClick={() => setConfirmReset(true)}
                    className="text-xs text-red-400/70 hover:text-red-400 transition-colors underline underline-offset-2"
                  >
                    {t('profile_reset_achievements')}
                  </button>
                ) : (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs text-text-main/50">
                      {t('profile_reset_achievements_confirm')}
                    </span>
                    <button
                      onClick={async () => {
                        await ProfileService.resetAchievements(userId);
                        setConfirmReset(false);
                      }}
                      className="text-xs font-bold text-red-400 hover:text-red-300"
                    >
                      {t('finish_discard')}
                    </button>
                    <button
                      onClick={() => setConfirmReset(false)}
                      className="text-xs text-text-main/40 hover:text-text-main/70"
                    >
                      {t('writing_cancel')}
                    </button>
                  </div>
                )}
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface ProfilePageProps {
  user: User;
  profile: UserProfile | null;
}

export function ProfilePage({ user, profile }: ProfilePageProps) {
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
    const fetchSessions = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await SessionService.getAllSessions(user.uid, 50);
        setSessions(result.sessions);

        // Achievement persistence logic
        const allAchievements = [
          ...ACHIEVEMENTS.streaks,
          ...ACHIEVEMENTS.words,
          ...ACHIEVEMENTS.notes,
          ...ACHIEVEMENTS.duration,
        ];

        const currentMetrics: Record<string, number> = {
          streak: calculateStreak(result.sessions),
          words: result.sessions.reduce((acc, s) => acc + s.wordCount, 0),
          notes: result.sessions.length,
          duration: result.sessions.reduce((acc, s) => Math.max(acc, s.duration / 60), 0),
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
      } catch (err) {
        console.error('Profile load error:', err);
        setError(t('profile_load_error'));
      } finally {
        setLoading(false);
      }
    };

    fetchSessions();
  }, [user.uid, t]);

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
    <AdaptiveContainer size="WIDE" className="pb-10">
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
              <ProfileSettingsPanel userId={user.uid} />
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
            <DataTransfer />
          </div>
        </div>
      </motion.div>
    </AdaptiveContainer>
  );
}
