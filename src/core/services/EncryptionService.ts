import { deriveMasterKey, generateDataKey, wrapDataKey, unwrapDataKey, encryptContent, decryptContent, setSessionKey, getSessionKey, clearSessionKey, isVaultUnlocked } from '../crypto/encrypt';
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

export async function initializeEncryption(userId: string, password: string): Promise<void> {
  const salt = generateSalt();
  const masterKey = await deriveMasterKey(password, salt);
  const dataKey = await generateDataKey();
  const wrappedDataKey = await wrapDataKey(dataKey, masterKey);
  const verification = await createVerification(dataKey);

  await saveEncryptionMeta(userId, {
    salt: saltToBase64(salt),
    version: ENCRYPTION_META_VERSION,
    wrappedDataKey,
    verification,
  });

  setSessionKey(dataKey);
  setEncryptionEnabled(userId, true);
}

export class WrongPasswordError extends Error {
  constructor() {
    super('WRONG_PASSWORD');
    this.name = 'WrongPasswordError';
  }
}

export async function unlockVault(userId: string, password: string): Promise<void> {
  const meta = await getEncryptionMeta(userId);
  if (!meta) throw new Error('Encryption not configured');

  const salt = saltFromBase64(meta.salt);
  const masterKey = await deriveMasterKey(password, salt);

  let dataKey: CryptoKey;
  try {
    dataKey = await unwrapDataKey(meta.wrappedDataKey, masterKey);
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

export function lockVault(userId: string): void {
  clearSessionKey();
  setEncryptionEnabled(userId, false);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const meta = await getEncryptionMeta(userId);
  if (!meta) throw new Error('Encryption not configured');

  const oldSalt = saltFromBase64(meta.salt);
  const oldMasterKey = await deriveMasterKey(currentPassword, oldSalt);

  let dataKey: CryptoKey;
  try {
    dataKey = await unwrapDataKey(meta.wrappedDataKey, oldMasterKey);
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
  const newVerification = await createVerification(dataKey);

  await saveEncryptionMeta(userId, {
    salt: saltToBase64(newSalt),
    version: ENCRYPTION_META_VERSION,
    wrappedDataKey: newWrappedDataKey,
    verification: newVerification,
  });

  setSessionKey(dataKey);
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
  lockVault,
  changePassword,
  encryptAll,
  isVaultUnlocked,
  WrongPasswordError,
};
