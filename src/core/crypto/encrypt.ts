const PBKDF2_ITERATIONS = 300_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

function toBase64(buf: Uint8Array): string {
  const CHUNK = 0x8000;
  const len = buf.length;
  if (len === 0) return '';
  const parts: string[] = [];
  for (let i = 0; i < len; i += CHUNK) {
    const end = Math.min(i + CHUNK, len);
    parts.push(String.fromCharCode(...buf.subarray(i, end)));
  }
  return btoa(parts.join(''));
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function deriveMasterKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
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
  return crypto.subtle.unwrapKey(
    'raw',
    raw,
    masterKey,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptContent(plaintext: string, dataKey: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    dataKey,
    encoder.encode(plaintext),
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return toBase64(combined);
}

export async function decryptContent(ciphertext: string, dataKey: CryptoKey): Promise<string> {
  const raw = fromBase64(ciphertext);
  const iv = raw.slice(0, IV_LENGTH);
  const data = raw.slice(IV_LENGTH);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    dataKey,
    data,
  );
  return new TextDecoder().decode(decrypted);
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
