import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDailyLimit, incrementDailyUsage, setDailyLimitExhausted } from '../useDailyLimit';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { useAiLimitStore } from '../../store/useAiLimitStore';

// R3-041: раньше файл объявлял у себя копии incrementDailyUsage и ключа
// 'ai_daily_usage' и проверял их — прод мог сломать лимиты, а тест оставался
// зелёным. Теперь проверяется код приложения: ключ на аккаунт и счёт в сторе.
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_limit' }) }));

const DAILY_LIMIT = 5;
const KEY = STORAGE_KEYS.AI_LIMIT('u_limit');
const today = () => new Date().toISOString().slice(0, 10);
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? 'null') as { count: number; date: string } | null;

describe('useDailyLimit helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    useAiLimitStore.setState({ limit: DAILY_LIMIT, used: 0, remaining: DAILY_LIMIT, isAdmin: false });
  });

  it('starts with 0 usage', () => {
    expect(stored()).toBeNull();
  });

  it('incrementDailyUsage counts on the account key and in the store', () => {
    incrementDailyUsage();
    incrementDailyUsage();
    expect(stored()).toMatchObject({ count: 2, date: today() });
    expect(useAiLimitStore.getState().remaining).toBe(DAILY_LIMIT - 2);
  });

  it('a reasoning request does not spend the chat limit', () => {
    incrementDailyUsage(true);
    expect(stored()?.count).toBe(0);
    expect(useAiLimitStore.getState().remaining).toBe(DAILY_LIMIT);
  });

  it('setDailyLimitExhausted leaves nothing remaining', () => {
    setDailyLimitExhausted();
    expect(stored()?.count).toBe(DAILY_LIMIT);
    expect(useAiLimitStore.getState().remaining).toBe(0);
  });

  describe('F-038: useDailyLimit interval refresh', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not refresh quota while resetsAt is in the future, but refreshes once resetsAt has passed', async () => {
      const now = Date.now();
      const futureReset = new Date(now + 120_000); // 2 minutes in future
      const loadSpy = vi.fn().mockImplementation(async () => {
        useAiLimitStore.setState({ resetsAt: new Date(Date.now() + 86_400_000) });
      });

      useAiLimitStore.setState({
        loaded: true,
        resetsAt: futureReset,
        loadLimitFromServer: loadSpy,
      });

      renderHook(() => useDailyLimit());

      // Advance 60 seconds: resetsAt is still 60 seconds in the future
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });

      expect(loadSpy).not.toHaveBeenCalled();

      // Now advance another 60 seconds: resetsAt has arrived
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });

      expect(loadSpy).toHaveBeenCalledTimes(1);
    });
  });
});
