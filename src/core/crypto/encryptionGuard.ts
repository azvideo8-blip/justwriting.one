// Centralized encryption invariant: never write unencrypted content to cloud
// when the user has encryption configured and the vault is locked.
//
// This guard is the single enforcement point. All cloud write paths for note
// content MUST go through this function. C-ENC-1 happened because the check
// was scattered across maybeEncrypt, EncryptionService.lockVault, and
// cryptoHelpers — a local change in one place silently bypassed the others.

import { getSessionKey } from '../crypto/encrypt';

export class EncryptionGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionGuardError';
  }
}

// Assert that a cloud write is safe: if encryption is enabled (user has a dataKey
// configured), the session key must be present (vault unlocked).
// Call this BEFORE any cloud write of user content.
export function assertCloudWriteSafe(encryptionEnabled: boolean): void {
  if (encryptionEnabled && !getSessionKey()) {
    throw new EncryptionGuardError('ENCRYPT_REQUIRED: session key not available — vault is locked');
  }
}

// Runtime assertion for dev/test — throws in dev, warns in prod.
export function debugAssertCloudWriteSafe(encryptionEnabled: boolean, context: string): void {
  if (encryptionEnabled && !getSessionKey()) {
    if (import.meta.env?.DEV || process.env.NODE_ENV === 'test') {
      throw new EncryptionGuardError(`DEV ASSERT: cloud write while vault locked in ${context}`);
    } else {
      console.error(`[EncryptionGuard] cloud write while vault locked in ${context}`);
    }
  }
}
