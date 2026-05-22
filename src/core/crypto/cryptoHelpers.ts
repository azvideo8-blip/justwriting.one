import { encryptContent, decryptContent, getSessionKey } from './encrypt';
import { reportError } from '../errors/reportError';

const encryptionEnabledCache: Record<string, boolean> = {};

export function setEncryptionEnabled(userId: string, enabled: boolean): void {
  if (!userId) return;
  encryptionEnabledCache[userId] = enabled;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`enc_enabled_${userId}`, enabled ? '1' : '0');
    }
  } catch (e) {
    reportError(e, { action: 'setEncryptionEnabled_localStorage', userId });
  }
}

export function isEncryptionEnabled(userId: string): boolean {
  if (!userId) return false;
  if (userId.startsWith('guest_') || userId === 'guest') return false;
  if (encryptionEnabledCache[userId] !== undefined) {
    return encryptionEnabledCache[userId];
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const val = localStorage.getItem(`enc_enabled_${userId}`);
      if (val !== null) {
        const enabled = val === '1';
        encryptionEnabledCache[userId] = enabled;
        return enabled;
      }
    }
  } catch (e) {
    reportError(e, { action: 'isEncryptionEnabled_localStorage', userId });
  }
  return false;
}

export async function maybeEncrypt(
  doc: Record<string, unknown>,
  fields: string[],
  arrayFields: string[],
  userIdOrRequired?: boolean | string,
): Promise<Record<string, unknown>> {
  let required = false;
  let shouldEncrypt = true;

  if (typeof userIdOrRequired === 'boolean') {
    required = userIdOrRequired;
  } else if (typeof userIdOrRequired === 'string') {
    const enabled = isEncryptionEnabled(userIdOrRequired);
    required = enabled;
    shouldEncrypt = enabled;
  }

  if (!shouldEncrypt) {
    const result = { ...doc };
    delete result._encrypted;
    return result;
  }

  const key = getSessionKey();
  if (!key) {
    if (required) throw new Error('ENCRYPT_REQUIRED: session key not available');
    return doc;
  }

  const result: Record<string, unknown> = { ...doc };
  for (const field of fields) {
    const val = result[field];
    if (typeof val === 'string') {
      result[field] = await encryptContent(val, key);
    }
  }
  for (const field of arrayFields) {
    const val = result[field];
    if (Array.isArray(val)) {
      result[field] = await encryptContent(JSON.stringify(val), key);
    }
  }
  result._encrypted = true;
  return result;
}

function deepClone<T>(obj: T): T {
  if (typeof structuredClone === 'function') return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

export class DecryptionError extends Error {
  constructor(field: string, cause?: unknown) {
    super(`DECRYPTION_FAILED: "${field}"`);
    this.name = 'DecryptionError';
    if (cause) this.cause = cause;
  }
}

export async function maybeDecrypt(
  doc: Record<string, unknown>,
  stringFields: string[],
  arrayFields: string[],
): Promise<Record<string, unknown>> {
  const key = getSessionKey();
  const isEncrypted = doc._encrypted === true;

  if (isEncrypted && !key) {
    throw new Error('LOCKED: session key not available');
  }

  const result: Record<string, unknown> = deepClone(doc);
  for (const field of stringFields) {
    const val = result[field];
    if (typeof val === 'string' && isEncrypted && key) {
      try {
        result[field] = await decryptContent(val, key);
      } catch (e) {
        reportError(e, { action: 'maybeDecrypt_stringField', field });
        throw new DecryptionError(field, e);
      }
    }
  }
  for (const field of arrayFields) {
    const val = result[field];
    if (typeof val === 'string' && isEncrypted && key) {
      try {
        result[field] = JSON.parse(await decryptContent(val, key));
      } catch (e) {
        reportError(e, { action: 'maybeDecrypt_arrayField', field });
        throw new DecryptionError(field, e);
      }
    } else if (typeof val === 'string' && !isEncrypted) {
      try {
        result[field] = JSON.parse(val);
      } catch (e) {
        reportError(e, { action: 'maybeDecrypt_jsonParse', field });
        result[field] = [];
      }
    } else if (!Array.isArray(val)) {
      result[field] = [];
    }
  }
  return result;
}
