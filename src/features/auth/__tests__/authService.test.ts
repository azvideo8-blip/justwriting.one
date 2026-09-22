import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSignIn = vi.fn();
const mockSignUp = vi.fn();
const mockReauthenticate = vi.fn();
const mockGetCurrentUser = vi.fn();

vi.mock('../../../core/auth', () => ({
  getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
  signIn: (...args: unknown[]) => mockSignIn(...args),
  signUp: (...args: unknown[]) => mockSignUp(...args),
  reauthenticate: (...args: unknown[]) => mockReauthenticate(...args),
  signOutUser: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  updateUserPassword: vi.fn(),
}));

const mockCallAi = vi.fn();
vi.mock('../../../core/ai/callAi', () => ({
  callAi: (...args: unknown[]) => mockCallAi(...args),
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
    mockGetCurrentUser.mockReturnValue(null);
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
    expect(mockInitializeEncryption).toHaveBeenCalledWith('new_user_1', 'password123', undefined, true);
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

  // AUD-20: живая сессия не должна уметь стирать архив — нужен пароль снова.
  describe('deleteAccount re-authentication (AUD-20)', () => {
    const user = { uid: 'u1', email: 'u1@example.com' };

    it('refuses to delete with an empty password', async () => {
      mockGetCurrentUser.mockReturnValue(user);
      await expect(AuthService.deleteAccount('')).rejects.toThrow('Password required');
      expect(mockCallAi).not.toHaveBeenCalled();
    });

    it('deletes nothing when the password is wrong', async () => {
      mockGetCurrentUser.mockReturnValue(user);
      mockReauthenticate.mockRejectedValue(new Error('REAUTH_FAILED'));
      await expect(AuthService.deleteAccount('wrong')).rejects.toThrow('REAUTH_FAILED');
      expect(mockReauthenticate).toHaveBeenCalledWith('u1@example.com', 'wrong');
      expect(mockCallAi).not.toHaveBeenCalled();
    });

    it('calls the endpoint only after successful re-authentication', async () => {
      mockGetCurrentUser.mockReturnValue(user);
      mockReauthenticate.mockResolvedValue(undefined);
      mockCallAi.mockResolvedValue({ success: true });
      await AuthService.deleteAccount('correct');
      expect(mockReauthenticate).toHaveBeenCalledWith('u1@example.com', 'correct');
      expect(mockCallAi).toHaveBeenCalledWith('deleteAccount', {});
    });
  });
});
