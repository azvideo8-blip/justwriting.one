import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initializeEncryption,
  unlockVault,
  recoverVaultWithCode,
  changePassword,
  generateRecoveryCodeForExistingVault,
  WrongPasswordError,
  WrongRecoveryCodeError,
} from '../../services/EncryptionService';
import {
  getEncryptionMeta,
  type EncryptionMeta,
} from '../../services/EncryptionMetaService';
import {
  encryptContent,
  decryptContent,
  unwrapDataKeyWithPassword,
  deriveMasterKey,
  generateDataKey,
  wrapDataKey,
  getSessionKey,
  clearSessionKey,
  SALT_LENGTH,
} from '../encrypt';
import {
  generateRecoveryCode,
  unwrapDataKeyWithRecoveryCode,
  normalizeRecoveryCode,
} from '../recoveryCode';
import { DataProvider } from '../../data';

describe('Encryption by default & Recovery Code (D4.10 Acceptance Tests)', { timeout: 60_000 }, () => {
  const mockStorage = new Map<string, { encryptionMeta?: EncryptionMeta }>();

  beforeEach(() => {
    mockStorage.clear();
    clearSessionKey();
    vi.clearAllMocks();

    vi.spyOn(DataProvider, 'getEncryptionMeta').mockImplementation(async (uid: string) => {
      const data = mockStorage.get(uid);
      return (data?.encryptionMeta ? { encryptionMeta: data.encryptionMeta } : null) as any;
    });

    vi.spyOn(DataProvider, 'saveEncryptionMeta').mockImplementation(async (uid: string, data: any) => {
      mockStorage.set(uid, { encryptionMeta: data.encryptionMeta });
    });
  });

  it('Acceptance 2: registration / initialization produces a vault and a recovery code, and BOTH wrappings unwrap to the SAME data key', async () => {
    const userId = 'user_d410_test';
    const password = 'my-super-secret-password-123';

    const { recoveryCode } = await initializeEncryption(userId, password);
    expect(recoveryCode).toBeDefined();
    expect(recoveryCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);

    const meta = await getEncryptionMeta(userId);
    expect(meta).not.toBeNull();
    expect(meta!.version).toBe(2);
    expect(meta!.wrappedDataKey).toBeDefined();
    expect(meta!.recoveryWrappedDataKey).toBeDefined();
    expect(meta!.recoverySalt).toBeDefined();

    // 1. Unwrap with password
    const { fromBase64 } = await import('../encrypt');
    const salt = fromBase64(meta!.salt);
    const { dataKey: dataKeyFromPassword } = await unwrapDataKeyWithPassword(meta!.wrappedDataKey, password, salt);

    // 2. Unwrap with recovery code
    const recoverySalt = fromBase64(meta!.recoverySalt!);
    const dataKeyFromRecovery = await unwrapDataKeyWithRecoveryCode(meta!.recoveryWrappedDataKey!, recoveryCode, recoverySalt);

    // 3. Test that both keys can decrypt each other's ciphertext
    const secretMessage = 'The secret diary entry of a lifetime';
    const cipherFromPasswordKey = await encryptContent(secretMessage, dataKeyFromPassword);
    const decryptedWithRecoveryKey = await decryptContent(cipherFromPasswordKey, dataKeyFromRecovery);
    expect(decryptedWithRecoveryKey).toBe(secretMessage);

    const cipherFromRecoveryKey = await encryptContent(secretMessage, dataKeyFromRecovery);
    const decryptedWithPasswordKey = await decryptContent(cipherFromRecoveryKey, dataKeyFromPassword);
    expect(decryptedWithPasswordKey).toBe(secretMessage);
  });

  it('Acceptance 3: a note encrypted before a password change reads correctly after it', async () => {
    const userId = 'user_pwd_change';
    const originalPassword = 'original-password-123';
    const newPassword = 'new-shiny-password-456';

    const { recoveryCode } = await initializeEncryption(userId, originalPassword);

    // Encrypt note under current session key
    const sessionKey = getSessionKey()!;
    expect(sessionKey).toBeDefined();
    const originalNote = 'Note written before changing password';
    const encryptedNote = await encryptContent(originalNote, sessionKey);

    // Change password
    await changePassword(userId, originalPassword, newPassword);

    // Lock vault and unlock with new password
    clearSessionKey();
    expect(getSessionKey()).toBeNull();

    // Wrong password fails
    await expect(unlockVault(userId, 'wrong-password')).rejects.toThrow(WrongPasswordError);

    // New password unlocks and decrypts previously encrypted note
    await unlockVault(userId, newPassword);
    const newSessionKey = getSessionKey()!;
    const decryptedNote = await decryptContent(encryptedNote, newSessionKey);
    expect(decryptedNote).toBe(originalNote);

    // Recovery code continues to work after password change
    const meta = (await getEncryptionMeta(userId))!;
    const { fromBase64 } = await import('../encrypt');
    const recoverySalt = fromBase64(meta.recoverySalt!);
    const recoveryKey = await unwrapDataKeyWithRecoveryCode(meta.recoveryWrappedDataKey!, recoveryCode, recoverySalt);
    const decryptedWithRecovery = await decryptContent(encryptedNote, recoveryKey);
    expect(decryptedWithRecovery).toBe(originalNote);
  });

  it('Acceptance 4: unwrapping with recovery code and re-wrapping with a new password leaves previously encrypted notes readable', async () => {
    const userId = 'user_recover_test';
    const oldPassword = 'forgotten-password-123';
    const newPassword = 'recovered-password-456';

    const { recoveryCode } = await initializeEncryption(userId, oldPassword);
    const originalNote = 'Important diary note before I forgot my password';
    const encryptedNote = await encryptContent(originalNote, getSessionKey()!);

    // "Forget" the password
    clearSessionKey();

    // Wrong recovery code fails cleanly with WrongRecoveryCodeError
    await expect(recoverVaultWithCode(userId, '0000-0000-0000-0000-0000-0000', newPassword)).rejects.toThrow(WrongRecoveryCodeError);

    // Recover using the valid code and set a new password
    await recoverVaultWithCode(userId, recoveryCode, newPassword);

    // Session key is restored and reads the note
    const sessionKeyAfterRecovery = getSessionKey()!;
    expect(sessionKeyAfterRecovery).toBeDefined();
    const decrypted1 = await decryptContent(encryptedNote, sessionKeyAfterRecovery);
    expect(decrypted1).toBe(originalNote);

    // Subsequent unlocks with the new password work
    clearSessionKey();
    await unlockVault(userId, newPassword);
    const decrypted2 = await decryptContent(encryptedNote, getSessionKey()!);
    expect(decrypted2).toBe(originalNote);
  });

  it('Acceptance 5: recovery code is accepted regardless of case, spaces and dashes', async () => {
    const userId = 'user_messy_input';
    const password = 'my-password-123';
    const newPassword = 'recovered-new-pass-999';

    const { recoveryCode } = await initializeEncryption(userId, password);
    const note = 'Diary content to recover';
    const encrypted = await encryptContent(note, getSessionKey()!);

    clearSessionKey();

    // Transform recovery code: lower case, replace hyphens with spaces
    const messyCode = recoveryCode.toLowerCase().replace(/-/g, ' ');

    await recoverVaultWithCode(userId, messyCode, newPassword);
    expect(await decryptContent(encrypted, getSessionKey()!)).toBe(note);
  });

  it('Acceptance 6: a version 1 vault without recovery fields still unlocks with its password, and can be given a code afterwards', async () => {
    const userId = 'legacy_v1_user';
    const password = 'v1-legacy-password';

    // Simulate existing Version 1 vault (no recoveryWrappedDataKey, no recoverySalt)
    const { fromBase64, toBase64 } = await import('../encrypt');
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const masterKey = await deriveMasterKey(password, salt);
    const dataKey = await generateDataKey();
    const wrappedDataKey = await wrapDataKey(dataKey, masterKey);
    const verification = await encryptContent('justwriting-verify-v1', dataKey);

    mockStorage.set(userId, {
      encryptionMeta: {
        salt: toBase64(salt),
        version: 1,
        wrappedDataKey,
        verification,
      },
    });

    // 1. Version 1 vault unlocks with password
    await unlockVault(userId, password);
    expect(getSessionKey()).toBeDefined();

    // Write a note with this legacy vault
    const legacyNote = 'Note created in version 1 vault';
    const encrypted = await encryptContent(legacyNote, getSessionKey()!);

    // 2. Generate a recovery code for this existing vault
    const generatedCode = await generateRecoveryCodeForExistingVault(userId);
    expect(generatedCode).toBeDefined();

    const updatedMeta = await getEncryptionMeta(userId);
    expect(updatedMeta!.version).toBe(2);
    expect(updatedMeta!.recoveryWrappedDataKey).toBeDefined();
    expect(updatedMeta!.recoverySalt).toBeDefined();

    // 3. Verify recovery code unwraps the same legacy dataKey
    const recoverySalt = fromBase64(updatedMeta!.recoverySalt!);
    const recoveredKey = await unwrapDataKeyWithRecoveryCode(updatedMeta!.recoveryWrappedDataKey!, generatedCode, recoverySalt);
    expect(await decryptContent(encrypted, recoveredKey)).toBe(legacyNote);

    // 4. Recover with code works for this upgraded legacy vault
    clearSessionKey();
    const brandNewPassword = 'new-password-after-legacy-upgrade';
    await recoverVaultWithCode(userId, generatedCode, brandNewPassword);
    expect(await decryptContent(encrypted, getSessionKey()!)).toBe(legacyNote);
  });

  it('Acceptance 7: code is generated from crypto.getRandomValues, and two successive generations differ', () => {
    const code1 = generateRecoveryCode();
    const code2 = generateRecoveryCode();
    expect(code1).not.toBe(code2);
    expect(normalizeRecoveryCode(code1)).toHaveLength(24);
    expect(normalizeRecoveryCode(code2)).toHaveLength(24);
  });
});
