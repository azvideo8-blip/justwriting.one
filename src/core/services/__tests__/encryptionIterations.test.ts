import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  saveEncryptionMeta,
  getEncryptionMeta,
  saltToBase64,
  generateSalt,
  VERIFICATION_PLAINTEXT,
} from '../EncryptionMetaService';
import {
  unlockVault,
  changePassword,
  lockVault,
} from '../EncryptionService';
import {
  generateDataKey,
  deriveMasterKey,
  wrapDataKey,
  encryptContent,
  getSessionKey,
} from '../../crypto/encrypt';
import { DataProvider } from '../../data';
import { setProfileLoaded, setEncryptionEnabled } from '../../crypto/cryptoHelpers';

const USER = 'user_iterations_test';

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER, email: 'test@example.com' }),
  getCurrentUserId: () => USER,
  updateUserPassword: vi.fn().mockResolvedValue(undefined),
}));

describe('DEEP-7: PBKDF2 iteration count preservation across reads and password change', () => {
  let inMemoryMeta: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    setProfileLoaded(USER, true);
    setEncryptionEnabled(USER, false);
    inMemoryMeta = null;
    lockVault(USER);

    vi.spyOn(DataProvider, 'getEncryptionMeta').mockImplementation(async () => {
      return inMemoryMeta ? { encryptionMeta: inMemoryMeta } : null;
    });

    vi.spyOn(DataProvider, 'saveEncryptionMeta').mockImplementation(async (_uid, data: any) => {
      inMemoryMeta = data.encryptionMeta;
    });
  });

  it('round-trip: write meta with custom iterations -> read meta -> iterations matches', async () => {
    const salt = saltToBase64(generateSalt());
    await saveEncryptionMeta(USER, {
      salt,
      version: 2,
      wrappedDataKey: 'fakeWrappedKey',
      verification: 'fakeVerification',
      iterations: 300_000,
    });

    const meta = await getEncryptionMeta(USER);
    expect(meta).not.toBeNull();
    expect(meta?.iterations).toBe(300_000);
    expect(meta?.salt).toBe(salt);
    expect(meta?.wrappedDataKey).toBe('fakeWrappedKey');
  });

  it('unlockVault with custom iterations derives the key at that iteration count', async () => {
    // 1000 iterations for test execution speed
    const testIterations = 1000;
    const password = 'mySecretPassword123';
    const salt = generateSalt();
    const dataKey = await generateDataKey();
    const masterKey = await deriveMasterKey(password, salt, testIterations);
    const wrappedDataKey = await wrapDataKey(dataKey, masterKey);
    const verification = await encryptContent(VERIFICATION_PLAINTEXT, dataKey);

    await saveEncryptionMeta(USER, {
      salt: saltToBase64(salt),
      version: 2,
      wrappedDataKey,
      verification,
      iterations: testIterations,
    });

    // Attempt to unlock vault
    await unlockVault(USER, password);

    const sessionKey = getSessionKey();
    expect(sessionKey).not.toBeNull();
  });

  it('changePassword preserves existing custom iteration count in newly saved metadata', async () => {
    const customIterations = 2000;
    const oldPassword = 'oldPassword123';
    const newPassword = 'newPassword456';

    const salt = generateSalt();
    const dataKey = await generateDataKey();
    const masterKey = await deriveMasterKey(oldPassword, salt, customIterations);
    const wrappedDataKey = await wrapDataKey(dataKey, masterKey);
    const verification = await encryptContent(VERIFICATION_PLAINTEXT, dataKey);

    await saveEncryptionMeta(USER, {
      salt: saltToBase64(salt),
      version: 2,
      wrappedDataKey,
      verification,
      iterations: customIterations,
    });

    // Change password
    await changePassword(USER, oldPassword, newPassword);

    // Read back metadata
    const updatedMeta = await getEncryptionMeta(USER);
    expect(updatedMeta).not.toBeNull();
    expect(updatedMeta?.iterations).toBe(customIterations);

    // Verify the newly set password unlocks with that iteration count
    lockVault(USER);
    await unlockVault(USER, newPassword);
    expect(getSessionKey()).not.toBeNull();
  });
});
