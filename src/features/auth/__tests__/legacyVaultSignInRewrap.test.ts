import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  generateDataKey,
  deriveMasterKey,
  wrapDataKey,
  encryptContent,
  decryptContent,
  getSessionKey,
  PBKDF2_ITERATIONS,
  LEGACY_PBKDF2_ITERATIONS,
} from '../../../core/crypto/encrypt';
import {
  getEncryptionMeta,
  generateSalt,
  saltToBase64,
  VERIFICATION_PLAINTEXT,
} from '../../../core/services/EncryptionMetaService';
import { wrapDataKeyWithRecoveryCode } from '../../../core/crypto/recoveryCode';
import { lockVault } from '../../../core/services/EncryptionService';
import { setProfileLoaded, setEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';
import { AuthService } from '../services/AuthService';

const USER = 'user_b1_signin_rewrap';
const EMAIL = 'b1-signin@example.com';

vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: USER, email: EMAIL }),
  getCurrentUserId: () => USER,
  signIn: vi.fn(async () => ({ uid: USER, email: EMAIL })),
  signUp: vi.fn(),
  signOutUser: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  reauthenticate: vi.fn(),
  updateUserPassword: vi.fn(),
}));

vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { DataProvider } from '../../../core/data';

/**
 * B-1 (R2-006): сейф, завёрнутый на 300k, переворачивается на 600k и при входе
 * по паролю, а не только при ручной разблокировке. Тест идёт через
 * `AuthService.signInWithEmail` — это тот путь, который реально нажимает
 * форма логина (`LoginPage.tsx:150`), а не соседний `unlockVault`.
 *
 * До правки `{ dataKey }` в `unlockVaultFromProfile` выбрасывал флаг
 * `usedLegacyIterations`, и пользователь, который всегда входит по паролю,
 * держал 300k-обёртку вечно.
 */
async function createLegacyVault(password: string, recoveryCode?: string) {
  const dataKey = await generateDataKey();
  const salt = generateSalt();
  const masterKey = await deriveMasterKey(password, salt, LEGACY_PBKDF2_ITERATIONS);
  const wrappedDataKey = await wrapDataKey(dataKey, masterKey);
  const verification = await encryptContent(VERIFICATION_PLAINTEXT, dataKey);

  let recoveryWrappedDataKey: string | undefined;
  let recoverySalt: string | undefined;
  if (recoveryCode) {
    const rSalt = generateSalt();
    recoverySalt = saltToBase64(rSalt);
    recoveryWrappedDataKey = await wrapDataKeyWithRecoveryCode(dataKey, recoveryCode, rSalt);
  }

  return {
    dataKey,
    meta: {
      salt: saltToBase64(salt),
      version: 2,
      wrappedDataKey,
      verification,
      iterations: LEGACY_PBKDF2_ITERATIONS,
      recoveryWrappedDataKey,
      recoverySalt,
      autoCreated: true,
    },
  };
}

describe('B-1 (R2-006): sign-in by password re-wraps a legacy vault', () => {
  let stored: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    setProfileLoaded(USER, true);
    setEncryptionEnabled(USER, false);
    stored = null;
    lockVault(USER);

    vi.spyOn(DataProvider, 'getProfile').mockImplementation(async () =>
      stored ? { uid: USER, encryptionMeta: stored } : null);
    vi.spyOn(DataProvider, 'getEncryptionMeta').mockImplementation(async () =>
      stored ? { encryptionMeta: stored } : null);
    vi.spyOn(DataProvider, 'saveEncryptionMeta').mockImplementation(async (_uid, data: any) => {
      stored = data.encryptionMeta;
    });
  });

  it('1. вход по паролю поднимает 300k-сейф на 600k, и сейф снова открывается', async () => {
    const password = 'signInLegacyPassword';
    const { meta: legacyMeta, dataKey: originalDataKey } = await createLegacyVault(password);
    stored = legacyMeta;

    const { user } = await AuthService.signInWithEmail(EMAIL, password);
    expect(user.uid).toBe(USER);
    expect(getSessionKey(), 'сейф открылся при входе').not.toBeNull();

    const after = await getEncryptionMeta(USER);
    expect(after?.iterations, 'вход по паролю не перевёл обёртку на 600k').toBe(PBKDF2_ITERATIONS);
    expect(after?.salt).not.toBe(legacyMeta.salt);

    // Тот же data key: заметки, зашифрованные исходным ключом, читаются
    // ключом сессии — переворот не отвязывает архив.
    const cipher = await encryptContent('вчерашний вечер', originalDataKey);
    expect(await decryptContent(cipher, getSessionKey()!)).toBe('вчерашний вечер');

    // Следующий вход идёт уже по 600k и должен пройти целиком.
    lockVault(USER);
    await AuthService.signInWithEmail(EMAIL, password);
    expect(getSessionKey()).not.toBeNull();
    expect((await getEncryptionMeta(USER))?.iterations).toBe(PBKDF2_ITERATIONS);
  }, 120_000);

  it('2. переворот при входе сохраняет recovery code и флаг авто-создания', async () => {
    const password = 'signInWithRecoveryCode';
    const recoveryCode = 'QRST-UVWX-YZAB-CDEF';
    const { meta: legacyMeta } = await createLegacyVault(password, recoveryCode);
    stored = legacyMeta;

    await AuthService.signInWithEmail(EMAIL, password);

    const after = await getEncryptionMeta(USER);
    expect(after?.iterations).toBe(PBKDF2_ITERATIONS);
    expect(after?.recoveryWrappedDataKey, 'recovery code потерян при перевороте').toBe(
      legacyMeta.recoveryWrappedDataKey);
    expect(after?.recoverySalt).toBe(legacyMeta.recoverySalt);
    expect(after?.autoCreated, 'флаг авто-создания потерян при перевороте').toBe(true);
  }, 120_000);

  it('3. запись меты упала — вход всё равно успешен, попытка была', async () => {
    const password = 'signInRewrapFails';
    const { meta: legacyMeta } = await createLegacyVault(password);
    stored = legacyMeta;

    vi.mocked(DataProvider.saveEncryptionMeta).mockRejectedValue(new Error('Network error during re-wrap'));

    const { user } = await AuthService.signInWithEmail(EMAIL, password);
    expect(user.uid).toBe(USER);
    expect(getSessionKey(), 'неудача переворота не должна закрывать сейф').not.toBeNull();

    expect(DataProvider.saveEncryptionMeta, 'переворот при входе не предпринимался').toHaveBeenCalledTimes(1);
    expect(stored.iterations, 'неудачная запись не должна была поменять мету').toBe(LEGACY_PBKDF2_ITERATIONS);
  }, 120_000);
});
