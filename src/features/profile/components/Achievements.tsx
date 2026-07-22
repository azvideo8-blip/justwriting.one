import { useState, useEffect, useRef, startTransition } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useLanguage } from '../../../shared/i18n';
import { reportError } from '../../../shared/errors/reportError';
import { Session, Achievement } from '../../../types';
import { ACHIEVEMENTS as ACH_DATA } from '../constants/achievements';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { ProfileService } from '../services/ProfileService';
import { calculateBestStreak, cn } from '../../../core/utils/utils';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

interface Stats {
  totalWords: number;
  streakDays: number;
  sessionsCount: number;
  avgSessionMins: number;
  typicalHour: string;
  wordsPerDay: number;
}

const RARITY_COLORS: Record<Rarity, string> = {
  common: 'var(--text-muted)',
  rare: 'var(--brand-soft)',
  epic: 'var(--accent-info)',
  legendary: 'var(--accent-warning)',
};

function getRarityLabel(rarity: Rarity, t: (key: string) => string): string {
  return t(`ach_rarity_${rarity}`);
}

interface AchGroup {
  id: string;
  labelKey: string;
  achievements: Achievement[];
  rarities: Rarity[];
}

function mapRarity(ach: Achievement): Rarity {
  if (ach.id.startsWith('streak_')) {
    if (ach.threshold >= 60) return 'legendary';
    if (ach.threshold >= 21) return 'epic';
    if (ach.threshold >= 7) return 'rare';
    return 'common';
  }
  if (ach.id.startsWith('words_')) {
    if (ach.threshold >= 100000) return 'legendary';
    if (ach.threshold >= 25000) return 'epic';
    if (ach.threshold >= 2500) return 'rare';
    return 'common';
  }
  if (ach.id.startsWith('notes_')) {
    if (ach.threshold >= 100) return 'legendary';
    if (ach.threshold >= 25) return 'epic';
    if (ach.threshold >= 10) return 'rare';
    return 'common';
  }
  if (ach.id.startsWith('duration_')) {
    if (ach.threshold >= 180) return 'legendary';
    if (ach.threshold >= 60) return 'epic';
    return 'common';
  }
  return 'common';
}

const GROUPS: AchGroup[] = [
  {
    id: 'streaks',
    labelKey: 'ach_section_streaks',
    achievements: ACH_DATA.streaks,
    rarities: ACH_DATA.streaks.map(mapRarity),
  },
  {
    id: 'words',
    labelKey: 'ach_section_words',
    achievements: ACH_DATA.words,
    rarities: ACH_DATA.words.map(mapRarity),
  },
  {
    id: 'notes',
    labelKey: 'ach_section_notes',
    achievements: ACH_DATA.notes,
    rarities: ACH_DATA.notes.map(mapRarity),
  },
  {
    id: 'duration',
    labelKey: 'ach_section_duration',
    achievements: ACH_DATA.duration,
    rarities: ACH_DATA.duration.map(mapRarity),
  },
];

export function calcMaxHistoricalStreak(sessions: Session[]): number {
  return calculateBestStreak(sessions);
}

export function checkAchievement(ach: Achievement, stats: Stats, sessions: Session[]): boolean {
  if (ach.id.startsWith('streak_')) {
    const maxEver = Math.max(stats.streakDays, calcMaxHistoricalStreak(sessions));
    return maxEver >= ach.threshold;
  }
  if (ach.id.startsWith('words_')) return stats.totalWords >= ach.threshold;
  if (ach.id.startsWith('notes_')) return stats.sessionsCount >= ach.threshold;
  if (ach.id.startsWith('duration_')) {
    if (sessions.length === 0) return false;
    const maxMins = Math.floor(Math.max(...sessions.map(s => s.duration || 0)) / 60);
    return maxMins >= ach.threshold;
  }
  return false;
}

interface AchievementsProps {
  stats: Stats;
  sessions: Session[];
}

export function Achievements({ stats, sessions }: AchievementsProps) {
  const { t } = useLanguage();
  const { user } = useAuthStatus();
  const reducedMotion = useReducedMotion();
  const abortRef = useRef<AbortController | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userId = user?.uid ?? 'guest';
  const storageKey = `unlocked_achievements_${userId}`;

  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });

  useEffect(() => {
    const handleReset = () => {
      setUnlockedIds(new Set());
    };
    window.addEventListener('achievements-reset', handleReset);
    return () => window.removeEventListener('achievements-reset', handleReset);
  }, []);

  useEffect(() => {
    if (!user) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    ProfileService.loadEarnedAchievements(user.uid).then(result => {
      if (ac.signal.aborted) return;
      if (result.ids.length > 0 && !result.error) {
        setUnlockedIds(prev => {
          const merged = new Set([...prev, ...result.ids]);
          try { localStorage.setItem(storageKey, JSON.stringify([...merged])); } catch (e) { reportError(e, { action: 'saveAchievementsLocal' }); }
          return merged;
        });
      }
    }).catch(e => { reportError(e, { action: 'loadCloudAchievements', userId: user.uid }); });

    return () => ac.abort();
  }, [user, storageKey]);

  const statsKeyRef = useRef('');
  useEffect(() => {
    const key = `${stats.totalWords}-${stats.streakDays}-${stats.sessionsCount}`;
    if (statsKeyRef.current === key) return;
    statsKeyRef.current = key;

    startTransition(() => {
      setUnlockedIds(prev => {
        const updated = new Set(prev);
        let changed = false;
        GROUPS.forEach(g => {
          g.achievements.forEach(ach => {
            if (updated.has(ach.id)) return;
            if (checkAchievement(ach, stats, sessions)) {
              updated.add(ach.id);
              changed = true;
            }
          });
        });
        if (!changed) return prev;
        if (import.meta.env.DEV) {
          console.warn('[Achievements] newly unlocked:', [...updated].filter(id => !prev.has(id)));
        }
        try { localStorage.setItem(storageKey, JSON.stringify([...updated])); } catch (e) { reportError(e, { action: 'updateAchievementsLocal' }); }
        return updated;
      });
    });

    // Debounced cloud sync — reads latest from localStorage
    if (user) {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        try {
          const saved = localStorage.getItem(storageKey);
          if (saved) {
            ProfileService.updateEarnedAchievements(user.uid, JSON.parse(saved)).catch(e => {
              reportError(e, { action: 'syncAchievementsToCloud', userId: user.uid });
            });
          }
        } catch { /* ignore */ }
      }, 2000);
    }

    return () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [stats, sessions, user, storageKey]);

  const totalAchievements = GROUPS.reduce((s, g) => s + g.achievements.length, 0);
  const unlockedCount = GROUPS.reduce((s, g) =>
    s + g.achievements.filter(a => unlockedIds.has(a.id)).length, 0);
  const legendaryCount = GROUPS.reduce((s, g) =>
    s + g.achievements.filter((a, i) =>
      g.rarities[i] === 'legendary' && unlockedIds.has(a.id)
    ).length, 0);

  const [activeAchId, setActiveAchId] = useState<string | null>(null);

  const getAchievementDescription = (ach: Achievement, t: (key: string) => string) => {
    if (ach.id.startsWith('streak_')) {
      return `${ach.threshold} ${t('profile_streak') || 'days in a row'}`;
    }
    if (ach.id.startsWith('words_')) {
      return `${ach.threshold.toLocaleString()} ${t('profile_words') || 'words'}`;
    }
    if (ach.id.startsWith('notes_')) {
      return `${ach.threshold} ${t('me_stat_sessions') || 'sessions'}`;
    }
    if (ach.id.startsWith('duration_')) {
      return `${ach.threshold} ${t('unit_min') || 'min'}`;
    }
    return '';
  };

  return (
    <div className="px-9 py-6">
      <h2 className="text-[18px] font-medium text-text-main mb-1">
        {t('profile_achievements_title')}
      </h2>
      <div className="flex gap-4 mb-6 font-mono text-label-sm text-text-muted uppercase tracking-widest">
        <span>{unlockedCount} / {totalAchievements} {t('profile_ach_opened')}</span>
        {legendaryCount > 0 && (
          <span className="text-[#f5c518]">
            {legendaryCount} {t('profile_ach_legendary')}
          </span>
        )}
      </div>

      {GROUPS.map((group, gi) => {
        const groupUnlocked = group.achievements.filter(a => unlockedIds.has(a.id)).length;
        const groupProgress = group.achievements.length > 0 ? groupUnlocked / group.achievements.length : 0;

        return (
          <motion.div
            key={group.id}
            initial={reducedMotion ? false : { opacity: 0, transform: "translateY(12px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ duration: 0.3, delay: gi * 0.08 }}
            className="mb-8"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="font-mono text-label-sm text-text-muted uppercase tracking-widest">
                {t(group.labelKey)}
              </div>
              <div className="font-mono text-label-sm text-text-subtle">
                {groupUnlocked} / {group.achievements.length}
              </div>
            </div>

            <div className="h-[3px] rounded-sm bg-[var(--surface-elevated)] mb-3 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${groupProgress * 100}%` }}
                transition={{ duration: 0.6, delay: gi * 0.08 + 0.1, ease: 'easeOut' }}
                className="h-full rounded-sm bg-[var(--flow-pulse-color)]"
              />
            </div>

            <div
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-[1px] bg-border-light/40 border border-border-light/40 rounded-xl overflow-hidden"
            >
              {group.achievements.map((ach, i) => {
                const unlocked = unlockedIds.has(ach.id);
                const rarity = group.rarities[i]!;

                return (
                  <div
                    key={ach.id}
                    title={t(ach.title)}
                    onClick={() => setActiveAchId(activeAchId === ach.id ? null : ach.id)}
                    className={cn(
                      "p-4 flex flex-col items-center gap-2 text-center relative overflow-hidden transition-colors cursor-pointer min-h-[110px] justify-center select-none active:bg-white/5",
                      unlocked ? "bg-surface-elevated/40" : "bg-transparent"
                    )}
                  >
                    {!unlocked && !reducedMotion && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--flow-pulse-color)_5%,transparent)] to-transparent animate-[shimmer_3s_infinite]" />
                    )}
                    <div className="text-2xl leading-none" style={{ filter: unlocked ? 'none' : 'grayscale(1) opacity(0.3)' }}>
                      {ach.icon}
                    </div>

                    <div className="text-[11px] font-medium leading-tight min-h-[28px] flex items-center" style={{ color: unlocked ? 'var(--text-main)' : 'var(--text-subtle)' }}>
                      {t(ach.title)}
                    </div>

                    <div className="font-mono text-[9px] tracking-[0.08em] uppercase" style={{ color: unlocked ? RARITY_COLORS[rarity] : 'var(--text-subtle)' }}>
                      {getRarityLabel(rarity, t)}
                    </div>

                    {activeAchId === ach.id && (
                      <div className="absolute inset-0 bg-surface-card border border-border-light flex flex-col items-center justify-center p-2 z-20 text-xs rounded-xl shadow-lg animate-in fade-in zoom-in-95 duration-100">
                        <div className="font-semibold text-text-main text-label-sm leading-tight mb-1">
                          {t(ach.title)}
                        </div>
                        <div className="text-label text-text-muted leading-snug">
                          {getAchievementDescription(ach, t)}
                        </div>
                        <div className="text-[9px] mt-2 uppercase font-bold tracking-wider" style={{ color: unlocked ? RARITY_COLORS[rarity] : 'var(--text-subtle)' }}>
                          {unlocked ? t('profile_achievement_done') : t('profile_achievement_locked')}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
