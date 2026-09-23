import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { saveEncryptionMeta, saltToBase64, generateSalt, VERIFICATION_PLAINTEXT } from '../EncryptionMetaService';
import { unlockVault, lockVault, changePassword, WrongPasswordError } from '../EncryptionService';
import { updateUserPassword } from '../../auth';
import { generateDataKey, deriveMasterKey, wrapDataKey, encryptContent } from '../../crypto/encrypt';
import { DataProvider } from '../../data';
import { setProfileLoaded, setEncryptionEnabled } from '../../crypto/cryptoHelpers';
import { setPendingLoginPassword } from '../../crypto/pendingLoginPassword';

const USER = 'user_converge_test';
const OLD = 'old-password-1';
const NEW = 'new-password-2';
const ITER = 1000; // скорость теста; число итераций сохраняется в мете

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER, email: 'test@example.com' }),
  getCurrentUserId: () => USER,
  updateUserPassword: vi.fn().mockResolvedValue(undefined),
}));

// D-28: пароль входа сбросили по почте — сейф ещё на старом. После ручной
// разблокировки прежним паролем сейф перешифровывается паролем входа.
describe('vault password convergence after an e-mail reset (D-28)', () => {
  let meta: unknown = null;

  beforeEach(async () => {
    vi.clearAllMocks();
    setProfileLoaded(USER, true);
    setEncryptionEnabled(USER, false);
    lockVault(USER);
    meta = null;
    vi.spyOn(DataProvider, 'getEncryptionMeta').mockImplementation(async () => (meta ? { encryptionMeta: meta } : null) as never);
    vi.spyOn(DataProvider, 'saveEncryptionMeta').mockImplementation(async (_uid, data) => {
      meta = (data as { encryptionMeta: unknown }).encryptionMeta;
    });

    const dataKey = await generateDataKey();
    const salt = generateSalt();
    await saveEncryptionMeta(USER, {
      salt: saltToBase64(salt),
      version: 2,
      wrappedDataKey: await wrapDataKey(dataKey, await deriveMasterKey(OLD, salt, ITER)),
      verification: await encryptContent(VERIFICATION_PLAINTEXT, dataKey),
      iterations: ITER,
    });
  });

  it('re-wraps the vault with the login password after unlocking with the old one', async () => {
    setPendingLoginPassword(USER, NEW);
    await unlockVault(USER, OLD);
    lockVault(USER);

    await expect(unlockVault(USER, NEW)).resolves.toBeUndefined();
    lockVault(USER);
    await expect(unlockVault(USER, OLD)).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('leaves the vault alone when there is no pending login password', async () => {
    await unlockVault(USER, OLD);
    lockVault(USER);
    await expect(unlockVault(USER, OLD)).resolves.toBeUndefined();
  });

  it('puts the vault back on the old password when the login password change fails', async () => {
    vi.mocked(updateUserPassword).mockRejectedValueOnce(new Error('network'));
    await expect(changePassword(USER, OLD, NEW)).rejects.toThrow('network');
    lockVault(USER);
    await expect(unlockVault(USER, OLD)).resolves.toBeUndefined();
  });
});
