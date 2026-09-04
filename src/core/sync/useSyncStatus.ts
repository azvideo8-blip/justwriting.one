import { useState, useEffect, useRef } from 'react';
import { useOnlineStatus } from '../../shared/hooks/useOnlineStatus';

import { SyncService } from '../services/SyncService';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';

export type SyncStatus =
  | 'synced'
  | 'offline'
  | 'cloud_unavailable'
  | 'pending'
  | 'unsynced'
  /** Автосинхронизация выключена, и в облаке всё же всё есть. Не то же самое,
   *  что «синхронизировано»: новое туда само не поедет. */
  | 'sync_off';

export interface SyncStatusState {
  status: SyncStatus;
  pendingCount: number;
  pendingDeletionsCount: number;
  unsyncedCount: number;
  behindCount: number;
  unlinkedCount: number;
  deviceOnlyCount: number;
  hasUnknown: boolean;
  /** false when user disabled auto-sync — indicator should be hidden */
  autoSyncEnabled: boolean;
}

const PENDING_GRACE_MS = 30_000;

// AUD-25: индикатор задавал вопрос, который никто не ждал, — опрос IndexedDB
// каждые 10 секунд. Теперь слой синка объявляет об изменениях очереди
// (sync-queue-changed) и о сохранении версии (doc-version-saved), а хук
// перечитывает счётчики только на эти события плюс один раз при подписке.
const QUEUE_EVENTS = ['sync-queue-changed', 'doc-version-saved'] as const;

export interface SharedCounts {
  pending: number;
  pendingDeletions: number;
  unsynced: number;
  behind: number;
  unlinked: number;
  deviceOnly: number;
  hasUnknown: boolean;
}

// Shared across all useSyncStatus() instances (Sidebar, BottomNav, AppShell, AppTab
// can all be mounted at once) so they don't each run their own IndexedDB read.
let sharedCounts: SharedCounts = {
  pending: 0,
  pendingDeletions: 0,
  unsynced: 0,
  behind: 0,
  unlinked: 0,
  deviceOnly: 0,
  hasUnknown: false,
};
let activeSubscribers = 0;
let currentSubscribedUserId: string | null = null;
const statusListeners = new Set<(counts: SharedCounts) => void>();

async function pollSyncStatus(userId: string | null) {
  try {
    const [pending, pendingDeletions, summary] = await Promise.all([
      SyncService.getPendingCount(),
      typeof SyncService.getPendingDeletionsCount === 'function'
        ? SyncService.getPendingDeletionsCount(userId ?? undefined)
        : Promise.resolve(0),
      userId !== null
        ? (typeof SyncService.getUnsyncedSummary === 'function'
            ? SyncService.getUnsyncedSummary(userId)
            : typeof (SyncService as unknown as { getUnsyncedCount?: (uid: string) => Promise<number> }).getUnsyncedCount === 'function'
              ? (SyncService as unknown as { getUnsyncedCount: (uid: string) => Promise<number> }).getUnsyncedCount(userId).then(c => ({
                  unsyncedCount: c,
                  behindCount: 0,
                  unlinkedCount: c,
                  deviceOnlyCount: 0,
                  hasUnknown: false,
                }))
              : Promise.resolve(null))
        : Promise.resolve(null),
    ]);
    sharedCounts = {
      pending,
      pendingDeletions,
      unsynced: summary?.unsyncedCount ?? 0,
      behind: summary?.behindCount ?? 0,
      unlinked: summary?.unlinkedCount ?? 0,
      deviceOnly: summary?.deviceOnlyCount ?? 0,
      hasUnknown: summary?.hasUnknown ?? false,
    };
    statusListeners.forEach(fn => fn(sharedCounts));
  } catch { /* non-critical */ }
}

function subscribeSyncStatus(userId: string | null, listener: (counts: SharedCounts) => void): () => void {
  statusListeners.add(listener);
  activeSubscribers++;
  currentSubscribedUserId = userId;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  if (activeSubscribers === 1) {
    void pollSyncStatus(userId);
    const onQueueEvent = () => {
      // Дебаунс: пачка событий (документ + версии) — один перечёт.
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = setTimeout(() => void pollSyncStatus(currentSubscribedUserId), 500);
    };
    QUEUE_EVENTS.forEach(evt => window.addEventListener(evt, onQueueEvent));
    subscribeSyncStatusCleanup = () => {
      QUEUE_EVENTS.forEach(evt => window.removeEventListener(evt, onQueueEvent));
      if (pollTimer) clearTimeout(pollTimer);
    };
  }
  return () => {
    statusListeners.delete(listener);
    activeSubscribers--;
    if (activeSubscribers === 0) {
      subscribeSyncStatusCleanup?.();
      subscribeSyncStatusCleanup = null;
      currentSubscribedUserId = null;
    }
  };
}

let subscribeSyncStatusCleanup: (() => void) | null = null;

/**
 * Global sync health. Show indicator only when autoSyncEnabled && status !== 'synced'.
 */
export function useSyncStatus(userId: string | null): SyncStatusState {
  const isBrowserOnline = useOnlineStatus();

  const [pendingCount, setPendingCount] = useState(0);
  const [pendingDeletionsCount, setPendingDeletionsCount] = useState(0);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [behindCount, setBehindCount] = useState(0);
  const [unlinkedCount, setUnlinkedCount] = useState(0);
  const [deviceOnlyCount, setDeviceOnlyCount] = useState(0);
  const [hasUnknown, setHasUnknown] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(
    () => localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED) === 'true'
  );
  const [showPending, setShowPending] = useState(false);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPendingRef = useRef(0);

  // Listen for auto_sync_enabled changes (from other tabs)
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.AUTO_SYNC_ENABLED) {
        setAutoSyncEnabled(e.newValue !== 'false');
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  // Subscribe to the shared sync status poll (deduped across hook instances)
  useEffect(() => {
    if (!userId) {
      // Defer to avoid synchronous setState in effect body
      const t = setTimeout(() => {
        setPendingCount(0);
        setPendingDeletionsCount(0);
        setUnsyncedCount(0);
        setBehindCount(0);
        setUnlinkedCount(0);
        setDeviceOnlyCount(0);
        setHasUnknown(false);
      }, 0);
      return () => clearTimeout(t);
    }

    const t = setTimeout(() => {
      setPendingCount(sharedCounts.pending);
      setPendingDeletionsCount(sharedCounts.pendingDeletions);
      setUnsyncedCount(sharedCounts.unsynced);
      setBehindCount(sharedCounts.behind);
      setUnlinkedCount(sharedCounts.unlinked);
      setDeviceOnlyCount(sharedCounts.deviceOnly);
      setHasUnknown(sharedCounts.hasUnknown);
    }, 0);
    const unsubscribe = subscribeSyncStatus(userId, c => {
      setPendingCount(c.pending);
      setPendingDeletionsCount(c.pendingDeletions);
      setUnsyncedCount(c.unsynced);
      setBehindCount(c.behind);
      setUnlinkedCount(c.unlinked);
      setDeviceOnlyCount(c.deviceOnly);
      setHasUnknown(c.hasUnknown);
    });
    return () => { clearTimeout(t); unsubscribe(); };
  }, [userId, autoSyncEnabled]);

  // Grace period: start timer when pending count transitions 0→N
  useEffect(() => {
    const prev = prevPendingRef.current;
    prevPendingRef.current = pendingCount;

    if (pendingCount > 0 && prev === 0 && !graceTimerRef.current) {
      graceTimerRef.current = setTimeout(() => {
        setShowPending(true);
        graceTimerRef.current = null;
      }, PENDING_GRACE_MS);
    } else if (pendingCount === 0 && prev > 0) {
      // Queue the reset inside a timeout to avoid synchronous setState in effect body
      setTimeout(() => setShowPending(false), 0);
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }
    }
  }, [pendingCount]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    };
  }, []);

  // IMPR-1: Warning when leaving tab with unsaved/un-synced changes
  useEffect(() => {
    if (!userId || !autoSyncEnabled || pendingCount === 0) {
      return;
    }

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [userId, autoSyncEnabled, pendingCount]);

  // Determine status (pure render logic)
  //
  // «Синхронизировано» говорится ТОЛЬКО когда в облаке действительно всё.
  // Раньше выключенная автосинхронизация давала этот ответ сразу, не глядя на
  // данные, — а выключена она по умолчанию. То есть приложение сообщало
  // «все данные синхронизированы» человеку, у которого четырнадцать заметок
  // лежали в одном браузере. «Мы не проверяем» — не то же самое, что «всё
  // хорошо», и путать их нельзя нигде.
  let status: SyncStatus = 'synced';

  if (!isBrowserOnline) {
    status = 'offline';
  } else if (hasUnknown) {
    status = 'cloud_unavailable';
  } else if (pendingCount > 0 && showPending) {
    status = 'pending';
  } else if (unsyncedCount > 0) {
    status = 'unsynced';
  } else if (!autoSyncEnabled) {
    status = 'sync_off';
  }

  return {
    status,
    pendingCount,
    pendingDeletionsCount,
    unsyncedCount,
    behindCount,
    unlinkedCount,
    deviceOnlyCount,
    hasUnknown,
    autoSyncEnabled,
  };
}
