import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { calculateStreak, calculateBestStreak } from '../utils';
import { clearFrozenDates } from '../streakFreeze';

function makeSession(daysAgo: number): import('../../../types').Session {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(12, 0, 0, 0);
  return {
    id: `s-${daysAgo}`,
    userId: 'u1',
    content: '',
    duration: 60,
    wordCount: 100,
    charCount: 0,
    wpm: 0,
    title: '',
    tags: [],
    createdAt: d,
    sessionStartTime: d.getTime(),
  };
}

beforeEach(() => {
  clearFrozenDates();
});

describe('calculateStreak', () => {
  it('[] → 0', () => {
    expect(calculateStreak([])).toBe(0);
  });

  it('session today only → 1', () => {
    expect(calculateStreak([makeSession(0)])).toBe(1);
  });

  it('session yesterday only → 1', () => {
    expect(calculateStreak([makeSession(1)])).toBe(1);
  });

  it('sessions today + yesterday → 2', () => {
    expect(calculateStreak([makeSession(0), makeSession(1)])).toBe(2);
  });

  it('sessions today + yesterday + 5 days ago → 2 (gap breaks streak)', () => {
    expect(calculateStreak([makeSession(0), makeSession(1), makeSession(5)])).toBe(2);
  });

  it('last session 2 days ago → 0 (neither today nor yesterday)', () => {
    expect(calculateStreak([makeSession(2)])).toBe(0);
  });

  it('multiple sessions same day count as 1', () => {
    expect(calculateStreak([makeSession(0), makeSession(0), makeSession(0)])).toBe(1);
  });

  it('sessions in random order → correctly computed', () => {
    expect(calculateStreak([makeSession(2), makeSession(0), makeSession(1), makeSession(5)])).toBe(3);
  });
});

describe('calculateBestStreak', () => {
  it('[] → 0', () => {
    expect(calculateBestStreak([])).toBe(0);
  });

  it('10 consecutive days → 10', () => {
    const sessions = Array.from({ length: 10 }, (_, i) => makeSession(9 - i));
    expect(calculateBestStreak(sessions)).toBe(10);
  });

  it('5 days, gap, 3 days → 5', () => {
    const first5 = Array.from({ length: 5 }, (_, i) => makeSession(20 - i));
    const last3 = Array.from({ length: 3 }, (_, i) => makeSession(2 - i));
    expect(calculateBestStreak([...first5, ...last3])).toBe(5);
  });

  it('all same day → 1', () => {
    expect(calculateBestStreak([makeSession(0), makeSession(0), makeSession(0)])).toBe(1);
  });
});

describe('streak freeze', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2024, 5, 15) });
    clearFrozenDates();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1-day gap bridged by freeze', () => {
    expect(calculateStreak([makeSession(0), makeSession(1), makeSession(3)])).toBe(4);
  });

  it('2-day gap (2 missed days) not bridged', () => {
    expect(calculateStreak([makeSession(0), makeSession(1), makeSession(4)])).toBe(2);
  });

  it('second 1-day gap in same month breaks streak', () => {
    expect(calculateStreak([makeSession(0), makeSession(1), makeSession(3), makeSession(5), makeSession(6)])).toBe(4);
  });

  it('freeze persisted across computations', () => {
    expect(calculateStreak([makeSession(0), makeSession(1), makeSession(3)])).toBe(4);
    expect(calculateStreak([makeSession(0), makeSession(1), makeSession(3)])).toBe(4);
  });

  it('calculateBestStreak bridges 1-day gap with freeze', () => {
    const sessions = [
      ...Array.from({ length: 5 }, (_, i) => makeSession(i)),
      ...Array.from({ length: 3 }, (_, i) => makeSession(6 + i)),
    ];
    expect(calculateBestStreak(sessions)).toBe(9);
  });
});
