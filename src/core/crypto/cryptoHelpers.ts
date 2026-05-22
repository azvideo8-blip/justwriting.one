import { encryptContent, decryptContent, getSessionKey } from './encrypt';
import { reportError } from '../errors/reportError';

export async function maybeEncrypt(
  doc: Record<string, unknown>,
  fields: string[],
  arrayFields: string[],
  required?: boolean,
): Promise<Record<string, unknown>> {
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

  const result: Record<string, unknown> = { ...doc };
  for (const field of stringFields) {
    const val = result[field];
    if (typeof val === 'string' && isEncrypted && key) {
      try {
        result[field] = await decryptContent(val, key);
      } catch (e) {
        reportError(e, { action: 'maybeDecrypt_stringField', field });
        result[field] = `[${field}: decryption error]`;
        result._decryptionError = true;
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
        result[field] = [];
        result._decryptionError = true;
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
