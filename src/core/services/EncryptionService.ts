import { takePendingLoginPassword, clearPendingLoginPassword } from '../crypto/pendingLoginPassword';
import {
  deriveMasterKey,
  generateDataKey,
  wrapDataKey,
  unwrapDataKey,
  unwrapDataKeyWithPassword,
  PBKDF2_ITERATIONS,
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
import { broadcastManualLock, setRememberDevice } from '../crypto/useEncryptionStore';
import {
  saveEncryptionMeta,
  getEncryptionMeta,
  generateSalt,
  saltToBase64,
  saltFromBase64,
  ENCRYPTION_META_VERSION,
  VERIFICATION_PLAINTEXT,
} from './EncryptionMetaService';
import type { MigrationProgress } from '../crypto/encryptMigration';
import { hasLegacyEncryption, hasVault } from './LegacyKeyMigration';
import { DataProvider } from '../data';
import { updateUserPassword, getCurrentUser } from '../auth';
import { reportError } from '../../shared/errors/reportError';

export { hasVault, hasLegacyEncryption };

export async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
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

function isWrongKeyOperationError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'OperationError';
}

async function verifyKey(dataKey: CryptoKey, verification: string): Promise<boolean> {
  try {
    const result = await decryptContent(verification, dataKey);
    return result === VERIFICATION_PLAINTEXT;
  } catch (e) {
    if (isWrongKeyOperationError(e)) {
      return false;
    }
    reportError(e, { action: 'verifyKey' });
    throw e;
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
  autoCreated?: boolean,
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
    iterations: PBKDF2_ITERATIONS, // AUDIT-L7: фиксируем, чтобы unwrap не перебирал
    autoCreated,
  });

  setSessionKey(dataKey);
  setEncryptionEnabled(userId, true);

  if (autoCreated) {
    try {
      const { saveDeviceKey } = await import('../crypto/keyVaultCache');
      await saveDeviceKey(userId, dataKey);
      setRememberDevice(true);
    } catch { /* намеренно: сохранение ключа устройства опционально (напр. режим инкогнито) */ }
  }

  return { recoveryCode };
}

export async function unlockVault(userId: string, password: string): Promise<void> {
  const meta = await getEncryptionMeta(userId);
  if (!meta) throw new Error('Encryption not configured');

  let dataKey: CryptoKey;
  let usedLegacyIterations = false;
  try {
    const salt = saltFromBase64(meta.salt);
    // Tries the current PBKDF2 count, then the pre-SEC-36 one. Without the
    // fallback a vault wrapped at 300k reports WrongPasswordError for the
    // correct password — the user is locked out of their own notes.
    // AUDIT-L7: известные итерации — одна попытка вместо перебора 600k/300k.
    ({ dataKey, usedLegacyIterations } = await unwrapDataKeyWithPassword(meta.wrappedDataKey, password, salt, undefined, undefined, meta.iterations));
  } catch (e) {
    if (isWrongKeyOperationError(e)) {
      throw new WrongPasswordError();
    }
    reportError(e, { action: 'unlock_key_derivation', userId });
    throw e;
  }

  if (meta.verification) {
    const valid = await verifyKey(dataKey, meta.verification);
    if (!valid) throw new WrongPasswordError();
  }

  setSessionKey(dataKey);
  setEncryptionEnabled(userId, true);

  // D-28: сейф открыли не тем паролем, которым вошли (пароль входа сбросили по
  // почте) — перешифровываем сейф паролем входа, и пароли снова одинаковые.
  let passwordConverged = false;
  const loginPassword = takePendingLoginPassword(userId);
  if (loginPassword && loginPassword !== password) {
    try {
      await rewrapVaultPassword(userId, password, loginPassword);
      passwordConverged = true;
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(VAULT_PASSWORD_CONVERGED_EVENT));
    } catch (e) {
      // Сейф уже открыт — неудача сведения не повод его закрывать; попробуем при следующем входе.
      reportError(e, { action: 'unlockVault_convergePassword', userId }, 'warning');
    }
  }

  // C-1 (F-017): Re-wrap legacy vaults (unwrapped with < PBKDF2_ITERATIONS)
  // to PBKDF2_ITERATIONS (600k) on unlock, if password convergence did not already re-wrap.
  if (usedLegacyIterations && !passwordConverged) {
    try {
      const newSalt = generateSalt();
      const newMasterKey = await deriveMasterKey(password, newSalt, PBKDF2_ITERATIONS);
      const newWrappedDataKey = await wrapDataKey(dataKey, newMasterKey);

      // Verify the new wrap before saving it: unwrap with freshly derived key and verify against verification
      const verifyMasterKey = await deriveMasterKey(password, newSalt, PBKDF2_ITERATIONS);
      const unwrappedCandidate = await unwrapDataKey(newWrappedDataKey, verifyMasterKey);
      const isVerified = meta.verification
        ? await verifyKey(unwrappedCandidate, meta.verification)
        : true;
      if (!isVerified) {
        throw new Error('Re-wrap verification failed');
      }

      await saveEncryptionMeta(userId, {
        salt: saltToBase64(newSalt),
        version: meta.version ?? ENCRYPTION_META_VERSION,
        wrappedDataKey: newWrappedDataKey,
        verification: meta.verification,
        recoveryWrappedDataKey: meta.recoveryWrappedDataKey,
        recoverySalt: meta.recoverySalt,
        iterations: PBKDF2_ITERATIONS,
      });
    } catch (e) {
      reportError(e, { action: 'unlockVault_legacyRewrap', userId }, 'warning');
    }
  }

  try {
    const { SyncService } = await import('./SyncService');
    await SyncService.reviveLockedTasks(userId);
    void SyncService.syncPending(userId);
  } catch { /* non-critical */ }
}

export const VAULT_PASSWORD_CONVERGED_EVENT = 'vault-password-converged';

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

  let dataKey: CryptoKey;
  try {
    const recoverySalt = saltFromBase64(meta.recoverySalt);
    dataKey = await unwrapDataKeyWithRecoveryCode(meta.recoveryWrappedDataKey, recoveryCode, recoverySalt);
  } catch (e) {
    if (isWrongKeyOperationError(e)) {
      throw new WrongRecoveryCodeError();
    }
    reportError(e, { action: 'recover_key_derivation', userId });
    throw e;
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
    // AUDIT-L7: ключ только что перевёрнут на PBKDF2_ITERATIONS — запись
    // обязана сказать об этом. Унаследовать прежнее значение и промолчать
    // значит однажды, при подъёме константы, развести число в мете с числом
    // в ключе: unwrap с `knownIterations` фолбэка не имеет, и сейф не откроется.
    iterations: PBKDF2_ITERATIONS,
  });

  setSessionKey(dataKey);
  setEncryptionEnabled(userId, true);
  try {
    const { SyncService } = await import('./SyncService');
    await SyncService.reviveLockedTasks(userId);
    void SyncService.syncPending(userId);
  } catch { /* non-critical */ }

  // Восстановление ставит новый пароль и на сейф, и на вход — они снова одинаковые.
  clearPendingLoginPassword(userId);
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
    try {
      const oldSalt = saltFromBase64(meta.salt);
      ({ dataKey: keyToWrap } = await unwrapDataKeyWithPassword(meta.wrappedDataKey, password, oldSalt, undefined, undefined, meta.iterations));
    } catch (e) {
      if (isWrongKeyOperationError(e)) {
        throw new WrongPasswordError();
      }
      reportError(e, { action: 'generateRecoveryCode_unwrap', userId });
      throw e;
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
  broadcastManualLock();
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  await rewrapVaultPassword(userId, currentPassword, newPassword);
  clearPendingLoginPassword(userId);

  if (getCurrentUser()) {
    try {
      await updateUserPassword(newPassword);
    } catch (e) {
      // Пароль входа не сменился — возвращаем сейф на прежний, иначе человек
      // видит «готово», а вход и заметки остаются на разных паролях.
      reportError(e, { action: 'changePassword_updateUserPassword', userId });
      await rewrapVaultPassword(userId, newPassword, currentPassword);
      throw e;
    }
  }
}

/**
 * Перешифровать ключ сейфа новым паролем, не трогая пароль входа. Ключ данных
 * не меняется, поэтому заметки перешифровывать не нужно.
 */
async function rewrapVaultPassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const meta = await getEncryptionMeta(userId);
  if (!meta) throw new Error('Encryption not configured');

  let dataKey: CryptoKey;
  try {
    const oldSalt = saltFromBase64(meta.salt);
    // Same fallback as unlockVault: changing the password on a legacy vault
    // must not be blocked by the iteration raise either.
    ({ dataKey } = await unwrapDataKeyWithPassword(meta.wrappedDataKey, currentPassword, oldSalt, undefined, undefined, meta.iterations));
  } catch (e) {
    if (isWrongKeyOperationError(e)) {
      throw new WrongPasswordError();
    }
    reportError(e, { action: 'changePassword_unwrap', userId });
    throw e;
  }

  if (meta.verification) {
    const valid = await verifyKey(dataKey, meta.verification);
    if (!valid) throw new WrongPasswordError();
  }

  const iterations = PBKDF2_ITERATIONS;
  const newSalt = generateSalt();
  const newMasterKey = await deriveMasterKey(newPassword, newSalt, iterations);
  const newWrappedDataKey = await wrapDataKey(dataKey, newMasterKey);

  await saveEncryptionMeta(userId, {
    salt: saltToBase64(newSalt),
    version: ENCRYPTION_META_VERSION,
    wrappedDataKey: newWrappedDataKey,
    verification: meta.verification || (await createVerification(dataKey)),
    recoveryWrappedDataKey: meta.recoveryWrappedDataKey,
    recoverySalt: meta.recoverySalt,
    iterations,
  });

  setSessionKey(dataKey);
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

export async function encryptAll(
  userId: string,
  onProgress?: (p: MigrationProgress) => void,
  signal?: AbortSignal,
): Promise<MigrationProgress> {
  if (!getSessionKey()) throw new Error('Vault is locked');
  // Миграция нужна раз в жизни сейфа — из стартового куска она вынесена (бюджет CI).
  const { encryptAllExistingNotes } = await import('../crypto/encryptMigration');
  return encryptAllExistingNotes(userId, onProgress, signal);
}

export interface PostSetupMigrationResult {
  encrypted: number;
  total: number;
  errors: number;
  success: boolean;
}

export async function migrateNotesAfterSetup(
  userId: string,
  onProgress?: (p: MigrationProgress) => void,
  signal?: AbortSignal,
): Promise<PostSetupMigrationResult> {
  let lastProgress: MigrationProgress = { total: 0, processed: 0, encrypted: 0, errors: 0 };
  const progressHandler = (p: MigrationProgress) => {
    lastProgress = p;
    onProgress?.(p);
  };
  try {
    const progress = await encryptAll(userId, progressHandler, signal);
    return {
      encrypted: progress.encrypted,
      total: progress.total,
      errors: progress.errors,
      success: progress.errors === 0,
    };
  } catch (err) {
    reportError(err, { action: 'migrateNotesAfterSetup', userId });
    return {
      encrypted: lastProgress.encrypted,
      total: lastProgress.total,
      errors: Math.max(1, lastProgress.errors),
      success: false,
    };
  }
}

function _generateEncryptionSalt(): Uint8Array<ArrayBuffer> {
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
  migrateNotesAfterSetup,
  isVaultUnlocked,
  WrongPasswordError,
  WrongRecoveryCodeError,
  VaultAlreadyExistsError,
  KeyNotExtractableError,
};
