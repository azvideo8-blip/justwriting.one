import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEncryptionStore } from '../useEncryptionStore';

describe('useEncryptionStore', () => {
  beforeEach(() => {
    // Reset Zustand store state before each test
    useEncryptionStore.setState({
      dataKey: null,
      isVaultUnlocked: false,
      encryptionEnabled: {},
      profileLoaded: {},
    });
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('starts with null dataKey and locked vault', () => {
    const state = useEncryptionStore.getState();
    expect(state.dataKey).toBeNull();
    expect(state.isVaultUnlocked).toBe(false);
  });

  it('setKey stores CryptoKey and sets isVaultUnlocked=true', () => {
    const dummyKey = {} as CryptoKey;
    useEncryptionStore.getState().setKey(dummyKey);

    const state = useEncryptionStore.getState();
    expect(state.dataKey).toBe(dummyKey);
    expect(state.isVaultUnlocked).toBe(true);
  });

  it('lockVault clears dataKey and sets isVaultUnlocked=false', () => {
    const dummyKey = {} as CryptoKey;
    useEncryptionStore.getState().setKey(dummyKey);
    useEncryptionStore.getState().lockVault();

    const state = useEncryptionStore.getState();
    expect(state.dataKey).toBeNull();
    expect(state.isVaultUnlocked).toBe(false);
  });

  it('setEncryptionEnabled updates state and writes to localStorage', () => {
    useEncryptionStore.getState().setEncryptionEnabled('user1', true);
    
    expect(useEncryptionStore.getState().encryptionEnabled['user1']).toBe(true);
    expect(localStorage.getItem('enc_enabled_user1')).toBe('1');

    useEncryptionStore.getState().setEncryptionEnabled('user1', false);
    expect(useEncryptionStore.getState().encryptionEnabled['user1']).toBe(false);
    expect(localStorage.getItem('enc_enabled_user1')).toBe('0');
  });

  it('isEncryptionEnabled reads from localStorage cache', () => {
    localStorage.setItem('enc_enabled_user2', '1');
    const enabled = useEncryptionStore.getState().isEncryptionEnabled('user2');

    expect(enabled).toBe(true);
    expect(useEncryptionStore.getState().encryptionEnabled['user2']).toBe(true);
  });

  it('isEncryptionEnabled returns false for guest users', () => {
    expect(useEncryptionStore.getState().isEncryptionEnabled('guest')).toBe(false);
    expect(useEncryptionStore.getState().isEncryptionEnabled('guest_123')).toBe(false);
  });

  it('setProfileLoaded and isProfileLoaded behave correctly', () => {
    expect(useEncryptionStore.getState().isProfileLoaded('guest')).toBe(true);
    expect(useEncryptionStore.getState().isProfileLoaded('user1')).toBe(false);

    useEncryptionStore.getState().setProfileLoaded('user1', true);
    expect(useEncryptionStore.getState().isProfileLoaded('user1')).toBe(true);
  });

  it('handles localStorage read exception by falling back to false (conservative)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });

    const isEnc = useEncryptionStore.getState().isEncryptionEnabled('authenticated_user');
    expect(isEnc).toBe(false);

    const isGuestEnc = useEncryptionStore.getState().isEncryptionEnabled('guest_user');
    expect(isGuestEnc).toBe(false);
  });
});
