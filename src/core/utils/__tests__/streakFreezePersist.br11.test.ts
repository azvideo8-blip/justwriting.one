// BR-11 (ревью 25.10, RA1-6): два дефекта прощённого дня.
// (а) `consumeStreakFreezes` выходил раньше, чем доходил до «последняя запись
// позавчера», — `calculateStreak` считает вчерашний мост и серию, а сохранение
// не происходит: заморозка месяца считается потраченной врасчёт, но не записана.
// (б) Строка «Серия сохранена…» висела и там, где прощение лишь посчитано, но
// не записано. Исправлена честно: главный экран показывает строку только по
// записанной заморозке и сам не пишет — запись делает профиль, где перед ней
// идёт слияние наборов с облаком (`syncStreakFreezesWithCloud`), а без него
// второй прибор перезаписал бы чужой набор и потерял свой прощённый день.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { format, subDays } from 'date-fns';
import { consumeStreakFreezes, calculateStreakInfo } from '../utils';
import { getFrozenDates, clearFrozenDates } from '../streakFreeze';
import { useStreak } from '../../../features/writing/hooks/useStreak';
import type { Session } from '../../../types';

const UID = 'u_br11';
const dayKey = (d: Date) => format(d, 'yyyy-MM-dd');
const TODAY = new Date();
const YESTERDAY = subDays(TODAY, 1);
const TWO_DAYS_AGO = subDays(TODAY, 2);

function sessionOn(date: Date): Session {
  const start = new Date(date);
  start.setHours(12, 0, 0, 0);
  return {
    id: `s_${dayKey(start)}`,
    userId: UID,
    title: 'Синтетическая сессия',
    content: 'текст',
    createdAt: start,
    sessionStartTime: start.getTime(),
    duration: 60,
    wordCount: 5,
    charCount: 10,
    wpm: 5,
    tags: [],
  } as unknown as Session;
}

beforeEach(() => {
  clearFrozenDates(UID);
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('BR-11 (а): прощённый день «позавчера» сохраняется', () => {
  it('consumeStreakFreezes записывает вчерашний мост, когда последняя запись — позавчера', () => {
    const sessions = [sessionOn(TWO_DAYS_AGO), sessionOn(subDays(TODAY, 3))];

    const frozen = consumeStreakFreezes(sessions, UID);

    expect(frozen.has(dayKey(YESTERDAY)), 'вчерашний день не в наборе').toBe(true);
    expect(getFrozenDates(UID).has(dayKey(YESTERDAY)), 'набор не сохранён').toBe(true);
  });

  it('второй прощент в том же месяце не берётся: серия без права на мост — 0', () => {
    // Уже заморожен другой день месяца, в котором пропущено вчера. Не TODAY−10:
    // 1–10-го он попадает в прошлый месяц, и тест краснел по календарю
    // (02.11: серия 2 вместо 0).
    const other = dayKey(new Date(
      YESTERDAY.getFullYear(),
      YESTERDAY.getMonth(),
      YESTERDAY.getDate() === 1 ? 2 : 1,
    ));
    localStorage.setItem(`jw_streak_freezes_${UID}`, JSON.stringify([other]));

    const info = calculateStreakInfo([sessionOn(TWO_DAYS_AGO)], undefined, UID);

    expect(info.days, 'месяц уже использован, а серия посчитана с мостом').toBe(0);
  });
});

describe('BR-11 (б): главный экран про незамороженное не врёт и сам не пишет', () => {
  it('мост «позавчера» ещё не записан — строки «Серия сохранена» нет', () => {
    const groups = [{ date: TWO_DAYS_AGO, sessions: [sessionOn(TWO_DAYS_AGO)] }];

    const { result } = renderHook(() => useStreak(groups, UID));

    expect(result.current.days, 'серия не посчитана с мостом').toBe(2);
    expect(result.current.freezeUsed, 'строка показала незаписанную заморозку').toBe(false);
    // И главный ничего не морозит: запись делает профиль, где есть слияние с
    // облаком. Без него второй Device потерял бы свой прощённый день.
    expect(getFrozenDates(UID).size, 'главный экран записал заморозку').toBe(0);
  });

  it('после записи (путь профиля) — строка появляется', () => {
    const sessions = [sessionOn(TWO_DAYS_AGO)];
    consumeStreakFreezes(sessions, UID);

    const { result } = renderHook(() => useStreak([{ date: TWO_DAYS_AGO, sessions }], UID));

    expect(result.current.days).toBe(2);
    expect(result.current.freezeUsed, 'записанное прощение не показано').toBe(true);
  });

  it('calculateStreakInfo называет дни, закрытые мостом', () => {
    const info = calculateStreakInfo([sessionOn(TWO_DAYS_AGO)], undefined, UID);
    expect(info.freezeDays, 'мост не назван').toEqual([dayKey(YESTERDAY)]);
    expect(calculateStreakInfo([sessionOn(subDays(TODAY, 3))], undefined, UID).freezeDays).toEqual([]);
  });
});

describe('Ревью 26.10: строка «Серия сохранена» — только про свежий пропуск', () => {
  it('записанный мост 10 дней назад в серии из 20 дней — строки нет', () => {
    const sessions = Array.from({ length: 21 }, (_, i) => i)
      .filter(i => i !== 10)
      .map(i => sessionOn(subDays(TODAY, i)));
    consumeStreakFreezes(sessions, UID);
    expect(getFrozenDates(UID).has(dayKey(subDays(TODAY, 10))), 'мост не записан — тест пуст').toBe(true);

    const { result } = renderHook(() => useStreak([{ date: TODAY, sessions }], UID));

    expect(result.current.days, 'серия не прошла через мост').toBe(21);
    expect(result.current.freezeUsed, 'старый мост держит строку всю серию').toBe(false);
  });
});
