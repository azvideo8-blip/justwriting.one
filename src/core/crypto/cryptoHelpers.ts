import { encryptContent, decryptContent, getSessionKey } from './encrypt';

export async function maybeEncrypt(
  doc: Record<string, unknown>,
  fields: string[],
  arrayFields: string[],
): Promise<Record<string, unknown>> {
  const key = getSessionKey();
  if (!key) return doc;

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

  const result: Record<string, unknown> = { ...doc };
  for (const field of stringFields) {
    const val = result[field];
    if (typeof val === 'string' && isEncrypted && key) {
      result[field] = await decryptContent(val, key);
    }
  }
  for (const field of arrayFields) {
    const val = result[field];
    if (typeof val === 'string' && isEncrypted && key) {
      try {
        result[field] = JSON.parse(await decryptContent(val, key));
      } catch {
        result[field] = [];
      }
    } else if (typeof val === 'string' && !isEncrypted) {
      try {
        result[field] = JSON.parse(val);
      } catch {
        result[field] = [];
      }
    } else if (!Array.isArray(val)) {
      result[field] = [];
    }
  }
  return result;
}
