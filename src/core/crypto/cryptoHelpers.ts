import { encryptContent, decryptContent, getSessionKey } from './encrypt';
import { useEncryptionStore } from './useEncryptionStore';
import { reportError } from '../errors/reportError';

export function setEncryptionEnabled(userId: string, enabled: boolean): void {
  useEncryptionStore.getState().setEncryptionEnabled(userId, enabled);
}

export function getEncryptionEnabled(userId: string): boolean {
  return useEncryptionStore.getState().getEncryptionEnabled(userId);
}

export interface VersionEncryptPayload {
  content: string;
  previousContent: string;
  wordCount: number;
  duration: number;
  wpm: number;
  versionNumber: number;
  goalWords?: number | undefined;
  goalTime?: number | undefined;
  goalReached?: boolean | undefined;
  sessionStartedAt: Date;
  mood?: string | undefined;
  [key: string]: unknown;
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
    const enabled = getEncryptionEnabled(userIdOrRequired);
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

export function setProfileLoaded(userId: string, loaded: boolean): void {
  useEncryptionStore.getState().setProfileLoaded(userId, loaded);
}

export function isProfileLoaded(userId: string): boolean {
  return useEncryptionStore.getState().isProfileLoaded(userId);
}

