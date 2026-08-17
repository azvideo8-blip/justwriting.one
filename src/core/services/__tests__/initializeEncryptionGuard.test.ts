import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * initializeEncryption генерирует новый data key. Если сейф уже существует,
 * запись меты поверх старой навсегда отвязывает зашифрованные заметки — взять
 * прежний ключ будет негде. Поэтому здесь проверяется ровно одно: создание
 * происходит только при положительном ответе «в профиле ничего нет», а любое
 * сомнение (мета есть, legacy-пара есть, чтение упало) заканчивается отказом
 * ДО того, как что-то будет записано.
 */

const getEncryptionMeta = vi.fn();
vi.mock('../../data', () => ({
  DataProvider: { getEncryptionMeta: (uid: string) => getEncryptionMeta(uid) },
}));

const saveEncryptionMeta = vi.fn().mockResolvedValue(undefined);
vi.mock('../EncryptionMetaService', () => ({
  saveEncryptionMeta: (uid: string, meta: unknown) => saveEncryptionMeta(uid, meta),
  getEncryptionMeta: vi.fn(),
  generateSalt: () => new Uint8Array(16),
  saltToBase64: () => 'salt-b64',
  saltFromBase64: () => new Uint8Array(16),
  ENCRYPTION_META_VERSION: 1,
  VERIFICATION_PLAINTEXT: 'justwriting-verify-v1',
}));

const setSessionKey = vi.fn();
vi.mock('../../crypto/encrypt', () => ({
  deriveMasterKey: vi.fn().mockResolvedValue('master-key'),
  generateDataKey: vi.fn().mockResolvedValue('data-key'),
  wrapDataKey: vi.fn().mockResolvedValue('wrapped'),
  unwrapDataKeyWithPassword: vi.fn(),
  encryptContent: vi.fn().mockResolvedValue('verification-ct'),
  decryptContent: vi.fn(),
  setSessionKey: (k: unknown) => setSessionKey(k),
  getSessionKey: vi.fn(),
  clearSessionKey: vi.fn(),
  isVaultUnlocked: vi.fn(),
}));

const setEncryptionEnabled = vi.fn();
vi.mock('../../crypto/cryptoHelpers', () => ({
  setEncryptionEnabled: (uid: string, on: boolean) => setEncryptionEnabled(uid, on),
}));

vi.mock('../../crypto/encryptMigration', () => ({ encryptAllExistingNotes: vi.fn() }));

const { initializeEncryption, VaultAlreadyExistsError } = await import('../EncryptionService');

describe('initializeEncryption guard', () => {
  beforeEach(() => {
    getEncryptionMeta.mockReset();
    saveEncryptionMeta.mockClear();
    setSessionKey.mockClear();
    setEncryptionEnabled.mockClear();
  });

  it('creates the vault when the profile carries no encryption at all', async () => {
    getEncryptionMeta.mockResolvedValue({ uid: 'user-1', email: 'a@b.c' });

    await initializeEncryption('user-1', 'correct horse battery');

    expect(saveEncryptionMeta).toHaveBeenCalledTimes(1);
    expect(setSessionKey).toHaveBeenCalledWith('data-key');
    expect(setEncryptionEnabled).toHaveBeenCalledWith('user-1', true);
  });

  it('refuses when the profile already has encryptionMeta', async () => {
    getEncryptionMeta.mockResolvedValue({
      uid: 'user-1',
      encryptionMeta: { salt: 's', wrappedDataKey: 'w', verification: 'v', version: 1 },
    });

    await expect(initializeEncryption('user-1', 'pw')).rejects.toThrow(VaultAlreadyExistsError);
    expect(saveEncryptionMeta).not.toHaveBeenCalled();
    expect(setSessionKey).not.toHaveBeenCalled();
  });

  // Частично записанная мета тоже означает «сейф скорее есть»: перезапись
  // здесь — худший из возможных ответов, правильный путь — разбираться руками.
  it('refuses on a partially written encryptionMeta', async () => {
    getEncryptionMeta.mockResolvedValue({ uid: 'user-1', encryptionMeta: { salt: 's' } });

    await expect(initializeEncryption('user-1', 'pw')).rejects.toThrow(VaultAlreadyExistsError);
    expect(saveEncryptionMeta).not.toHaveBeenCalled();
  });

  it('refuses when the profile has the legacy salt + wrapped key pair', async () => {
    getEncryptionMeta.mockResolvedValue({
      uid: 'user-1',
      encryptionSalt: 'legacy-salt',
      encryptedDataKey: 'legacy-wrapped',
    });

    await expect(initializeEncryption('user-1', 'pw')).rejects.toThrow(VaultAlreadyExistsError);
    expect(saveEncryptionMeta).not.toHaveBeenCalled();
  });

  // Главное свойство: «не смог прочитать» — это не «меты нет».
  it('refuses when the profile read fails instead of assuming there is no vault', async () => {
    getEncryptionMeta.mockRejectedValue(new Error('network down'));

    await expect(initializeEncryption('user-1', 'pw')).rejects.toThrow('network down');
    expect(saveEncryptionMeta).not.toHaveBeenCalled();
    expect(setSessionKey).not.toHaveBeenCalled();
    expect(setEncryptionEnabled).not.toHaveBeenCalled();
  });
});
