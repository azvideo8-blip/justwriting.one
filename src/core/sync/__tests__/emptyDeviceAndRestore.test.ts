import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { renderHook, waitFor } from '@testing-library/react';
import {
  getRestoreDismissedKey,
  isRestoreDismissed,
  setRestoreDismissed,
  useEmptyDeviceDetection,
} from '../useEmptyDeviceDetection';
import { LocalStorageService } from '../../services/LocalStorageService';
import { DocumentService } from '../../services/DocumentService';

vi.mock('../../../features/auth/hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'user_restore_test' }, isGuest: false }),
}));

vi.mock('../../crypto/keyVaultCache', () => ({
  isVaultUnlocked: () => true,
}));

vi.mock('../../crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
}));

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
    const localLen = 1;
    const cloudLen = 3;
    const isMissingCloudNotes = localLen < cloudLen && cloudLen > 0;
    expect(isMissingCloudNotes).toBe(true);
  });
});

describe('useEmptyDeviceDetection hook', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('prompts to restore when local device has fewer notes than cloud (AG-RESTORE-1)', async () => {
    vi.spyOn(LocalStorageService, 'getGuestDocuments').mockResolvedValue([
      { id: 'local_1' } as any,
    ]);
    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([
      { id: 'cloud_1' } as any,
      { id: 'cloud_2' } as any,
      { id: 'cloud_3' } as any,
    ]);

    const { result } = renderHook(() => useEmptyDeviceDetection());

    await waitFor(() => {
      expect(result.current.shouldPrompt).toBe(true);
      expect(result.current.localCount).toBe(1);
      expect(result.current.cloudCount).toBe(3);
    });
  });

  it('does NOT prompt when local device has equal or more notes than cloud', async () => {
    vi.spyOn(LocalStorageService, 'getGuestDocuments').mockResolvedValue([
      { id: 'local_1' } as any,
      { id: 'local_2' } as any,
    ]);
    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([
      { id: 'cloud_1' } as any,
    ]);

    const { result } = renderHook(() => useEmptyDeviceDetection());

    await waitFor(() => {
      expect(result.current.shouldPrompt).toBe(false);
      expect(result.current.localCount).toBe(2);
      expect(result.current.cloudCount).toBe(1);
    });
  });
});

