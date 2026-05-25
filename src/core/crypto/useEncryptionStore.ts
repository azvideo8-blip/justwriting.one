import { create } from 'zustand';
import { reportError } from '../errors/reportError';
import { STORAGE_KEYS } from '../constants/storageKeys';

interface EncryptionState {
  dataKey: CryptoKey | null;
  isVaultUnlocked: boolean;
  encryptionEnabled: Record<string, boolean>;
  profileLoaded: Record<string, boolean>;
  setKey: (key: CryptoKey | null) => void;
  lockVault: () => void;
  setEncryptionEnabled: (userId: string, enabled: boolean) => void;
  isEncryptionEnabled: (userId: string) => boolean;
  setProfileLoaded: (userId: string, loaded: boolean) => void;
  isProfileLoaded: (userId: string) => boolean;
}

export const useEncryptionStore = create<EncryptionState>((set, get) => ({
  dataKey: null,
  isVaultUnlocked: false,
  encryptionEnabled: {},
  profileLoaded: {},

  setKey: (key) => set({ dataKey: key, isVaultUnlocked: !!key }),
  lockVault: () => set({ dataKey: null, isVaultUnlocked: false }),

  setEncryptionEnabled: (userId, enabled) => {
    if (!userId) return;
    set(state => ({ encryptionEnabled: { ...state.encryptionEnabled, [userId]: enabled } }));
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.ENC_ENABLED(userId), enabled ? '1' : '0');
      }
    } catch (e) {
      console.error('[useEncryptionStore] localStorage write failed', e);
    }
  },

  isEncryptionEnabled: (userId) => {
    if (!userId) return false;
    if (userId.startsWith('guest_') || userId === 'guest') return false;
    const state = get();
    if (state.encryptionEnabled[userId] !== undefined) return state.encryptionEnabled[userId];
    try {
      if (typeof localStorage !== 'undefined') {
        const val = localStorage.getItem(STORAGE_KEYS.ENC_ENABLED(userId));
        if (val !== null) {
          const enabled = val === '1';
          set(state => ({ encryptionEnabled: { ...state.encryptionEnabled, [userId]: enabled } }));
          return enabled;
        }
      }
    } catch (e) {
      reportError(e, { action: 'isEncryptionEnabled_read', userId }, 'warning');
      return !userId.startsWith('guest_') && userId !== 'guest';
    }
    return false;
  },

  setProfileLoaded: (userId, loaded) => {
    if (!userId) return;
    set(state => ({ profileLoaded: { ...state.profileLoaded, [userId]: loaded } }));
  },

  isProfileLoaded: (userId) => {
    if (!userId) return true;
    if (userId.startsWith('guest_') || userId === 'guest') return true;
    return get().profileLoaded[userId] ?? false;
  },
}));
