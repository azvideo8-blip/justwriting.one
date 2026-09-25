import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  generateDataKey,
  deriveMasterKey,
  wrapDataKey,
  encryptContent,
  setSessionKey,
  clearSessionKey,
  getSessionKey,
  toBase64 as saltToBase64,
} from '../encrypt';
import { saveDeviceKey, loadDeviceKey, clearDeviceKey } from '../keyVaultCache';
import {
  EncryptionService,
  generateRecoveryCodeForExistingVault,
  recoverVaultWithCode,
  KeyNotExtractableError,
  generateEncryptionSalt,
} from '../../services/EncryptionService';
import {
  saveEncryptionMeta,
  VERIFICATION_PLAINTEXT,
  ENCRYPTION_META_VERSION,
  type EncryptionMeta,
} from '../../services/EncryptionMetaService';
import { DataProvider } from '../../data';

describe('Key Vault Extractability and Recovery Code (AG-REC-1)', () => {
  const userId = 'test-user-extractable';
  const password = 'SecretPassword123!';
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

  it('saveDeviceKey and loadDeviceKey strictly keep the stored device key non-extractable', async () => {
    // Generate an extractable data key
    const extractableKey = await generateDataKey();
    expect(extractableKey.extractable).toBe(true);

    // Save to device key store
    await saveDeviceKey(userId, extractableKey);

    // Load from device key store
    const loadedKey = await loadDeviceKey(userId);
    expect(loadedKey).not.toBeNull();
    // CRITICAL SECURITY ASSERTION: Device key MUST be non-extractable
    expect(loadedKey!.extractable).toBe(false);

    await clearDeviceKey(userId);
    const clearedKey = await loadDeviceKey(userId);
    expect(clearedKey).toBeNull();
  });

  it('generateRecoveryCodeForExistingVault throws KeyNotExtractableError when session key is non-extractable and no password provided', async () => {
    // Setup vault metadata
    const extractableKey = await generateDataKey();
    const salt = generateEncryptionSalt();
    const masterKey = await deriveMasterKey(password, salt);
    const wrappedDataKey = await wrapDataKey(extractableKey, masterKey);
    const verification = await encryptContent(VERIFICATION_PLAINTEXT, extractableKey);

    await saveEncryptionMeta(userId, {
      version: ENCRYPTION_META_VERSION,
      salt: saltToBase64(salt),
      wrappedDataKey,
      verification,
    });

    // Save key to device cache (which imports it as non-extractable)
    await saveDeviceKey(userId, extractableKey);
    const nonExtractableKey = await loadDeviceKey(userId);
    expect(nonExtractableKey!.extractable).toBe(false);

    // Set non-extractable key in session
    setSessionKey(nonExtractableKey!);

    // Attempting to generate recovery code without password should fail with KeyNotExtractableError
    await expect(
      generateRecoveryCodeForExistingVault(userId)
    ).rejects.toThrow(KeyNotExtractableError);

    // Also check error instanceof EncryptionService.KeyNotExtractableError
    try {
      await generateRecoveryCodeForExistingVault(userId);
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EncryptionService.KeyNotExtractableError);
    }
  });

  // Медленный по делу: полный цикл PBKDF2 (600 000 итераций) для мастер-ключа и восстановления хранилища (до ~4.7 с под нагрузкой).
  it('generateRecoveryCodeForExistingVault with password successfully generates recovery code and keeps session key non-extractable', async () => {
    // Setup vault metadata
    const extractableKey = await generateDataKey();
    const salt = generateEncryptionSalt();
    const masterKey = await deriveMasterKey(password, salt);
    const wrappedDataKey = await wrapDataKey(extractableKey, masterKey);
    const verification = await encryptContent(VERIFICATION_PLAINTEXT, extractableKey);

    await saveEncryptionMeta(userId, {
      version: ENCRYPTION_META_VERSION,
      salt: saltToBase64(salt),
      wrappedDataKey,
      verification,
    });

    // Save and load non-extractable device key
    await saveDeviceKey(userId, extractableKey);
    const nonExtractableKey = await loadDeviceKey(userId);
    expect(nonExtractableKey!.extractable).toBe(false);

    // Put non-extractable key into session
    setSessionKey(nonExtractableKey!);
    expect(getSessionKey()?.extractable).toBe(false);

    // Generate recovery code providing password
    const recoveryCode = await generateRecoveryCodeForExistingVault(userId, password);
    expect(recoveryCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    // CRITICAL SECURITY ASSERTION: Session key must remain non-extractable!
    expect(getSessionKey()?.extractable).toBe(false);

    // Clear session key and verify we can recover the vault using this new recovery code
    clearSessionKey();
    expect(getSessionKey()).toBeNull();

    const newPassword = 'BrandNewPassword456!';
    await recoverVaultWithCode(userId, recoveryCode, newPassword);

    // Vault should be unlocked now
    expect(getSessionKey()).not.toBeNull();
  }, 15_000);
});
