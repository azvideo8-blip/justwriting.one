import { create } from 'zustand';
import { reportError } from '../../shared/errors/reportError';
import { registerVaultLockedChecker } from '../../shared/errors/vaultLockState';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';
import { VAULT_UNLOCKED_EVENT } from './vaultEvents';
export { VAULT_UNLOCKED_EVENT };

/**
 * Сейф открылся — об этом объявляется событием, а не вызовом синхронизации.
 *
 * Прямой импорт `SyncService` отсюда заводит цикл: сервис тянет провайдеров
 * данных, те — помощников шифрования, а те — этот стор. Динамический `import()`
 * цикл не разрывает, он лишь прячет его от глаза: во время инициализации
 * модулей одна из сторон всё равно видит другую недособранной. Слушателя вешает
 * `AppProviders`, который синхронизацией уже владеет.
 */


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

  // DEEP-4: Cross-tab vault state observability.
  // Note: Only the status flag (unlocked: true/false) is broadcast. The CryptoKey NEVER leaves tab memory.
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(VAULT_STATE_CHANNEL);
      const onMsg = (event: MessageEvent) => {
        if (event.data?.type === 'VAULT_UNLOCKED') {
          window.dispatchEvent(new CustomEvent(VAULT_UNLOCKED_EVENT));
        }
        // R4-6: ручная блокировка в одной вкладке блокирует и остальные.
        // Обычный VAULT_LOCKED сюда не относится: его шлёт и закрытие вкладки,
        // и авто-блокировка по простою — они не должны гасить соседей.
        if (event.data?.type === VAULT_LOCK_ALL && useEncryptionStore.getState().isVaultUnlocked) {
          useEncryptionStore.getState().lockVault();
        }
      };
      channel.addEventListener('message', onMsg);
      registeredListeners.push({
        target: channel,
        type: 'message',
        listener: onMsg as EventListener,
      });
    } catch { /* ignore */ }
  }
}

export function cleanupEncryptionStoreListeners() {
  for (const item of registeredListeners) {
    if (typeof window !== 'undefined' && item.target !== (window as unknown) && 'close' in item.target && typeof (item.target as { close: () => void }).close === 'function') {
      try { (item.target as { close: () => void }).close(); } catch { /* ignore */ }
    } else {
      item.target.removeEventListener(item.type, item.listener, item.options);
    }
  }
  registeredListeners = [];
  clearAutoLockTimer();
  stopCrossTabHeartbeat();
}

const VAULT_STATE_CHANNEL = 'jw_vault_state';
const VAULT_LOCK_ALL = 'VAULT_LOCK_ALL';

/** R4-6: человек нажал «Заблокировать» — просим закрыть сейф все вкладки. */
export function broadcastManualLock(): void {
  try {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(VAULT_STATE_CHANNEL);
    channel.postMessage({ type: VAULT_LOCK_ALL, timestamp: Date.now() });
    channel.close();
  } catch { /* ignore */ }
}
const VAULT_UNLOCKED_LS_KEY = 'jw_vault_unlocked_time';
let crossTabHeartbeat: ReturnType<typeof setInterval> | null = null;

function broadcastVaultState(unlocked: boolean) {
  if (typeof window === 'undefined') return;
  try {
    if (unlocked) {
      localStorage.setItem(VAULT_UNLOCKED_LS_KEY, String(Date.now()));
    } else {
      localStorage.removeItem(VAULT_UNLOCKED_LS_KEY);
    }
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(VAULT_STATE_CHANNEL);
      channel.postMessage({ type: unlocked ? 'VAULT_UNLOCKED' : 'VAULT_LOCKED', timestamp: Date.now() });
      channel.close();
    }
  } catch { /* ignore */ }
}

function startCrossTabHeartbeat() {
  if (crossTabHeartbeat) clearInterval(crossTabHeartbeat);
  if (typeof window === 'undefined') return;
  crossTabHeartbeat = setInterval(() => {
    try {
      if (useEncryptionStore.getState().isVaultUnlocked) {
        localStorage.setItem(VAULT_UNLOCKED_LS_KEY, String(Date.now()));
      }
    } catch { /* ignore */ }
  }, 10_000);
}

function stopCrossTabHeartbeat() {
  if (crossTabHeartbeat) {
    clearInterval(crossTabHeartbeat);
    crossTabHeartbeat = null;
  }
}

/** DEEP-4: Проверяет, открыт ли сейф в текущей или любой другой вкладке браузера.
 *  Ключ шифрования не передаётся — только статус активности. */
export function isAnyTabVaultUnlocked(): boolean {
  if (useEncryptionStore.getState().isVaultUnlocked) return true;
  try {
    if (typeof localStorage !== 'undefined') {
      const last = localStorage.getItem(VAULT_UNLOCKED_LS_KEY);
      if (last && (Date.now() - Number(last) < 25_000)) {
        return true;
      }
    }
  } catch { /* ignore */ }
  return false;
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
      startCrossTabHeartbeat();
      broadcastVaultState(true);
      window.dispatchEvent(new CustomEvent(VAULT_UNLOCKED_EVENT));
    } else {
      clearAutoLockTimer();
      stopCrossTabHeartbeat();
      broadcastVaultState(false);
    }
  },
  lockVault: () => {
    set({ dataKey: null, isVaultUnlocked: false });
    clearAutoLockTimer();
    stopCrossTabHeartbeat();
    broadcastVaultState(false);
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

registerVaultLockedChecker(() => !useEncryptionStore.getState().isVaultUnlocked);

