import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTimerStore, getSavedWordGoal, saveWordGoal } from '../useTimerStore';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: 'user_goal_test' }),
}));

describe('D-19: Word goal persistence across reloads and onboarding', () => {
  const UID = 'user_goal_test';

  beforeEach(() => {
    localStorage.clear();
  });

  // Q-11 (решение владельца 2026-10-18): без сохранённой цели цели нет — 0, а не
  // 1000. Полоса слов и «/ 1000» появляются только когда человек выбрал цель
  // (в попапе целей или в режиме «Слова», куда он входит со 1000). Прежнее
  // поведение D-19 давало полосу у каждой новой сессии на десктопе.
  it('defaults to no goal when nothing is saved in localStorage', () => {
    expect(getSavedWordGoal(UID)).toBe(0);
  });

  it('saves word goal to user-scoped key in localStorage on saveWordGoal', () => {
    saveWordGoal(500, UID);
    expect(localStorage.getItem(STORAGE_KEYS.WORD_GOAL(UID))).toBe('500');
    expect(getSavedWordGoal(UID)).toBe(500);
  });

  it('persists word goal to localStorage when setWordGoal is called in useTimerStore', () => {
    useTimerStore.getState().setWordGoal(750);
    expect(localStorage.getItem(STORAGE_KEYS.WORD_GOAL(UID))).toBe('750');
    expect(useTimerStore.getState().wordGoal).toBe(750);
  });

  it('handles invalid / non-numeric values in localStorage as no goal', () => {
    localStorage.setItem(STORAGE_KEYS.WORD_GOAL(UID), 'invalid');
    expect(getSavedWordGoal(UID)).toBe(0);

    localStorage.setItem(STORAGE_KEYS.WORD_GOAL(UID), '-10');
    expect(getSavedWordGoal(UID)).toBe(0);
  });
});
