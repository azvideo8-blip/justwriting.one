import { create } from 'zustand';
import { reportError } from '../../shared/errors/reportError';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';

const AUTO_LOCK_MS = 15 * 60 * 1000;
// SEC-5: "Remember on this device" maintains convenience (no password on reload)
// but enforces a 1-hour inactivity ceiling so an idle tab does not leave the in-memory
// CryptoKey active forever.
const REMEMBERED_AUTO_LOCK_MS = 60 * 60 * 1000;

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
let rememberDevice = false;

export function setRememberDevice(on: boolean): void {
  rememberDevice = on;
  if (useEncryptionStore.getState().isVaultUnlocked) {
    startAutoLockTimer();
  }
}

export function isRememberDevice(): boolean {
  return rememberDevice;
}

function clearAutoLockTimer() {
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
}

function startAutoLockTimer() {
  clearAutoLockTimer();
  const timeoutMs = rememberDevice ? REMEMBERED_AUTO_LOCK_MS : AUTO_LOCK_MS;
  autoLockTimer = setTimeout(() => {
    useEncryptionStore.getState().lockVault();
  }, timeoutMs);
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

  // AUDIT-M16: mousemove убран — любое движение мыши держало таймер вечным.
  // Активность = реальные действия (клавиши, клики, тапы).
  const activityEvents: (keyof WindowEventMap)[] = ['keydown', 'mousedown', 'touchstart'];
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
      const timeoutMs = rememberDevice ? REMEMBERED_AUTO_LOCK_MS : AUTO_LOCK_MS;
      if (idleMs >= timeoutMs) {
        useEncryptionStore.getState().lockVault();
      }
    }
  };
  document.addEventListener('visibilitychange', visibilityListener);
  registeredListeners.push({ target: document, type: 'visibilitychange', listener: visibilityListener });

  // AUDIT-M16: ключ не должен жить в памяти после закрытия/падения таба.
  const unloadListener = () => {
    if (useEncryptionStore.getState().isVaultUnlocked) {
      useEncryptionStore.getState().lockVault();
    }
  };
  window.addEventListener('pagehide', unloadListener);
  registeredListeners.push({ target: window, type: 'pagehide', listener: unloadListener });
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
    // V-3: reset rememberDevice so User A's "remember" preference doesn't
    // leak to User B on the same browser.
    setRememberDevice(false);
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
