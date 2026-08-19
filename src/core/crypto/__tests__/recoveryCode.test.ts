import { describe, it, expect } from 'vitest';
import {
  generateRecoveryCode,
  normalizeRecoveryCode,
  isValidRecoveryCode,
  formatRecoveryCode,
  CROCKFORD_BASE32_ALPHABET,
  wrapDataKeyWithRecoveryCode,
  unwrapDataKeyWithRecoveryCode,
} from '../recoveryCode';
import { generateDataKey, encryptContent, decryptContent, SALT_LENGTH } from '../encrypt';

describe('recoveryCode module', { timeout: 30_000 }, () => {
  it('alphabet does not contain I, L, O, U', () => {
    expect(CROCKFORD_BASE32_ALPHABET).toHaveLength(32);
    expect(CROCKFORD_BASE32_ALPHABET).not.toContain('I');
    expect(CROCKFORD_BASE32_ALPHABET).not.toContain('L');
    expect(CROCKFORD_BASE32_ALPHABET).not.toContain('O');
    expect(CROCKFORD_BASE32_ALPHABET).not.toContain('U');
  });

  it('generates 24-character code in 6 groups of 4', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(isValidRecoveryCode(code)).toBe(true);
  });

  it('two successive generations produce different codes', () => {
    const code1 = generateRecoveryCode();
    const code2 = generateRecoveryCode();
    expect(code1).not.toBe(code2);
  });

  it('normalizes code ignoring case, spaces, and dashes', () => {
    const formatted = 'K7M4-9XPT-2WQN-BH5R-3JVD-6YFA';
    const spaced = 'k7m4 9xpt 2wqn bh5r 3jvd 6yfa';
    const raw = 'k7m49xpt2wqnbh5r3jvd6yfa';
    const emDashed = 'K7M4—9XPT—2WQN—BH5R—3JVD—6YFA';

    const normalized = normalizeRecoveryCode(formatted);
    expect(normalized).toBe('K7M49XPT2WQNBH5R3JVD6YFA');
    expect(normalizeRecoveryCode(spaced)).toBe(normalized);
    expect(normalizeRecoveryCode(raw)).toBe(normalized);
    expect(normalizeRecoveryCode(emDashed)).toBe(normalized);
  });

  it('formats normalized code back to 6 groups of 4', () => {
    const raw = 'K7M49XPT2WQNBH5R3JVD6YFA';
    expect(formatRecoveryCode(raw)).toBe('K7M4-9XPT-2WQN-BH5R-3JVD-6YFA');
  });

  it('wrap and unwrap dataKey roundtrip with cheap iterations in test', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const code = generateRecoveryCode();
    const dataKey = await generateDataKey();

    // Use 1000 iterations for test speed
    const wrapped = await wrapDataKeyWithRecoveryCode(dataKey, code, salt, 1000);
    const unwrapped = await unwrapDataKeyWithRecoveryCode(wrapped, code, salt, 1000);

    const plain = 'Testing recovery code wrapping';
    const cipher = await encryptContent(plain, dataKey);
    const decrypted = await decryptContent(cipher, unwrapped);
    expect(decrypted).toBe(plain);
  });

  it('unwrapping with normalized variants (spaces, lowercase, dashes) succeeds', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const code = 'K7M4-9XPT-2WQN-BH5R-3JVD-6YFA';
    const dataKey = await generateDataKey();

    const wrapped = await wrapDataKeyWithRecoveryCode(dataKey, code, salt, 1000);

    // Try unwrapping with lowercase spaced variant
    const unwrapped = await unwrapDataKeyWithRecoveryCode(
      wrapped,
      'k7m4 9xpt 2wqn bh5r 3jvd 6yfa',
      salt,
      1000,
    );

    const plain = 'Verified recovery with messy input';
    const cipher = await encryptContent(plain, dataKey);
    const decrypted = await decryptContent(cipher, unwrapped);
    expect(decrypted).toBe(plain);
  });

  it('unwrapping with wrong recovery code throws error', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const code1 = 'K7M4-9XPT-2WQN-BH5R-3JVD-6YFA';
    const code2 = 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF';
    const dataKey = await generateDataKey();

    const wrapped = await wrapDataKeyWithRecoveryCode(dataKey, code1, salt, 1000);
    await expect(unwrapDataKeyWithRecoveryCode(wrapped, code2, salt, 1000)).rejects.toThrow();
  });
});
