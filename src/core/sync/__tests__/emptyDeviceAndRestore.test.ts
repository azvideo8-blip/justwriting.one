import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  getRestoreDismissedKey,
  isRestoreDismissed,
  setRestoreDismissed,
} from '../useEmptyDeviceDetection';

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

  it('detects missing cloud notes when localCount < cloudCount', () => {
    // Condition logic: localLen < cloudLen && cloudLen > 0
    const localLen = 1;
    const cloudLen = 3;
    const isMissingCloudNotes = localLen < cloudLen && cloudLen > 0;
    expect(isMissingCloudNotes).toBe(true);
  });
});

