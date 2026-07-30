import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const mockUser = { uid: 'user-a' };
// A profile that still carries the legacy fields — i.e. hasLegacyEncryption()
// is true, which is what used to be enough to demand migration.
const legacyProfile = { encryptionSalt: 'salt', encryptedDataKey: 'wrapped' };

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: mockUser, profile: legacyProfile }),
}));

const isVaultUnlocked = vi.fn(() => false);
vi.mock('../../../../core/crypto/encrypt', () => ({
  isVaultUnlocked: () => isVaultUnlocked(),
  setSessionKey: vi.fn(),
  decryptContent: vi.fn(),
}));

vi.mock('../../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: (sel: (s: unknown) => unknown) => sel({ isVaultUnlocked: false }),
  setRememberDevice: vi.fn(),
}));

vi.mock('../../../../core/crypto/keyVaultCache', () => ({
  loadDeviceKey: vi.fn().mockResolvedValue(null),
  clearDeviceKey: vi.fn(),
}));

vi.mock('../../../../core/crypto/cryptoHelpers', () => ({ setEncryptionEnabled: vi.fn() }));

const hasEncryptionMeta = vi.fn();
vi.mock('../../../../core/services/EncryptionMetaService', () => ({
  hasEncryptionMeta: () => hasEncryptionMeta(),
  getEncryptionMeta: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../../core/services/LegacyKeyMigration', () => ({
  hasLegacyEncryption: (p: unknown) => Boolean(p),
}));

const reportError = vi.fn();
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

import { useEncryptionSetup } from '../useEncryptionSetup';

describe('useEncryptionSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isVaultUnlocked.mockReturnValue(false);
  });

  /**
   * The read tells us whether this vault already migrated. When it fails we do
   * not know — and offering migration then is fail-dangerous: a Firestore
   * outage presented an irreversible key re-wrap to a user whose vault was
   * fine, in a modal with no exit.
   */
  it('does not demand migration when the encryptionMeta read fails', async () => {
    hasEncryptionMeta.mockRejectedValue(new Error('resource-exhausted'));

    const { result } = renderHook(() => useEncryptionSetup());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe('none');
    expect(reportError).toHaveBeenCalled();
  });

  it('still demands migration when the read succeeds and says there is no new metadata', async () => {
    hasEncryptionMeta.mockResolvedValue(false);

    const { result } = renderHook(() => useEncryptionSetup());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe('migrate');
  });

  it('can be dismissed, so the prompt is never a trap', async () => {
    hasEncryptionMeta.mockResolvedValue(false);

    const { result } = renderHook(() => useEncryptionSetup());
    await waitFor(() => expect(result.current.mode).toBe('migrate'));

    act(() => { result.current.dismiss(); });
    expect(result.current.mode).toBe('none');
  });
});
