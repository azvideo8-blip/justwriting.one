import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../core/storage/localDb';

const USER = 'u_real_wipe_fail';

vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: USER, email: 'user@example.com' }),
  getCurrentUserId: () => USER,
  signOutUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../core/crypto/keyVaultCache', () => ({
  clearDeviceKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: {
    getState: () => ({ lockVault: vi.fn() }),
  },
}));

vi.mock('../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

describe('Area 1 & 5: clearAllLocalStores must rethrow so signOut detects failed wipe', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it('FAILING TEST: when clearAllLocalStores fails internally, signOut must throw LocalWipeFailedError', async () => {
    const db = await getLocalDb();

    // Mock db.transaction to fail during clearAllLocalStores
    vi.spyOn(db, 'transaction').mockImplementation(() => {
      throw new Error('IDB transaction failed during wipe');
    });

    const { AuthService } = await import('../services/AuthService');

    // Expected: wipe failed, so signOut MUST reject with LocalWipeFailedError
    await expect(AuthService.signOut({ clearLocalData: true, force: true })).rejects.toMatchObject({
      name: 'LocalWipeFailedError',
    });
  });
});
