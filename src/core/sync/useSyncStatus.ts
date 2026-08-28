import { useState, useEffect, useRef } from 'react';
import { useOnlineStatus } from '../../shared/hooks/useOnlineStatus';

import { SyncService } from '../services/SyncService';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';

export type SyncStatus = 'synced' | 'offline' | 'cloud_unavailable' | 'pending' | 'unsynced';

export interface SyncStatusState {
  status: SyncStatus;
  pendingCount: number;
  unsyncedCount: number;
  /** false when user disabled auto-sync — indicator should be hidden */
  autoSyncEnabled: boolean;
}

const PENDING_GRACE_MS = 30_000;

// AUD-25: индикатор задавал вопрос, который никто не ждал, — опрос IndexedDB
// каждые 10 секунд. Теперь слой синка объявляет об изменениях очереди
// (sync-queue-changed) и о сохранении версии (doc-version-saved), а хук
// перечитывает счётчики только на эти события плюс один раз при подписке.
const QUEUE_EVENTS = ['sync-queue-changed', 'doc-version-saved'] as const;

// Shared across all useSyncStatus() instances (Sidebar, BottomNav, AppShell, AppTab
// can all be mounted at once) so they don't each run their own IndexedDB read.
let sharedPendingCount = 0;
let sharedUnsyncedCount = 0;
let activeSubscribers = 0;
let currentSubscribedUserId: string | null = null;
const statusListeners = new Set<(counts: { pending: number; unsynced: number }) => void>();

async function pollSyncStatus(userId: string | null) {
  try {
    const [pending, unsynced] = await Promise.all([
      SyncService.getPendingCount(),
      userId ? SyncService.getUnsyncedCount(userId) : Promise.resolve(0),
    ]);
    sharedPendingCount = pending;
    sharedUnsyncedCount = unsynced;
    statusListeners.forEach(fn => fn({ pending, unsynced }));
  } catch { /* non-critical */ }
}

function subscribeSyncStatus(userId: string | null, listener: (counts: { pending: number; unsynced: number }) => void): () => void {
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
  const [unsyncedCount, setUnsyncedCount] = useState(0);
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
    if (!userId || !autoSyncEnabled) {
      // Defer to avoid synchronous setState in effect body
      const t = setTimeout(() => {
        setPendingCount(0);
        setUnsyncedCount(0);
      }, 0);
      return () => clearTimeout(t);
    }

    const t = setTimeout(() => {
      setPendingCount(sharedPendingCount);
      setUnsyncedCount(sharedUnsyncedCount);
    }, 0);
    const unsubscribe = subscribeSyncStatus(userId, counts => {
      setPendingCount(counts.pending);
      setUnsyncedCount(counts.unsynced);
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
  let status: SyncStatus = 'synced';

  if (!autoSyncEnabled) {
    status = 'synced';
  } else if (!isBrowserOnline) {
    status = 'offline';
  } else if (pendingCount > 0 && showPending) {
    status = 'pending';
  } else if (unsyncedCount > 0) {
    status = 'unsynced';
  }

  return { status, pendingCount, unsyncedCount, autoSyncEnabled };
}
