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

  // Poll pending count
  useEffect(() => {
    if (!userId || !autoSyncEnabled) {
      // Defer to avoid synchronous setState in effect body
      const t = setTimeout(() => setPendingCount(0), 0);
      return () => clearTimeout(t);
    }

    let alive = true;
    const poll = async () => {
      try {
        const count = await SyncService.getPendingCount();
        if (alive) setPendingCount(count);
      } catch { /* non-critical */ }
    };

    void poll();
    const interval = setInterval(() => void poll(), 10_000);
    return () => { alive = false; clearInterval(interval); };
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
