import { describe, it, expect } from 'vitest';
import {
  generateDataKey,
  deriveMasterKey,
  wrapDataKey,
  unwrapDataKey,
  encryptContent,
  decryptContent,
  unwrapDataKeyWithPassword,
} from '../encrypt';
import { generateSalt } from '../../services/EncryptionMetaService';

describe('AG-TS-1 — TypeScript 5.9 WebCrypto roundtrip and type ownership', () => {
  it('round-trips a note through encrypt/decrypt with zero-copy Uint8Array<ArrayBuffer> typing', async () => {
    const password = 'ts59-secure-vault-pass';
    const salt = generateSalt();

    // Derive master key from password + salt
    const masterKey = await deriveMasterKey(password, salt, 10_000);
    expect(masterKey).toBeDefined();

    // Generate random AES-GCM data key
    const dataKey = await generateDataKey();
    expect(dataKey).toBeDefined();

    // Wrap data key with master key
    const wrappedKey = await wrapDataKey(dataKey, masterKey);
    expect(typeof wrappedKey).toBe('string');

    // Unwrap data key
    const unwrappedKey = await unwrapDataKey(wrappedKey, masterKey);
    expect(unwrappedKey).toBeDefined();

    // Unwrap with password helper
    const { dataKey: passUnwrappedKey, usedLegacyIterations } = await unwrapDataKeyWithPassword(
      wrappedKey,
      password,
      salt,
      10_000,
      5_000,
    );
    expect(passUnwrappedKey).toBeDefined();
    expect(usedLegacyIterations).toBe(false);

    // Encrypt content
    const sampleNote = 'Всё, что вынуто из настоящего архива, считается персональными данными. TS 5.9 roundtrip test.';
    const ciphertext = await encryptContent(sampleNote, dataKey);
    expect(typeof ciphertext).toBe('string');
    expect(ciphertext).not.toContain(sampleNote);

    // Decrypt content using unwrapped key
    const decrypted = await decryptContent(ciphertext, passUnwrappedKey);
    expect(decrypted).toBe(sampleNote);
  });
});
