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
  lockVault,
  recoverVaultWithCode,
  WrongPasswordError,
} from '../EncryptionService';
import {
  generateDataKey,
  deriveMasterKey,
  wrapDataKey,
  encryptContent,
  decryptContent,
  getSessionKey,
  PBKDF2_ITERATIONS,
  LEGACY_PBKDF2_ITERATIONS,
} from '../../crypto/encrypt';
import { wrapDataKeyWithRecoveryCode } from '../../crypto/recoveryCode';
import { DataProvider } from '../../data';
import { setProfileLoaded, setEncryptionEnabled } from '../../crypto/cryptoHelpers';

const USER = 'user_legacy_rewrap_test';

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER, email: 'test@example.com' }),
  getCurrentUserId: () => USER,
  updateUserPassword: vi.fn().mockResolvedValue(undefined),
}));

async function createDirectLegacyVault(password: string, recoveryCode?: string) {
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

  const meta = {
    salt: saltToBase64(salt),
    version: 2,
    wrappedDataKey,
    verification,
    iterations: LEGACY_PBKDF2_ITERATIONS,
    recoveryWrappedDataKey,
    recoverySalt,
  };

  return { meta, dataKey };
}

describe('C-1 (F-017): Legacy vaults are re-wrapped to PBKDF2_ITERATIONS on unlock', () => {
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

  it('1. legacy vault -> unlock -> meta now has iterations: 600000 -> second unlock works', async () => {
    const password = 'legacyPassword123';
    const { meta: legacyMeta } = await createDirectLegacyVault(password);
    await saveEncryptionMeta(USER, legacyMeta);

    // Initial check: vault is at legacy iterations (300k)
    const initialMeta = await getEncryptionMeta(USER);
    expect(initialMeta?.iterations).toBe(LEGACY_PBKDF2_ITERATIONS);

    // Unlock: should unwrap with 300k and re-wrap to 600k
    await unlockVault(USER, password);
    expect(getSessionKey()).not.toBeNull();

    // Check that meta was re-wrapped to PBKDF2_ITERATIONS (600k) with a new salt
    const updatedMeta = await getEncryptionMeta(USER);
    expect(updatedMeta?.iterations).toBe(PBKDF2_ITERATIONS);
    expect(updatedMeta?.salt).not.toBe(legacyMeta.salt);

    // Lock and perform second unlock
    lockVault(USER);
    expect(getSessionKey()).toBeNull();

    await unlockVault(USER, password);
    expect(getSessionKey()).not.toBeNull();
  }, 30_000);

  it('2. a second device holding old meta unlocks with same password (data key unchanged) and re-wraps', async () => {
    const password = 'deviceSharedPassword';
    const { meta: legacyMeta, dataKey: originalDataKey } = await createDirectLegacyVault(password);

    // Device A unlocks and re-wraps
    await saveEncryptionMeta(USER, legacyMeta);
    await unlockVault(USER, password);
    const metaA = await getEncryptionMeta(USER);
    expect(metaA?.iterations).toBe(PBKDF2_ITERATIONS);

    // Device B still holds the old legacy meta locally
    lockVault(USER);
    inMemoryMeta = legacyMeta; // Device B has not synced yet
    await unlockVault(USER, password);

    // Data key in session must match original data key (encrypt with original, decrypt with session key)
    const testCipher = await encryptContent('secret document text', originalDataKey);
    const decrypted = await decryptContent(testCipher, getSessionKey()!);
    expect(decrypted).toBe('secret document text');

    // Device B also updates meta to 600k
    const metaB = await getEncryptionMeta(USER);
    expect(metaB?.iterations).toBe(PBKDF2_ITERATIONS);
  }, 30_000);

  it('3. saveEncryptionMeta throws during re-wrap -> unlock succeeds, vault stays at 300k, next unlock re-wraps', async () => {
    const password = 'resilientPassword';
    const { meta: legacyMeta } = await createDirectLegacyVault(password);
    inMemoryMeta = legacyMeta;

    // Fail saveEncryptionMeta during re-wrap
    let saveCount = 0;
    vi.spyOn(DataProvider, 'saveEncryptionMeta').mockImplementation(async (_uid, data: any) => {
      saveCount++;
      if (saveCount === 1) {
        throw new Error('Network error during re-wrap');
      }
      inMemoryMeta = data.encryptionMeta;
    });

    // Unlock succeeds despite re-wrap failure
    await unlockVault(USER, password);
    expect(getSessionKey()).not.toBeNull();

    // Meta is still legacy (300k)
    expect(inMemoryMeta.iterations).toBe(LEGACY_PBKDF2_ITERATIONS);

    // Next unlock succeeds and successfully re-wraps
    lockVault(USER);
    await unlockVault(USER, password);
    expect(inMemoryMeta.iterations).toBe(PBKDF2_ITERATIONS);
  }, 30_000);

  it('4. after re-wrap, the recovery code still opens the vault', async () => {
    const password = 'passwordWithRecovery';
    const recoveryCode = 'ABCD-EFGH-IJKL-MNOP';
    const newPassword = 'newPasswordAfterRecovery';
    const { meta: legacyMeta, dataKey: originalDataKey } = await createDirectLegacyVault(password, recoveryCode);
    inMemoryMeta = legacyMeta;

    // Unlock with password triggers re-wrap to 600k
    await unlockVault(USER, password);
    expect(inMemoryMeta.iterations).toBe(PBKDF2_ITERATIONS);
    lockVault(USER);

    // Recover using recovery code
    await recoverVaultWithCode(USER, recoveryCode, newPassword);

    // Data key must still be identical
    const cipher = await encryptContent('recovery test text', originalDataKey);
    const decrypted = await decryptContent(cipher, getSessionKey()!);
    expect(decrypted).toBe('recovery test text');

    // New password unlocks vault
    lockVault(USER);
    await unlockVault(USER, newPassword);
    expect(getSessionKey()).not.toBeNull();
  }, 30_000);

  it('5. wrong password on a re-wrapped vault still raises WrongPasswordError', async () => {
    const password = 'correctPassword';
    const { meta: legacyMeta } = await createDirectLegacyVault(password);
    inMemoryMeta = legacyMeta;

    // Unlock with password triggers re-wrap
    await unlockVault(USER, password);
    expect(inMemoryMeta.iterations).toBe(PBKDF2_ITERATIONS);
    lockVault(USER);

    // Attempt unlock with wrong password
    await expect(unlockVault(USER, 'wrongPassword123')).rejects.toThrow(WrongPasswordError);
  }, 30_000);

  it('6. авто-созданный сейф остаётся авто-созданным после переворачивания', async () => {
    const password = 'autoCreatedVault';
    const { meta: legacyMeta } = await createDirectLegacyVault(password);
    inMemoryMeta = { ...legacyMeta, autoCreated: true };

    await unlockVault(USER, password);

    expect(inMemoryMeta.iterations).toBe(PBKDF2_ITERATIONS);
    expect(inMemoryMeta.autoCreated, 'флаг авто-создания не должен потеряться при перезаписи меты').toBe(true);
  }, 30_000);

  it('7. мету переписали во время деривации — своя запись не идёт в базу', async () => {
    const password = 'racedVault';
    const { meta: legacyMeta } = await createDirectLegacyVault(password);
    inMemoryMeta = legacyMeta;

    // Первая читка — наша, до переворачивания. Вторая — уже чужая запись:
    // другая вкладка успела сменить пароль. Свой wrap другого data key означал
    // бы потерю заметок, поэтому перечитываем и сравниваем.
    let reads = 0;
    vi.spyOn(DataProvider, 'getEncryptionMeta').mockImplementation(async () => {
      reads++;
      if (reads === 1) return { encryptionMeta: legacyMeta };
      return {
        encryptionMeta: { ...legacyMeta, wrappedDataKey: 'chuzhoy-wrap', salt: saltToBase64(generateSalt()) },
      };
    });

    await unlockVault(USER, password);

    expect(reads, 'мету перечитывают перед записью').toBeGreaterThanOrEqual(2);
    expect(inMemoryMeta.iterations, 'чужая мета осталась нетронутой').toBe(LEGACY_PBKDF2_ITERATIONS);
  }, 30_000);
});
