const PBKDF2_ITERATIONS = 300_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_ENCODE: readonly string[] = Array.from(B64_CHARS);
const B64_DECODE = new Uint8Array(256);
for (let i = 0; i < 64; i++) B64_DECODE[B64_CHARS.charCodeAt(i)] = i;

function toBase64(buf: Uint8Array): string {
  const len = buf.length;
  if (len === 0) return '';
  const outLen = 4 * Math.ceil(len / 3);
  const out: string[] = new Array(outLen);
  let j = 0;
  for (let i = 0; i < len; i += 3) {
    const b0 = buf[i];
    const b1 = i + 1 < len ? buf[i + 1] : 0;
    const b2 = i + 2 < len ? buf[i + 2] : 0;
    out[j++] = B64_ENCODE[b0 >> 2];
    out[j++] = B64_ENCODE[((b0 & 0x03) << 4) | (b1 >> 4)];
    out[j++] = i + 1 < len ? B64_ENCODE[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out[j++] = i + 2 < len ? B64_ENCODE[b2 & 0x3f] : '=';
  }
  return out.join('');
}

function fromBase64(b64: string): Uint8Array {
  const len = b64.length;
  if (len === 0) return new Uint8Array(0);
  const padding = (b64[len - 1] === '=' ? 1 : 0) + (b64[len - 2] === '=' ? 1 : 0);
  const outLen = (len * 3) / 4 - padding;
  const out = new Uint8Array(outLen);
  let j = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = B64_DECODE[b64.charCodeAt(i)];
    const c1 = B64_DECODE[b64.charCodeAt(i + 1)];
    const c2 = B64_DECODE[b64.charCodeAt(i + 2)];
    const c3 = B64_DECODE[b64.charCodeAt(i + 3)];
    out[j++] = (c0 << 2) | (c1 >> 4);
    if (j < outLen) out[j++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (j < outLen) out[j++] = ((c2 & 0x03) << 6) | c3;
  }
  return out;
}

function secureClear(buf: Uint8Array): void {
  buf.fill(0);
}

export async function deriveMasterKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);
  try {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordBytes,
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    return await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-KW', length: 256 },
      false,
      ['wrapKey', 'unwrapKey'],
    );
  } finally {
    secureClear(passwordBytes);
  }
}

export async function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function wrapDataKey(dataKey: CryptoKey, masterKey: CryptoKey): Promise<string> {
  const wrapped = await crypto.subtle.wrapKey('raw', dataKey, masterKey, 'AES-KW');
  return toBase64(new Uint8Array(wrapped));
}

export async function unwrapDataKey(wrappedKey: string, masterKey: CryptoKey): Promise<CryptoKey> {
  const raw = fromBase64(wrappedKey);
  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      raw,
      masterKey,
      'AES-KW',
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
  } finally {
    secureClear(raw);
  }
}

export async function encryptContent(plaintext: string, dataKey: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();
  const plainBytes = encoder.encode(plaintext);
  let ciphertext: ArrayBuffer;
  try {
    ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      dataKey,
      plainBytes,
    );
  } finally {
    secureClear(plainBytes);
    secureClear(iv);
  }
  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  combined.set(new Uint8Array(ciphertext), IV_LENGTH);
  return toBase64(combined);
}

export async function decryptContent(ciphertext: string, dataKey: CryptoKey): Promise<string> {
  const raw = fromBase64(ciphertext);
  const iv = raw.subarray(0, IV_LENGTH);
  const data = raw.subarray(IV_LENGTH);
  let decrypted: ArrayBuffer;
  try {
    decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      dataKey,
      data,
    );
  } finally {
    secureClear(raw);
  }
  const decryptedBytes = new Uint8Array(decrypted);
  try {
    return new TextDecoder().decode(decryptedBytes);
  } finally {
    secureClear(decryptedBytes);
  }
}

let _dataKey: CryptoKey | null = null;

export function setSessionKey(key: CryptoKey): void {
  _dataKey = key;
}

export function getSessionKey(): CryptoKey | null {
  return _dataKey;
}

export function clearSessionKey(): void {
  _dataKey = null;
}

export { toBase64, fromBase64, SALT_LENGTH };
