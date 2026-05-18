import { describe, it, expect } from 'vitest';
import { calcMaxHistoricalStreak, checkAchievement } from '../components/Achievements';
import type { Session, Achievement } from '../../../types/index';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: Math.random().toString(36).slice(2),
    userId: 'u1',
    content: '',
    duration: 0,
    wordCount: 0,
    charCount: 0,
    wpm: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

/** Build a Session whose date (via sessionStartTime) falls on a specific day.
 *  dayOffset 0 = today, 1 = yesterday, etc. */
function sessionOnDay(dayOffset: number): Session {
  const d = new Date();
  d.setDate(d.getDate() - dayOffset);
  d.setHours(12, 0, 0, 0);
  return makeSession({ sessionStartTime: d.getTime() });
}

function makeStats(overrides: Partial<{
  totalWords: number;
  streakDays: number;
  sessionsCount: number;
  avgSessionMins: number;
  typicalHour: string;
  wordsPerDay: number;
}> = {}) {
  return {
    totalWords: 0,
    streakDays: 0,
    sessionsCount: 0,
    avgSessionMins: 0,
    typicalHour: '10:00',
    wordsPerDay: 0,
    ...overrides,
  };
}

function makeAch(overrides: Partial<Achievement>): Achievement {
  return {
    id: 'words_1000',
    title: 'Test',
    icon: '🏆',
    threshold: 1000,
    tier: 'common',
    ...overrides,
  };
}

// ─── calcMaxHistoricalStreak ──────────────────────────────────────────────────

describe('calcMaxHistoricalStreak', () => {
  it('returns 0 for empty sessions array', () => {
    expect(calcMaxHistoricalStreak([])).toBe(0);
  });

  it('returns 1 for a single session', () => {
    expect(calcMaxHistoricalStreak([sessionOnDay(0)])).toBe(1);
  });

  it('returns 7 for 7 consecutive days', () => {
    const sessions = [0, 1, 2, 3, 4, 5, 6].map(sessionOnDay);
    expect(calcMaxHistoricalStreak(sessions)).toBe(7);
  });

  it('breaks streak on a gap: [Mon, Tue, Thu, Fri] → max 2', () => {
    // offsets: 0=today, 1=yesterday, 3=three days ago, 4=four days ago
    const sessions = [sessionOnDay(0), sessionOnDay(1), sessionOnDay(3), sessionOnDay(4)];
    expect(calcMaxHistoricalStreak(sessions)).toBe(2);
  });

  it('two sessions same day count as 1 day in streak', () => {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    const d2 = new Date(d);
    d2.setHours(20, 0, 0, 0);
    const s1 = makeSession({ sessionStartTime: d.getTime() });
    const s2 = makeSession({ sessionStartTime: d2.getTime() });
    // Two sessions today + one yesterday = streak 2
    const yesterday = sessionOnDay(1);
    expect(calcMaxHistoricalStreak([s1, s2, yesterday])).toBe(2);
  });

  it('works with sessions in reverse chronological order', () => {
    // Pass sessions newest-first
    const sessions = [6, 5, 4, 3, 2, 1, 0].map(sessionOnDay);
    expect(calcMaxHistoricalStreak(sessions)).toBe(7);
  });

  it('returns 30 for 30 consecutive days', () => {
    const sessions = Array.from({ length: 30 }, (_, i) => sessionOnDay(i));
    expect(calcMaxHistoricalStreak(sessions)).toBe(30);
  });

  it('takes the max of multiple streaks', () => {
    // streak of 3 at end, streak of 5 in the middle
    // days 0-2: streak 3
    // days 10-14: streak 5
    const sessions = [
      ...([0, 1, 2].map(sessionOnDay)),
      ...([10, 11, 12, 13, 14].map(sessionOnDay)),
    ];
    expect(calcMaxHistoricalStreak(sessions)).toBe(5);
  });
});

// ─── checkAchievement ────────────────────────────────────────────────────────

describe('checkAchievement', () => {
  it('words_1000 unlocks at exactly 1000 total words', () => {
    const ach = makeAch({ id: 'words_1000', threshold: 1000 });
    expect(checkAchievement(ach, makeStats({ totalWords: 1000 }), [])).toBe(true);
  });

  it('words_1000 does NOT unlock at 999 words', () => {
    const ach = makeAch({ id: 'words_1000', threshold: 1000 });
    expect(checkAchievement(ach, makeStats({ totalWords: 999 }), [])).toBe(false);
  });

  it('streak_7 unlocks when stats.streakDays >= 7', () => {
    const ach = makeAch({ id: 'streak_7', threshold: 7 });
    expect(checkAchievement(ach, makeStats({ streakDays: 7 }), [])).toBe(true);
  });

  it('streak_7 unlocks when historical max streak >= 7 even if current streak < 7', () => {
    const ach = makeAch({ id: 'streak_7', threshold: 7 });
    // 7 consecutive sessions in history, but current streakDays = 0
    const sessions = [0, 1, 2, 3, 4, 5, 6].map(sessionOnDay);
    expect(checkAchievement(ach, makeStats({ streakDays: 0 }), sessions)).toBe(true);
  });

  it('notes_10 unlocks at sessionsCount >= 10', () => {
    const ach = makeAch({ id: 'notes_10', threshold: 10 });
    expect(checkAchievement(ach, makeStats({ sessionsCount: 10 }), [])).toBe(true);
    expect(checkAchievement(ach, makeStats({ sessionsCount: 9 }), [])).toBe(false);
  });

  it('duration_60 unlocks when any single session >= 60 minutes (3600s)', () => {
    const ach = makeAch({ id: 'duration_60', threshold: 60 });
    const sessions = [makeSession({ duration: 3600 })]; // exactly 60 min
    expect(checkAchievement(ach, makeStats(), sessions)).toBe(true);
  });

  it('duration_60 does NOT unlock if all sessions < 60 min', () => {
    const ach = makeAch({ id: 'duration_60', threshold: 60 });
    const sessions = [makeSession({ duration: 3599 })]; // 59m59s
    expect(checkAchievement(ach, makeStats(), sessions)).toBe(false);
  });

  it('duration_90 does NOT unlock at 89m59s (5399s) — strict Math.floor', () => {
    const ach = makeAch({ id: 'duration_90', threshold: 90 });
    const sessions = [makeSession({ duration: 5399 })]; // 89m59s
    expect(checkAchievement(ach, makeStats(), sessions)).toBe(false);
  });

  it('duration_90 unlocks at exactly 90 minutes (5400s)', () => {
    const ach = makeAch({ id: 'duration_90', threshold: 90 });
    const sessions = [makeSession({ duration: 5400 })];
    expect(checkAchievement(ach, makeStats(), sessions)).toBe(true);
  });

  it('unknown achievement id returns false', () => {
    const ach = makeAch({ id: 'unknown_42', threshold: 0 });
    expect(checkAchievement(ach, makeStats({ totalWords: 9999 }), [])).toBe(false);
  });
});
