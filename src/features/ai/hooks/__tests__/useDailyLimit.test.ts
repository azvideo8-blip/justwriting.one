import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDailyLimit } from '../useDailyLimit';
import { useAiLimitStore } from '../../store/useAiLimitStore';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

const DAILY_LIMIT = 5;
const STORAGE_KEY = 'ai_daily_usage';

function getUtcDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function incrementDailyUsage(): void {
  const today = getUtcDateStr();
  const raw = localStorage.getItem(STORAGE_KEY);
  let count = 0;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { count: number; date: string };
      if (parsed.date === today) count = parsed.count;
    } catch { /* ignore */ }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ count: count + 1, date: today }));
}

function setDailyLimitExhausted(): void {
  const today = getUtcDateStr();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ count: DAILY_LIMIT, date: today }));
}

describe('useDailyLimit helpers', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('starts with 0 usage', () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeNull();
  });

  it('incrementDailyUsage increments count', () => {
    incrementDailyUsage();
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.count).toBe(1);
    expect(parsed.date).toBe(getUtcDateStr());
  });

  it('incrementDailyUsage accumulates correctly', () => {
    incrementDailyUsage();
    incrementDailyUsage();
    incrementDailyUsage();
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.count).toBe(3);
  });

  it('setDailyLimitExhausted sets count to limit', () => {
    setDailyLimitExhausted();
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.count).toBe(DAILY_LIMIT);
  });

  it('remaining calculation after increment', () => {
    incrementDailyUsage();
    incrementDailyUsage();
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!) as { count: number };
    const remaining = Math.max(0, DAILY_LIMIT - parsed.count);
    expect(remaining).toBe(3);
  });

  it('remaining is 0 after exhausted', () => {
    setDailyLimitExhausted();
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!) as { count: number };
    const remaining = Math.max(0, DAILY_LIMIT - parsed.count);
    expect(remaining).toBe(0);
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
