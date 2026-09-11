import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getFrozenDates,
  saveFrozenDates,
  clearFrozenDates,
  wasFreezeUsedThisMonth,
  syncStreakFreezesWithCloud,
} from '../streakFreeze';
import { consumeStreakFreezes, calculateStreak } from '../utils';
import { DataProvider } from '../../data';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { Session } from '../../../types';
import { useEncryptionStore } from '../../crypto/useEncryptionStore';

describe('S-19: streak freeze user scoping and multi-device cloud sync', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('isolates streak freezes per user and guest in localStorage', () => {
    const userA = 'user-a';
    const userB = 'user-b';

    saveFrozenDates(new Set(['2026-09-01']), userA);
    saveFrozenDates(new Set(['2026-09-02']), userB);
    saveFrozenDates(new Set(['2026-09-03']), null); // guest

    expect(Array.from(getFrozenDates(userA))).toEqual(['2026-09-01']);
    expect(Array.from(getFrozenDates(userB))).toEqual(['2026-09-02']);
    expect(Array.from(getFrozenDates(null))).toEqual(['2026-09-03']);

    // Check specific keys in localStorage
    expect(localStorage.getItem(STORAGE_KEYS.STREAK_FREEZES(userA))).toBe(JSON.stringify(['2026-09-01']));
    expect(localStorage.getItem(STORAGE_KEYS.STREAK_FREEZES(userB))).toBe(JSON.stringify(['2026-09-02']));
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_STREAK_FREEZES)).toBe(JSON.stringify(['2026-09-03']));
  });

  it('clearFrozenDates clears only the specified user dates', () => {
    const userA = 'user-a';
    const userB = 'user-b';

    saveFrozenDates(new Set(['2026-09-01']), userA);
    saveFrozenDates(new Set(['2026-09-02']), userB);

    clearFrozenDates(userA);

    expect(getFrozenDates(userA).size).toBe(0);
    expect(Array.from(getFrozenDates(userB))).toEqual(['2026-09-02']);
  });

  it('syncStreakFreezesWithCloud synchronizes freezes from device A to device B', async () => {
    const userId = 'user-sync-test';
    // Same envelope as every other local_store_records row: { data: json, updatedAt }.
    const cloudStore: Record<string, unknown> = {
      data: JSON.stringify(['2026-09-05']),
      updatedAt: 1,
    };

    vi.spyOn(DataProvider, 'getLocalStoreRecord').mockImplementation(async (_uid, store, key) => {
      if (store === 'streak_freezes' && key === 'dates') {
        return { store, key, payload: cloudStore };
      }
      return null;
    });

    const mockSave = vi.spyOn(DataProvider, 'saveLocalStoreRecord').mockResolvedValue(undefined);

    // Device B starts with no local freezes
    expect(getFrozenDates(userId).size).toBe(0);

    // Device B runs sync with cloud
    const merged = await syncStreakFreezesWithCloud(userId, true);

    expect(Array.from(merged)).toEqual(['2026-09-05']);
    expect(Array.from(getFrozenDates(userId))).toEqual(['2026-09-05']);
    expect(wasFreezeUsedThisMonth(userId)).toBe(true);

    // No need to upload if cloud already had all local dates
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('syncStreakFreezesWithCloud merges two-way differences and uploads union', async () => {
    const userId = 'user-sync-merge';
    // The cloud write goes through maybeEncrypt, which refuses before the
    // profile is known (ENCRYPT_REQUIRED) — same rule as every store record.
    useEncryptionStore.getState().setProfileLoaded(userId, true);
    let cloudDates = ['2026-08-10'];

    vi.spyOn(DataProvider, 'getLocalStoreRecord').mockImplementation(async () => ({
      store: 'streak_freezes',
      key: 'dates',
      payload: { data: JSON.stringify(cloudDates), updatedAt: 1 },
    }));

    vi.spyOn(DataProvider, 'saveLocalStoreRecord').mockImplementation(async (_uid, _s, _k, payload) => {
      cloudDates = JSON.parse(payload.data as string) as string[];
    });

    // Device local has '2026-09-01'
    saveFrozenDates(new Set(['2026-09-01']), userId);

    const merged = await syncStreakFreezesWithCloud(userId, true);

    expect(merged.has('2026-08-10')).toBe(true);
    expect(merged.has('2026-09-01')).toBe(true);
    expect(merged.size).toBe(2);

    // Local storage updated with union
    expect(getFrozenDates(userId).size).toBe(2);
    // Cloud updated with union
    expect(cloudDates.sort()).toEqual(['2026-08-10', '2026-09-01']);
  });

  it('adopts the pre-S-19 un-keyed entry once for the first account that reads it', () => {
    localStorage.setItem(STORAGE_KEYS.GUEST_STREAK_FREEZES, JSON.stringify(['2026-09-03']));
    expect(Array.from(getFrozenDates('user-legacy'))).toEqual(['2026-09-03']);
    expect(localStorage.getItem(STORAGE_KEYS.STREAK_FREEZES('user-legacy'))).toBe(JSON.stringify(['2026-09-03']));
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_STREAK_FREEZES)).toBeNull();
  });

  it('consumeStreakFreezes uses specified userId and records freeze for that user', () => {
    const userId = 'user-consume';
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const twoDaysAgo = new Date(now.getTime() - 2 * 86400000).toISOString().slice(0, 10);

    const sessions: Session[] = [
      {
        id: 's1',
        userId,
        createdAt: new Date(today),
        wordCount: 100,
        charCount: 500,
        duration: 300,
        wpm: 20,
        content: 'test today',
      },
      {
        id: 's2',
        userId,
        createdAt: new Date(twoDaysAgo),
        wordCount: 100,
        charCount: 500,
        duration: 300,
        wpm: 20,
        content: 'test 2 days ago',
      },
    ];

    // Gap between today and twoDaysAgo consumes a freeze
    const frozen = consumeStreakFreezes(sessions, userId);
    expect(frozen.size).toBe(1);

    // User has frozen dates, guest does not
    expect(getFrozenDates(userId).size).toBe(1);
    expect(getFrozenDates(null).size).toBe(0);

    // Streak is maintained using the frozen date
    const streak = calculateStreak(sessions, frozen, userId);
    expect(streak).toBe(3);
  });
});
