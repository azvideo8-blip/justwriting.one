import { describe, it, expect } from 'vitest';
import {
  deriveMasterKey,
  generateDataKey,
  wrapDataKey,
  unwrapDataKey,
  encryptContent,
  decryptContent,
  toBase64,
  fromBase64,
  SALT_LENGTH,
} from '../crypto/encrypt';

describe('encrypt module', () => {
  it('toBase64 / fromBase64 roundtrip', () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 128, 42]);
    const b64 = toBase64(bytes);
    const restored = fromBase64(b64);
    expect(restored).toEqual(bytes);
  });

  it('deriveMasterKey produces a valid CryptoKey', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const key = await deriveMasterKey('test-password', salt);
    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
  });

  it('same password + salt → same master key', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const k1 = await deriveMasterKey('mypassword', salt);
    const k2 = await deriveMasterKey('mypassword', salt);
    const dk = await generateDataKey();
    const wrapped1 = await wrapDataKey(dk, k1);
    const unwrapped = await unwrapDataKey(wrapped1, k2);
    expect(unwrapped).toBeDefined();
  });

  it('different password → unwrap fails', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const k1 = await deriveMasterKey('password1', salt);
    const k2 = await deriveMasterKey('password2', salt);
    const dk = await generateDataKey();
    const wrapped = await wrapDataKey(dk, k1);
    await expect(unwrapDataKey(wrapped, k2)).rejects.toThrow();
  });

  it('wrapDataKey / unwrapDataKey roundtrip', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const masterKey = await deriveMasterKey('pass', salt);
    const dataKey = await generateDataKey();
    const wrapped = await wrapDataKey(dataKey, masterKey);
    const unwrapped = await unwrapDataKey(wrapped, masterKey);
    const plain = 'hello encryption';
    const ct = await encryptContent(plain, dataKey);
    const pt = await decryptContent(ct, unwrapped);
    expect(pt).toBe(plain);
  });

  it('encrypt / decrypt roundtrip', async () => {
    const dataKey = await generateDataKey();
    const plain = 'The quick brown fox jumps over the lazy dog';
    const ct = await encryptContent(plain, dataKey);
    const pt = await decryptContent(ct, dataKey);
    expect(pt).toBe(plain);
  });

  it('wrong key → decrypt throws', async () => {
    const k1 = await generateDataKey();
    const k2 = await generateDataKey();
    const ct = await encryptContent('secret', k1);
    await expect(decryptContent(ct, k2)).rejects.toThrow();
  });

  it('unicode / emoji', async () => {
    const dataKey = await generateDataKey();
    const plain = 'Привет 🌍 こんにちは 한국어 emoji: 🎉🚀💡';
    const ct = await encryptContent(plain, dataKey);
    const pt = await decryptContent(ct, dataKey);
    expect(pt).toBe(plain);
  });

  it('large content (>100kb)', async () => {
    const dataKey = await generateDataKey();
    const plain = 'A'.repeat(150_000);
    const ct = await encryptContent(plain, dataKey);
    const pt = await decryptContent(ct, dataKey);
    expect(pt).toBe(plain);
    expect(ct.length).toBeLessThan(plain.length * 2);
  });

  it('empty string', async () => {
    const dataKey = await generateDataKey();
    const plain = '';
    const ct = await encryptContent(plain, dataKey);
    const pt = await decryptContent(ct, dataKey);
    expect(pt).toBe(plain);
  });

  it('full flow: password → masterKey → wrap/unwrap dataKey → encrypt/decrypt', async () => {
    const password = 'user-password-123';
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const masterKey = await deriveMasterKey(password, salt);
    const dataKey = await generateDataKey();
    const wrapped = await wrapDataKey(dataKey, masterKey);
    const unwrapped = await unwrapDataKey(wrapped, masterKey);
    const plain = 'This is a secret writing session';
    const ct = await encryptContent(plain, unwrapped);
    const pt = await decryptContent(ct, unwrapped);
    expect(pt).toBe(plain);
  });
});
