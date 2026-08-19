import {
  deriveMasterKey,
  generateDataKey,
  wrapDataKey,
  unwrapDataKeyWithPassword,
  encryptContent,
  decryptContent,
  setSessionKey,
  getSessionKey,
  clearSessionKey,
  isVaultUnlocked,
} from '../crypto/encrypt';
import {
  generateRecoveryCode,
  wrapDataKeyWithRecoveryCode,
  unwrapDataKeyWithRecoveryCode,
} from '../crypto/recoveryCode';
import { setEncryptionEnabled } from '../crypto/cryptoHelpers';
import {
  saveEncryptionMeta,
  getEncryptionMeta,
  generateSalt,
  saltToBase64,
  saltFromBase64,
  ENCRYPTION_META_VERSION,
  VERIFICATION_PLAINTEXT,
} from './EncryptionMetaService';
import { encryptAllExistingNotes, type MigrationProgress } from '../crypto/encryptMigration';
import { hasLegacyEncryption, hasVault } from './LegacyKeyMigration';
import { DataProvider } from '../data';
import { updateUserPassword, getCurrentUser } from '../auth';
import { reportError } from '../../shared/errors/reportError';

export { hasVault, hasLegacyEncryption };

export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  return deriveMasterKey(password, salt);
}

export async function encrypt(data: string, key: CryptoKey): Promise<string> {
  return encryptContent(data, key);
}

export async function decrypt(data: string, key: CryptoKey): Promise<string> {
  return decryptContent(data, key);
}

async function createVerification(dataKey: CryptoKey): Promise<string> {
  return encryptContent(VERIFICATION_PLAINTEXT, dataKey);
}

async function verifyKey(dataKey: CryptoKey, verification: string): Promise<boolean> {
  try {
    const result = await decryptContent(verification, dataKey);
    return result === VERIFICATION_PLAINTEXT;
  } catch {
    return false;
  }
}

export class VaultAlreadyExistsError extends Error {
  constructor() {
    super('VAULT_EXISTS');
    this.name = 'VaultAlreadyExistsError';
  }
}

export class WrongPasswordError extends Error {
  constructor() {
    super('WRONG_PASSWORD');
    this.name = 'WrongPasswordError';
  }
}

export class WrongRecoveryCodeError extends Error {
  constructor() {
    super('WRONG_RECOVERY_CODE');
    this.name = 'WrongRecoveryCodeError';
  }
}

export async function initializeEncryption(
  userId: string,
  password: string,
  customRecoveryCode?: string,
): Promise<{ recoveryCode: string }> {
  // Здесь генерируется НОВЫЙ data key, поэтому запись меты поверх существующей
  // навсегда отвязывает уже зашифрованные заметки: старый ключ после этого
  // взять негде. Создаём сейф только при положительном ответе «в профиле
  // ничего нет».
  //
  // Ошибку чтения профиля сознательно не глотаем: «не удалось прочитать» —
  // это не «меты нет». Исключение уходит наружу, и точка входа показывает
  // отказ, а не заводит второй сейф поверх первого.
  //
  // Проверяются оба вида: новая encryption_meta и старая пара
  // encryption_salt + encrypted_data_key (для неё правильный путь —
  // миграция в LegacyKeyMigration, а не создание заново).
  const profile = await DataProvider.getEncryptionMeta(userId);
  const legacy = hasLegacyEncryption(profile as { encryptionSalt?: string; encryptedDataKey?: string } | null);
  if ((profile?.encryptionMeta != null) || legacy) throw new VaultAlreadyExistsError();

  const salt = generateSalt();
  const masterKey = await deriveMasterKey(password, salt);
  const dataKey = await generateDataKey();
  const wrappedDataKey = await wrapDataKey(dataKey, masterKey);
  const verification = await createVerification(dataKey);

  const recoveryCode = customRecoveryCode ?? generateRecoveryCode();
  const recoverySalt = generateSalt();
  const recoveryWrappedDataKey = await wrapDataKeyWithRecoveryCode(dataKey, recoveryCode, recoverySalt);

  await saveEncryptionMeta(userId, {
    salt: saltToBase64(salt),
    version: ENCRYPTION_META_VERSION,
    wrappedDataKey,
    verification,
    recoveryWrappedDataKey,
    recoverySalt: saltToBase64(recoverySalt),
  });

  setSessionKey(dataKey);
  setEncryptionEnabled(userId, true);

  return { recoveryCode };
}

export async function unlockVault(userId: string, password: string): Promise<void> {
  const meta = await getEncryptionMeta(userId);
  if (!meta) throw new Error('Encryption not configured');

  const salt = saltFromBase64(meta.salt);

  let dataKey: CryptoKey;
  try {
    // Tries the current PBKDF2 count, then the pre-SEC-36 one. Without the
    // fallback a vault wrapped at 300k reports WrongPasswordError for the
    // correct password — the user is locked out of their own notes.
    ({ dataKey } = await unwrapDataKeyWithPassword(meta.wrappedDataKey, password, salt));
  } catch {
    throw new WrongPasswordError();
  }

  if (meta.verification) {
    const valid = await verifyKey(dataKey, meta.verification);
    if (!valid) throw new WrongPasswordError();
  }

  setSessionKey(dataKey);
  setEncryptionEnabled(userId, true);
}

export async function recoverVaultWithCode(
  userId: string,
  recoveryCode: string,
  newPassword: string,
): Promise<void> {
  const meta = await getEncryptionMeta(userId);
  if (!meta) throw new Error('Encryption not configured');
  if (!meta.recoveryWrappedDataKey || !meta.recoverySalt) {
    throw new Error('NO_RECOVERY_CODE');
  }

  const recoverySalt = saltFromBase64(meta.recoverySalt);
  let dataKey: CryptoKey;
  try {
    dataKey = await unwrapDataKeyWithRecoveryCode(meta.recoveryWrappedDataKey, recoveryCode, recoverySalt);
  } catch {
    throw new WrongRecoveryCodeError();
  }

  if (meta.verification) {
    const valid = await verifyKey(dataKey, meta.verification);
    if (!valid) throw new WrongRecoveryCodeError();
  }

  const newSalt = generateSalt();
  const newMasterKey = await deriveMasterKey(newPassword, newSalt);
  const newWrappedDataKey = await wrapDataKey(dataKey, newMasterKey);

  await saveEncryptionMeta(userId, {
    salt: saltToBase64(newSalt),
    version: ENCRYPTION_META_VERSION,
    wrappedDataKey: newWrappedDataKey,
    verification: meta.verification || (await createVerification(dataKey)),
    recoveryWrappedDataKey: meta.recoveryWrappedDataKey,
    recoverySalt: meta.recoverySalt,
  });

  setSessionKey(dataKey);
  setEncryptionEnabled(userId, true);

  if (getCurrentUser()) {
    try {
      await updateUserPassword(newPassword);
    } catch (e) {
      reportError(e, { action: 'recoverVault_updateUserPassword', userId });
    }
  }
}

export class KeyNotExtractableError extends Error {
  constructor(message = 'KEY_NOT_EXTRACTABLE: encryption password required to re-wrap data key') {
    super(message);
    this.name = 'KeyNotExtractableError';
  }
}

export async function generateRecoveryCodeForExistingVault(userId: string, password?: string): Promise<string> {
  const currentKey = getSessionKey();
  if (!currentKey) throw new Error('Vault is locked');

  const meta = await getEncryptionMeta(userId);
  if (!meta) throw new Error('Encryption not configured');

  let keyToWrap: CryptoKey;
  if (!currentKey.extractable) {
    if (!password) {
      throw new KeyNotExtractableError();
    }
    const oldSalt = saltFromBase64(meta.salt);
    try {
      ({ dataKey: keyToWrap } = await unwrapDataKeyWithPassword(meta.wrappedDataKey, password, oldSalt));
    } catch {
      throw new WrongPasswordError();
    }
    if (meta.verification) {
      const valid = await verifyKey(keyToWrap, meta.verification);
      if (!valid) throw new WrongPasswordError();
    }
    // CRITICAL: Do NOT call setSessionKey(keyToWrap) here.
    // The session key remains the non-extractable device key.
  } else {
    keyToWrap = currentKey;
  }

  const recoveryCode = generateRecoveryCode();
  const recoverySalt = generateSalt();
  const recoveryWrappedDataKey = await wrapDataKeyWithRecoveryCode(keyToWrap, recoveryCode, recoverySalt);

  await saveEncryptionMeta(userId, {
    ...meta,
    version: ENCRYPTION_META_VERSION,
    recoveryWrappedDataKey,
    recoverySalt: saltToBase64(recoverySalt),
  });

  return recoveryCode;
}

export function lockVault(_userId: string): void {
  clearSessionKey();
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const meta = await getEncryptionMeta(userId);
  if (!meta) throw new Error('Encryption not configured');

  const oldSalt = saltFromBase64(meta.salt);

  let dataKey: CryptoKey;
  try {
    // Same fallback as unlockVault: changing the password on a legacy vault
    // must not be blocked by the iteration raise either.
    ({ dataKey } = await unwrapDataKeyWithPassword(meta.wrappedDataKey, currentPassword, oldSalt));
  } catch {
    throw new WrongPasswordError();
  }

  if (meta.verification) {
    const valid = await verifyKey(dataKey, meta.verification);
    if (!valid) throw new WrongPasswordError();
  }

  const newSalt = generateSalt();
  const newMasterKey = await deriveMasterKey(newPassword, newSalt);
  const newWrappedDataKey = await wrapDataKey(dataKey, newMasterKey);

  await saveEncryptionMeta(userId, {
    salt: saltToBase64(newSalt),
    version: ENCRYPTION_META_VERSION,
    wrappedDataKey: newWrappedDataKey,
    verification: meta.verification || (await createVerification(dataKey)),
    recoveryWrappedDataKey: meta.recoveryWrappedDataKey,
    recoverySalt: meta.recoverySalt,
  });

  setSessionKey(dataKey);

  if (getCurrentUser()) {
    try {
      await updateUserPassword(newPassword);
    } catch (e) {
      reportError(e, { action: 'changePassword_updateUserPassword', userId });
    }
  }
}

/**
 * @deprecated Use changePassword instead. Re-encryption of documents is unnecessary
 * because the data key does not change when changing the password.
 */
export async function changePasswordWithReEncrypt(
  userId: string,
  currentPassword: string,
  newPassword: string,
  onProgress?: (p: { done: number; total: number }) => void,
): Promise<void> {
  const result = await changePassword(userId, currentPassword, newPassword);
  if (onProgress) {
    onProgress({ done: 1, total: 1 });
  }
  return result;
}

async function encryptAll(userId: string, onProgress: (p: MigrationProgress) => void, signal: AbortSignal) {
  if (!getSessionKey()) throw new Error('Vault is locked');
  return encryptAllExistingNotes(userId, onProgress, signal);
}

function _generateEncryptionSalt(): Uint8Array {
  return generateSalt();
}

export { _generateEncryptionSalt as generateEncryptionSalt };

export const EncryptionService = {
  generateSalt: _generateEncryptionSalt,
  deriveKey,
  encrypt,
  decrypt,
  initializeEncryption,
  unlockVault,
  recoverVaultWithCode,
  generateRecoveryCodeForExistingVault,
  lockVault,
  changePassword,
  changePasswordWithReEncrypt,
  encryptAll,
  isVaultUnlocked,
  WrongPasswordError,
  WrongRecoveryCodeError,
  VaultAlreadyExistsError,
  KeyNotExtractableError,
};
