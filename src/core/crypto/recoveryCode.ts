import { deriveMasterKey, wrapDataKey, unwrapDataKey, PBKDF2_ITERATIONS } from './encrypt';

export const CROCKFORD_BASE32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Normalizes a recovery code string:
 * - Converts to uppercase
 * - Strips all spaces, dashes, hyphens, and em-dashes
 */
export function normalizeRecoveryCode(rawCode: string): string {
  if (typeof rawCode !== 'string') return '';
  return rawCode.toUpperCase().replace(/[\s\-_—]/g, '');
}

/**
 * Validates whether a code string represents a valid 24-symbol Crockford Base32 recovery code.
 */
export function isValidRecoveryCode(rawCode: string): boolean {
  const normalized = normalizeRecoveryCode(rawCode);
  if (normalized.length !== 24) return false;
  for (let i = 0; i < normalized.length; i++) {
    if (!CROCKFORD_BASE32_ALPHABET.includes(normalized[i]!)) {
      return false;
    }
  }
  return true;
}

/**
 * Formats a 24-character recovery code into 6 groups of 4 separated by dashes:
 * XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
 */
export function formatRecoveryCode(rawCode: string): string {
  const normalized = normalizeRecoveryCode(rawCode);
  if (normalized.length !== 24) return normalized;
  const groups = normalized.match(/.{1,4}/g);
  return groups ? groups.join('-') : normalized;
}

/**
 * Generates a fresh 120-bit (15 bytes) recovery code formatted into 6 groups of 4 symbols
 * using crypto.getRandomValues and Crockford Base32.
 */
export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  let bits = 0;
  let bitCount = 0;
  let result = '';

  for (let i = 0; i < bytes.length; i++) {
    bits = (bits << 8) | bytes[i]!;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      const index = (bits >>> bitCount) & 31;
      result += CROCKFORD_BASE32_ALPHABET[index]!;
    }
  }

  return formatRecoveryCode(result);
}

/**
 * Derives an AES-KW CryptoKey from the normalized recovery code and salt.
 * Uses the exact same PBKDF2 parameters as the master password key.
 */
export async function deriveRecoveryMasterKey(
  recoveryCode: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const normalized = normalizeRecoveryCode(recoveryCode);
  return deriveMasterKey(normalized, salt, iterations);
}

/**
 * Wraps a data key using a master key derived from the recovery code and salt.
 */
export async function wrapDataKeyWithRecoveryCode(
  dataKey: CryptoKey,
  recoveryCode: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  const recoveryMasterKey = await deriveRecoveryMasterKey(recoveryCode, salt, iterations);
  return wrapDataKey(dataKey, recoveryMasterKey);
}

/**
 * Unwraps a data key using a master key derived from the recovery code and salt.
 */
export async function unwrapDataKeyWithRecoveryCode(
  wrappedKey: string,
  recoveryCode: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const recoveryMasterKey = await deriveRecoveryMasterKey(recoveryCode, salt, iterations);
  return unwrapDataKey(wrappedKey, recoveryMasterKey);
}
