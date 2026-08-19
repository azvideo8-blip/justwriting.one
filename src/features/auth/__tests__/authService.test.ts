import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSignIn = vi.fn();
const mockSignUp = vi.fn();

vi.mock('../../../core/auth', () => ({
  getCurrentUser: vi.fn(() => null),
  signIn: (...args: unknown[]) => mockSignIn(...args),
  signUp: (...args: unknown[]) => mockSignUp(...args),
  signOutUser: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  updateUserPassword: vi.fn(),
}));

const mockGetProfile = vi.fn();
vi.mock('../../../core/data', () => ({
  DataProvider: {
    getProfile: (...args: unknown[]) => mockGetProfile(...args),
    updateProfile: vi.fn(),
  },
}));

const mockInitializeEncryption = vi.fn();
const mockRecoverVaultWithCode = vi.fn();
vi.mock('../../../core/services/EncryptionService', () => ({
  initializeEncryption: (...args: unknown[]) => mockInitializeEncryption(...args),
  recoverVaultWithCode: (...args: unknown[]) => mockRecoverVaultWithCode(...args),
  WrongPasswordError: class WrongPasswordError extends Error {},
  WrongRecoveryCodeError: class WrongRecoveryCodeError extends Error {},
}));

vi.mock('../../../core/crypto/encrypt', () => ({
  unwrapDataKeyWithPassword: vi.fn().mockResolvedValue({ dataKey: 'mock-key' }),
  setSessionKey: vi.fn(),
  fromBase64: vi.fn((s: string) => s),
  decryptContent: vi.fn().mockResolvedValue('justwriting-verify-v1'),
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

  it('signInWithEmail auto-initializes encryption vault when user has no vault', async () => {
    const mockUser = { uid: 'new_user_1', email: 'test@example.com' };
    mockSignIn.mockResolvedValue(mockUser);
    mockGetProfile.mockResolvedValue(null);
    mockInitializeEncryption.mockResolvedValue({ recoveryCode: 'K7M4-9XPT-2WQN-BH5R-3JVD-6YFA' });

    const result = await AuthService.signInWithEmail('test@example.com', 'password123');
    expect(result.user).toEqual(mockUser);
    expect(result.recoveryCode).toBe('K7M4-9XPT-2WQN-BH5R-3JVD-6YFA');
    expect(mockInitializeEncryption).toHaveBeenCalledWith('new_user_1', 'password123');
  });

  it('signInWithEmail unlocks existing vault and does not re-initialize', async () => {
    const mockUser = { uid: 'existing_user_1', email: 'exist@example.com' };
    mockSignIn.mockResolvedValue(mockUser);
    mockGetProfile.mockResolvedValue({
      uid: 'existing_user_1',
      encryptionMeta: { salt: 'salt', wrappedDataKey: 'wrapped', version: 2 },
    });

    const result = await AuthService.signInWithEmail('exist@example.com', 'password123');
    expect(result.user).toEqual(mockUser);
    expect(result.recoveryCode).toBeUndefined();
    expect(mockInitializeEncryption).not.toHaveBeenCalled();
  });

  it('recoverVault delegates to EncryptionService.recoverVaultWithCode', async () => {
    mockRecoverVaultWithCode.mockResolvedValue(undefined);
    await AuthService.recoverVault('user_123', 'K7M4-9XPT-2WQN-BH5R-3JVD-6YFA', 'newPass123');
    expect(mockRecoverVaultWithCode).toHaveBeenCalledWith('user_123', 'K7M4-9XPT-2WQN-BH5R-3JVD-6YFA', 'newPass123');
  });
});
