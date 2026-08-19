import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  getRestoreDismissedKey,
  isRestoreDismissed,
  setRestoreDismissed,
} from '../hooks/useEmptyDeviceDetection';

describe('useEmptyDeviceDetection helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('generates the correct key for user id', () => {
    expect(getRestoreDismissedKey('user_abc')).toBe('jw_restore_prompt_dismissed_user_abc');
  });

  it('correctly reports dismissed state', () => {
    expect(isRestoreDismissed('user_abc')).toBe(false);
    setRestoreDismissed('user_abc', true);
    expect(isRestoreDismissed('user_abc')).toBe(true);
    setRestoreDismissed('user_abc', false);
    expect(isRestoreDismissed('user_abc')).toBe(false);
  });
});
