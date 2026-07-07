import { useState, useEffect, useRef } from 'react';
import { useOnlineStatus } from '../../../shared/hooks/useOnlineStatus';
import { onConnectionChange, isFirestoreConnected } from '../../../core/firebase/firestore';
import { SyncService } from '../../../core/services/SyncService';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

export type SyncStatus = 'synced' | 'offline' | 'cloud_unavailable' | 'pending';

export interface SyncStatusState {
  status: SyncStatus;
  pendingCount: number;
  /** false when user disabled auto-sync — indicator should be hidden */
  autoSyncEnabled: boolean;
}

const PENDING_GRACE_MS = 30_000;
const POLL_INTERVAL_MS = 10_000;

// Shared across all useSyncStatus() instances (Sidebar, BottomNav, AppShell, AppTab
// can all be mounted at once) so they don't each run their own IndexedDB poll.
let sharedPendingCount = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let activeSubscribers = 0;
const pendingListeners = new Set<(count: number) => void>();

async function pollPendingCount() {
  try {
    sharedPendingCount = await SyncService.getPendingCount();
    pendingListeners.forEach(fn => fn(sharedPendingCount));
  } catch { /* non-critical */ }
}

function subscribePendingCount(listener: (count: number) => void): () => void {
  pendingListeners.add(listener);
  activeSubscribers++;
  if (!pollTimer) {
    void pollPendingCount();
    pollTimer = setInterval(() => void pollPendingCount(), POLL_INTERVAL_MS);
  }
  return () => {
    pendingListeners.delete(listener);
    activeSubscribers--;
    if (activeSubscribers === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}

/**
 * Global sync health. Show indicator only when autoSyncEnabled && status !== 'synced'.
 */
export function useSyncStatus(userId: string | null): SyncStatusState {
  const isBrowserOnline = useOnlineStatus();
  const [firestoreUp, setFirestoreUp] = useState(isFirestoreConnected);
  const [pendingCount, setPendingCount] = useState(0);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(
    () => localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED) !== 'false'
  );
  const [showPending, setShowPending] = useState(false);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPendingRef = useRef(0);

  // Listen for Firestore connection changes
  useEffect(() => {
    return onConnectionChange((connected) => {
      setFirestoreUp(connected);
    });
  }, []);

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

  // Subscribe to the shared pending-count poll (deduped across hook instances)
  useEffect(() => {
    if (!userId || !autoSyncEnabled) {
      // Defer to avoid synchronous setState in effect body
      const t = setTimeout(() => setPendingCount(0), 0);
      return () => clearTimeout(t);
    }

    const t = setTimeout(() => setPendingCount(sharedPendingCount), 0);
    const unsubscribe = subscribePendingCount(setPendingCount);
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
  } else if (!firestoreUp) {
    status = 'cloud_unavailable';
  } else if (pendingCount > 0 && showPending) {
    status = 'pending';
  }

  return { status, pendingCount, autoSyncEnabled };
}
