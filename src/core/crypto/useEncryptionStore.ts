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
// When the user opted into "remember on this device", auto-lock is disabled —
// they've explicitly chosen convenience over the inactivity lock.
let rememberDevice = false;

export function setRememberDevice(on: boolean): void {
  rememberDevice = on;
  if (on) clearAutoLockTimer();
}

function clearAutoLockTimer() {
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
}

function startAutoLockTimer() {
  if (rememberDevice) return;
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

let registeredListeners: Array<{ target: EventTarget; type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions }> = [];

export function setupEncryptionStoreListeners() {
  if (typeof window === 'undefined') return;

  cleanupEncryptionStoreListeners();

  const activityEvents: (keyof WindowEventMap)[] = ['keydown', 'mousedown', 'touchstart', 'mousemove'];
  let throttleId: ReturnType<typeof setTimeout> | null = null;

  const activityListener = () => {
    if (throttleId) return;
    throttleId = setTimeout(() => {
      throttleId = null;
      resetAutoLockTimer();
    }, 5000);
  };

  for (const evt of activityEvents) {
    window.addEventListener(evt, activityListener, { passive: true });
    registeredListeners.push({ target: window, type: evt, listener: activityListener, options: { passive: true } });
  }

  const visibilityListener = () => {
    if (document.hidden && useEncryptionStore.getState().isVaultUnlocked) {
      const idleMs = Date.now() - lastActivity;
      if (idleMs >= AUTO_LOCK_MS) {
        useEncryptionStore.getState().lockVault();
      }
    }
  };
  document.addEventListener('visibilitychange', visibilityListener);
  registeredListeners.push({ target: document, type: 'visibilitychange', listener: visibilityListener });
}

export function cleanupEncryptionStoreListeners() {
  for (const item of registeredListeners) {
    item.target.removeEventListener(item.type, item.listener, item.options);
  }
  registeredListeners = [];
  clearAutoLockTimer();
}

if (typeof window !== 'undefined') {
  setupEncryptionStoreListeners();
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
