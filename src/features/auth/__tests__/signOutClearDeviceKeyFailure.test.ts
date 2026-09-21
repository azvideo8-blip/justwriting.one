import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { reportError } from '../../../shared/errors/reportError';
import { clearDeviceKey } from '../../../core/crypto/keyVaultCache';

const USER = 'u_guest_wipe_fail';

vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: USER, email: 'user@example.com' }),
  getCurrentUserId: () => USER,
  signOutUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: {
    getState: () => ({ lockVault: vi.fn() }),
  },
}));

vi.mock('../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

describe('ERR-11: clearDeviceKey and accountScopedKeys failure reporting during guest computer signOut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clearDeviceKey does not swallow IDB errors and throws to caller', async () => {
    // Mock indexedDB.open to fail
    const openSpy = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      const req = {} as IDBOpenDBRequest;
      setTimeout(() => {
        if (req.onerror) {
          Object.defineProperty(req, 'error', {
            configurable: true,
            value: new DOMException('IDB inaccessible', 'SecurityError'),
          });
          req.onerror(new Event('error') as any);
        }
      }, 0);
      return req;
    });

    await expect(clearDeviceKey(USER)).rejects.toThrow();
    openSpy.mockRestore();
  });

  it('when clearDeviceKey fails during signOut, reportError is called with signOut_clearDeviceKey and LocalWipeFailedError is thrown', async () => {
    const keyVault = await import('../../../core/crypto/keyVaultCache');
    vi.spyOn(keyVault, 'clearDeviceKey').mockRejectedValueOnce(new Error('IDB locked or corrupted'));

    const { AuthService } = await import('../services/AuthService');

    await expect(AuthService.signOut({ clearLocalData: true, force: true })).rejects.toMatchObject({
      name: 'LocalWipeFailedError',
    });

    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'signOut_clearDeviceKey' })
    );
  });

  it('when clearAccountScopedStorage fails during signOut, reportError is called with signOut_clearAccountScopedStorage', async () => {
    const scopedKeys = await import('../services/accountScopedKeys');
    vi.spyOn(scopedKeys, 'clearAccountScopedStorage').mockImplementationOnce(() => {
      throw new Error('localStorage restricted');
    });

    const { AuthService } = await import('../services/AuthService');

    await expect(AuthService.signOut({ clearLocalData: true, force: true })).rejects.toMatchObject({
      name: 'LocalWipeFailedError',
    });

    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'signOut_clearAccountScopedStorage' })
    );
  });
});
