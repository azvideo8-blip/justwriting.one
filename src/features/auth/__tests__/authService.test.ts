import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../core/firebase/auth', () => ({
  auth: { currentUser: null },
}));

vi.mock('firebase/auth', () => ({
  signOut: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() },
  updatePassword: vi.fn(),
  reauthenticateWithCredential: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock('../../../core/crypto/encrypt', () => ({
  unwrapDataKeyWithPassword: vi.fn(),
  setSessionKey: vi.fn(),
  fromBase64: vi.fn((s: string) => s),
  decryptContent: vi.fn(),
}));

vi.mock('../../../core/crypto/cryptoHelpers', () => ({
  setEncryptionEnabled: vi.fn(),
  getEncryptionEnabled: vi.fn(() => false),
}));

vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { AuthService } from '../services/AuthService';

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getCurrentUserId returns null when no user', () => {
    expect(AuthService.getCurrentUserId()).toBeNull();
  });

  it('getCurrentUser returns null when no user', () => {
    expect(AuthService.getCurrentUser()).toBeNull();
  });

  it('unlockVaultFromProfile returns false when no encryptionMeta and no legacy keys', async () => {
    const result = await AuthService.unlockVaultFromProfile({}, 'password', 'user1');
    expect(result).toBe(false);
  });

  it('unlockVaultFromProfile returns false when meta has no salt', async () => {
    const result = await AuthService.unlockVaultFromProfile(
      { encryptionMeta: { wrappedDataKey: 'wrapped' } },
      'password',
      'user1',
    );
    expect(result).toBe(false);
  });

  it('unlockVaultFromProfile returns false when meta has no wrappedDataKey', async () => {
    const result = await AuthService.unlockVaultFromProfile(
      { encryptionMeta: { salt: 'salt' } },
      'password',
      'user1',
    );
    expect(result).toBe(false);
  });
});
