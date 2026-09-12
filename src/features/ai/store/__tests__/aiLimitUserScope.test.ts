import { describe, it, expect, beforeEach, vi } from 'vitest';

let mockCurrentUser: { uid: string } | null = null;

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => mockCurrentUser,
}));

vi.mock('../../../../core/ai/callAi', () => ({
  callAi: vi.fn(),
}));

import { useAiLimitStore } from '../useAiLimitStore';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';

describe('S-09: useAiLimitStore user-scoped key', () => {
  const today = new Date().toISOString().slice(0, 10);

  beforeEach(() => {
    localStorage.clear();
    mockCurrentUser = null;
    useAiLimitStore.setState({
      used: 0,
      remaining: 30,
      reasoningUsed: 0,
      reasoningRemaining: 5,
    });
  });

  it('isolates counts between two uids on the same browser', () => {
    // User A
    mockCurrentUser = { uid: 'user-a' };
    useAiLimitStore.getState().useRequest(false);
    expect(useAiLimitStore.getState().used).toBe(1);
    expect(localStorage.getItem(STORAGE_KEYS.AI_LIMIT('user-a'))).toContain('"count":1');

    // User B switches in
    mockCurrentUser = { uid: 'user-b' };
    useAiLimitStore.getState().loadLimit();
    expect(useAiLimitStore.getState().used).toBe(0);

    useAiLimitStore.getState().useRequest(false);
    useAiLimitStore.getState().useRequest(false);
    expect(useAiLimitStore.getState().used).toBe(2);
    expect(localStorage.getItem(STORAGE_KEYS.AI_LIMIT('user-b'))).toContain('"count":2');

    // User A returns
    mockCurrentUser = { uid: 'user-a' };
    useAiLimitStore.getState().loadLimit();
    expect(useAiLimitStore.getState().used).toBe(1);
  });

  it('adopts legacy un-keyed value once for the current account then removes it', () => {
    localStorage.setItem(STORAGE_KEYS.AI_DAILY_USAGE, JSON.stringify({ count: 7, date: today }));
    mockCurrentUser = { uid: 'migrated-user' };

    useAiLimitStore.getState().loadLimit();

    expect(useAiLimitStore.getState().used).toBe(7);
    expect(localStorage.getItem(STORAGE_KEYS.AI_LIMIT('migrated-user'))).toContain('"count":7');
    expect(localStorage.getItem(STORAGE_KEYS.AI_DAILY_USAGE)).toBeNull();
  });

  it('guests share ai_daily_usage key', () => {
    mockCurrentUser = null;
    useAiLimitStore.getState().useRequest(false);
    expect(useAiLimitStore.getState().used).toBe(1);
    expect(localStorage.getItem('ai_daily_usage')).toContain('"count":1');
  });
});
