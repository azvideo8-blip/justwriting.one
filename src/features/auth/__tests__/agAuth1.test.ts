import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { AuthService } from '../services/AuthService';
import { useEncryptionStore, setRememberDevice, isRememberDevice } from '../../../core/crypto/useEncryptionStore';

vi.mock('../../../core/auth', () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOutUser: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn(),
  getCurrentUser: () => ({ uid: 'user_auth_1' }),
}));

vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

describe('AG-AUTH-1: Leftovers After Sign-out', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('Requirement 1: signOut calls lockVault() which resets rememberDevice to false and clears key', async () => {
    setRememberDevice(true);
    expect(isRememberDevice()).toBe(true);

    const dummyKey = {} as CryptoKey;
    useEncryptionStore.getState().setKey(dummyKey);
    expect(useEncryptionStore.getState().isVaultUnlocked).toBe(true);

    await AuthService.signOut();

    expect(useEncryptionStore.getState().isVaultUnlocked).toBe(false);
    expect(useEncryptionStore.getState().dataKey).toBeNull();
    expect(isRememberDevice()).toBe(false);
  });

  it('Requirement 2: signOut dispatches auth:signed-out event that invalidates note search cache', async () => {
    const eventSpy = vi.fn();
    window.addEventListener('auth:signed-out', eventSpy);

    await AuthService.signOut();

    expect(eventSpy).toHaveBeenCalled();
    window.removeEventListener('auth:signed-out', eventSpy);
  });
});
