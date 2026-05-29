const PBKDF2_ITERATIONS = 300_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

// [S-01] заменен на нативный btoa/atob вместо кастомной реализации
function toBase64(buf: Uint8Array): string {
  let binary = '';
  const len = buf.length;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) buf[i] = binary.charCodeAt(i);
  return buf;
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
  }
  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_LENGTH);
  secureClear(iv);
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

import { useEncryptionStore } from './useEncryptionStore';

export function setSessionKey(key: CryptoKey): void {
  useEncryptionStore.getState().setKey(key);
}

export function getSessionKey(): CryptoKey | null {
  return useEncryptionStore.getState().dataKey;
}

export function clearSessionKey(): void {
  useEncryptionStore.getState().lockVault();
}

export function isVaultUnlocked(): boolean {
  return useEncryptionStore.getState().isVaultUnlocked;
}

export { toBase64, fromBase64, SALT_LENGTH };
