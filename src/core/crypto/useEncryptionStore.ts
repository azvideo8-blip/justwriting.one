import { create } from 'zustand';
import { reportError } from '../../shared/errors/reportError';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';

const AUTO_LOCK_MS = 15 * 60 * 1000;

interface EncryptionState {
  dataKey: CryptoKey | null;
  isVaultUnlocked: boolean;
  encryptionEnabled: Record<string, boolean>;
  profileLoaded: Record<string, boolean>;
  setKey: (key: CryptoKey | null) => void;
  lockVault: () => void;
  setEncryptionEnabled: (userId: string, enabled: boolean) => void;
  getEncryptionEnabled: (userId: string) => boolean;
  setProfileLoaded: (userId: string, loaded: boolean) => void;
  isProfileLoaded: (userId: string) => boolean;
}

let autoLockTimer: ReturnType<typeof setTimeout> | null = null;
let lastActivity = Date.now();

function clearAutoLockTimer() {
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
}

function startAutoLockTimer() {
  clearAutoLockTimer();
  autoLockTimer = setTimeout(() => {
    useEncryptionStore.getState().lockVault();
  }, AUTO_LOCK_MS);
}

function resetAutoLockTimer() {
  lastActivity = Date.now();
  if (useEncryptionStore.getState().isVaultUnlocked) {
    startAutoLockTimer();
  }
}

if (typeof window !== 'undefined') {
  const activityEvents: (keyof WindowEventMap)[] = ['keydown', 'mousedown', 'touchstart', 'mousemove'];
  let throttleId: ReturnType<typeof setTimeout> | null = null;
  for (const evt of activityEvents) {
    window.addEventListener(evt, () => {
      if (throttleId) return;
      throttleId = setTimeout(() => {
        throttleId = null;
        resetAutoLockTimer();
      }, 5000);
    }, { passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && useEncryptionStore.getState().isVaultUnlocked) {
      const idleMs = Date.now() - lastActivity;
      if (idleMs >= AUTO_LOCK_MS) {
        useEncryptionStore.getState().lockVault();
      }
    }
  });
}

export const useEncryptionStore = create<EncryptionState>((set, get) => ({
  dataKey: null,
  isVaultUnlocked: false,
  encryptionEnabled: {},
  profileLoaded: {},

  setKey: (key) => {
    set({ dataKey: key, isVaultUnlocked: !!key });
    if (key) {
      lastActivity = Date.now();
      startAutoLockTimer();
    } else {
      clearAutoLockTimer();
    }
  },
  lockVault: () => {
    set({ dataKey: null, isVaultUnlocked: false });
    clearAutoLockTimer();
  },

  setEncryptionEnabled: (userId, enabled) => {
    if (!userId) return;
    set(state => ({ encryptionEnabled: { ...state.encryptionEnabled, [userId]: enabled } }));
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.ENC_ENABLED(userId), enabled ? '1' : '0');
      }
    } catch (e) {
      reportError(e, { action: 'setEncryptionEnabled_write' });
    }
  },

  getEncryptionEnabled: (userId) => {
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
      reportError(e, { action: 'getEncryptionEnabled_read', userId }, 'warning');
      return false;
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
