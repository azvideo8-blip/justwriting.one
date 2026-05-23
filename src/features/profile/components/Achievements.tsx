import { useState, useEffect, useRef, startTransition } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useLanguage } from '../../../core/i18n';
import { reportError } from '../../../core/errors/reportError';
import { Session, Achievement } from '../../../types';
import { ACHIEVEMENTS as ACH_DATA } from '../constants/achievements';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { ProfileService } from '../services/ProfileService';
import { calculateBestStreak } from '../../../core/utils/utils';

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
  common: 'rgba(255,255,255,0.5)',
  rare: 'var(--brand-soft)',
  epic: 'var(--flow-pulse-color)',
  legendary: '#f5c518',
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
  }, [user]);

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
  }, [stats, sessions, user]);

  const totalAchievements = GROUPS.reduce((s, g) => s + g.achievements.length, 0);
  const unlockedCount = GROUPS.reduce((s, g) =>
    s + g.achievements.filter(a => unlockedIds.has(a.id)).length, 0);
  const legendaryCount = GROUPS.reduce((s, g) =>
    s + g.achievements.filter((a, i) =>
      g.rarities[i] === 'legendary' && unlockedIds.has(a.id)
    ).length, 0);

  return (
    <div style={{ padding: '24px 36px' }}>
      <h2 className="text-[18px] font-medium text-text-main mb-1">
        {t('profile_achievements_title')}
      </h2>
      <div className="flex gap-4 mb-6 font-mono text-[11px] text-text-muted uppercase tracking-widest">
        <span>{unlockedCount} / {totalAchievements} {t('profile_ach_opened')}</span>
        {legendaryCount > 0 && (
          <span style={{ color: RARITY_COLORS.legendary }}>
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
            initial={reducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: gi * 0.08 }}
            className="mb-8"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="font-mono text-[11px] text-text-muted uppercase tracking-widest">
                {t(group.labelKey)}
              </div>
              <div className="font-mono text-[11px] text-text-subtle">
                {groupUnlocked} / {group.achievements.length}
              </div>
            </div>

            <div style={{ height: 3, borderRadius: 2, background: 'var(--surface-elevated)', marginBottom: 12, overflow: 'hidden' }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${groupProgress * 100}%` }}
                transition={{ duration: 0.6, delay: gi * 0.08 + 0.1, ease: 'easeOut' }}
                style={{ height: '100%', borderRadius: 2, background: 'var(--flow-pulse-color)' }}
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(6, 1fr)',
                border: '1px solid var(--border-light)',
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              {group.achievements.map((ach, i) => {
                const unlocked = unlockedIds.has(ach.id);
                const rarity = group.rarities[i];
                const cols = 6;
                const row = Math.floor(i / cols);
                const totalRows = Math.ceil(group.achievements.length / cols);
                const isLastRow = row === totalRows - 1;
                const isLastCol = (i + 1) % cols === 0;

                return (
                  <div
                    key={ach.id}
                    title={t(ach.title)}
                    style={{
                      padding: '16px 12px',
                      borderRight: isLastCol ? 'none' : '1px solid var(--border-light)',
                      borderBottom: isLastRow ? 'none' : '1px solid var(--border-light)',
                      background: unlocked
                        ? 'var(--surface-elevated)'
                        : 'transparent',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 8,
                      textAlign: 'center',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    {!unlocked && !reducedMotion && (
                      <div style={{
                        position: 'absolute', inset: 0,
                        background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--flow-pulse-color) 5%, transparent), transparent)',
                        animation: 'shimmer 3s infinite',
                      }} />
                    )}
                    <div style={{
                      fontSize: 24,
                      filter: unlocked ? 'none' : 'grayscale(1) opacity(0.3)',
                      lineHeight: 1,
                    }}>
                      {ach.icon}
                    </div>

                    <div style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: unlocked ? 'var(--text-main)' : 'var(--text-subtle)',
                      lineHeight: 1.3,
                      minHeight: 28,
                    }}>
                      {t(ach.title)}
                    </div>

                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      letterSpacing: '.08em',
                      textTransform: 'uppercase',
                      color: unlocked ? RARITY_COLORS[rarity] : 'var(--text-subtle)',
                    }}>
                      {getRarityLabel(rarity, t)}
                    </div>
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
