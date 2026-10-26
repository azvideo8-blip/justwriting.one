// RA1-6 (решение владельца 2026-10-24): серия прощает ОДИН пропуск. Раньше
// заморозка закрывала только дырку ВНУТРИ серии, а «сегодня пусто, вчера
// пусто, позавчера писала» обнуляло её на следующий же день. Теперь один
// пустой день между последней записью и сегодня тоже прощается — на том же
// праве заморозки (одна в месяц), и это видно интерфейсу.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { calculateStreak, calculateStreakInfo } from '../utils';
import { clearFrozenDates, saveFrozenDates } from '../streakFreeze';
import { format } from 'date-fns';

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

describe('RA1-6: один пропущенный день не обнуляет серию', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 9, 24, 12) });
    clearFrozenDates();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('последняя запись позавчера, вчера пусто → серия жива (2 — как и дырка внутри)', () => {
    const info = calculateStreakInfo([makeSession(2)]);
    expect(info.days).toBe(2);
    expect(info.freezeUsed, 'пропуск закрыт заморозкой — это видно').toBe(true);
  });

  it('две пустых дня подряд → серия обнуляется', () => {
    expect(calculateStreak([makeSession(3)])).toBe(0);
  });

  it('прощённый пропуск продолжает ряд назад', () => {
    const info = calculateStreakInfo([makeSession(2), makeSession(3), makeSession(4)]);
    expect(info.days).toBe(4);
    expect(info.freezeUsed).toBe(true);
  });

  it('заморозка этого месяца уже истрачена — пропуск не прощается', () => {
    const month = format(new Date(2026, 9, 24), 'yyyy-MM');
    saveFrozenDates(new Set([`${month}-01`]));
    expect(calculateStreakInfo([makeSession(2)]).days).toBe(0);
  });

  it('без пропуска заморозка не тратится', () => {
    const info = calculateStreakInfo([makeSession(0), makeSession(1)]);
    expect(info.days).toBe(2);
    expect(info.freezeUsed).toBe(false);
  });
});
