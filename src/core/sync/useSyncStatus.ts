import { useState, useEffect, useRef } from 'react';
import { useOnlineStatus } from '../../shared/hooks/useOnlineStatus';

import { SyncService } from '../services/SyncService';
import { getLocalStoreSyncSummary } from '../services/LocalStoreSyncService';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';
import { cloudSyncEnabled, CLOUD_SYNC_CHANGED } from './cloudSyncEnabled';
import { isAccountReloadPending } from '../auth/accountReload';

export type SyncStatus =
  | 'synced'
  | 'offline'
  | 'cloud_unavailable'
  | 'pending'
  | 'unsynced'
  /** Автосинхронизация выключена, и в облаке всё же всё есть. Не то же самое,
   *  что «синхронизировано»: новое туда само не поедет. */
  | 'sync_off'
  /** SA-1: заметки в порядке, а производные ИИ (диалоги, разбор, темы) — нет:
   *  они ждут отправки или были отвергнуты облаком. Отдельное состояние,
   *  потому что «не синхронизировано заметок» про них врёт в обе стороны. */
  | 'ai_store_unsynced';

export interface SyncStatusState {
  status: SyncStatus;
  pendingCount: number;
  pendingDeletionsCount: number;
  unsyncedCount: number;
  behindCount: number;
  unlinkedCount: number;
  deviceOnlyCount: number;
  hasUnknown: boolean;
  deadCount: number;
  /** SA-1: записи ИИ-сторов, которые ещё не уехали в облако. */
  aiStorePendingCount: number;
  /** SA-1: записи ИИ-сторов, отвергнутые облаком после лимита попыток. */
  aiStoreDeadCount: number;
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
  deadCount: number;
  aiStorePending: number;
  aiStoreDead: number;
}

// Shared across all useSyncStatus() instances (Sidebar, BottomNav, AppShell, AppTab
// can all be mounted at once) so they don't each run their own IndexedDB read.
const EMPTY_COUNTS: SharedCounts = {
  pending: 0,
  pendingDeletions: 0,
  unsynced: 0,
  behind: 0,
  unlinked: 0,
  deviceOnly: 0,
  hasUnknown: false,
  deadCount: 0,
  aiStorePending: 0,
  aiStoreDead: 0,
};

let sharedCounts: SharedCounts = EMPTY_COUNTS;
// R4-006: до первого завершившегося опроса счётчики — нули, и статус «synced»
// был выдумкой, а не замером. Нейтральное состояние честнее.
let sharedCountsLoaded = false;
let activeSubscribers = 0;
let currentSubscribedUserId: string | null = null;
// Чей снимок в sharedCounts: после смены учётки UI показывал чужие счётчики,
// пока не придёт событие очереди (R3-024).
let sharedCountsUserId: string | null | undefined;
const statusListeners = new Set<(counts: SharedCounts) => void>();

async function pollSyncStatus(userId: string | null) {
  try {
    // SA-1: состояние ИИ-сторов читается здесь же — бейдж раньше знал только
    // про заметки, и потерянная облачная копия разбора для него отсутствовала.
    const storeSummary = userId ? getLocalStoreSyncSummary(userId) : null;
    const [pending, pendingDeletions, summary] = await Promise.all([
      // Рядом с соседними вызовами: без userId считается чужая работа этого
      // браузера — задачи другого аккаунта в той же базе (миграция общей
      // легаси-базы, переключение аккаунта) попадали в бейдж текущего.
      SyncService.getPendingCount(userId ?? undefined),
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
                  deadCount: 0,
                }))
              : Promise.resolve(null))
        : Promise.resolve(null),
    ]);
    // Ответ по прежней учётке, пришедший после смены, чужой — не публиковать.
    if (userId !== currentSubscribedUserId) return;
    sharedCountsUserId = userId;
    sharedCounts = {
      pending,
      pendingDeletions,
      unsynced: summary?.unsyncedCount ?? 0,
      behind: summary?.behindCount ?? 0,
      unlinked: summary?.unlinkedCount ?? 0,
      deviceOnly: summary?.deviceOnlyCount ?? 0,
      // Журнал удалений ИИ-сторов не читается — загрузки ИИ стоят, и
      // «синхронизировано» было бы неправдой (R3-011).
      hasUnknown: (summary?.hasUnknown ?? false) || (storeSummary?.unknown ?? false),
      deadCount: summary?.deadCount ?? 0,
      aiStorePending: (storeSummary?.pending ?? 0) + (storeSummary?.oversized ?? 0),
      aiStoreDead: storeSummary?.dead ?? 0,
    };
    sharedCountsLoaded = true;
    statusListeners.forEach(fn => fn(sharedCounts));
  } catch {
    // SA-1: молчание здесь означало «бейдж держит прошлый снимок»: одно
    // неудачное чтение IndexedDB навечно оставляло интерфейс в состоянии
    // «всё синхронизировано». Незнание показывается как незнание.
    sharedCounts = {
      pending: 0,
      pendingDeletions: 0,
      unsynced: 0,
      behind: 0,
      unlinked: 0,
      deviceOnly: 0,
      hasUnknown: true,
      deadCount: 0,
      aiStorePending: 0,
      aiStoreDead: 0,
    };
    // Это тоже замер: незнание показано как hasUnknown — висеть в нейтральном
    // состоянии не нужно.
    sharedCountsLoaded = true;
    statusListeners.forEach(fn => fn(sharedCounts));
  }
}

function subscribeSyncStatus(userId: string | null, listener: (counts: SharedCounts) => void): () => void {
  statusListeners.add(listener);
  activeSubscribers++;
  const userChanged = currentSubscribedUserId !== userId;
  currentSubscribedUserId = userId;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  if (activeSubscribers > 1 && userChanged) void pollSyncStatus(userId);
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

  // Снимок помнит, чей он: после смены учётки прежние счётчики не попадают
  // даже в первый рендер новой — пока нет своих, показываются нули (R3-024).
  const [snap, setSnap] = useState<{ owner: string | null; counts: SharedCounts; loaded: boolean }>({ owner: userId, counts: EMPTY_COUNTS, loaded: sharedCountsLoaded });
  const c = snap.owner === userId ? snap.counts : EMPTY_COUNTS;
  const loaded = snap.owner === userId ? snap.loaded : false;
  const pendingCount = c.pending;
  const pendingDeletionsCount = c.pendingDeletions;
  const unsyncedCount = c.unsynced;
  const behindCount = c.behind;
  const unlinkedCount = c.unlinked;
  const deviceOnlyCount = c.deviceOnly;
  const hasUnknown = c.hasUnknown;
  const deadCount = c.deadCount;
  const aiStorePendingCount = c.aiStorePending;
  const aiStoreDeadCount = c.aiStoreDead;
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(
    () => (userId ? cloudSyncEnabled(userId) : false)
  );
  const [showPending, setShowPending] = useState(false);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPendingRef = useRef(0);

  // Listen for auto_sync_enabled changes (from other tabs)
  useEffect(() => {
    if (!userId) {
      // Defer to avoid synchronous setState in effect body
      const t = setTimeout(() => setAutoSyncEnabled(false), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setAutoSyncEnabled(cloudSyncEnabled(userId)), 0);
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.AUTO_SYNC_ENABLED(userId) || e.key === STORAGE_KEYS.LEGACY_AUTO_SYNC_ENABLED) {
        setAutoSyncEnabled(cloudSyncEnabled(userId));
      }
    };
    const sameTab = () => setAutoSyncEnabled(cloudSyncEnabled(userId));
    window.addEventListener('storage', handler);
    window.addEventListener(CLOUD_SYNC_CHANGED, sameTab);
    return () => {
      clearTimeout(t);
      window.removeEventListener('storage', handler);
      window.removeEventListener(CLOUD_SYNC_CHANGED, sameTab);
    };
  }, [userId]);

  // Subscribe to the shared sync status poll (deduped across hook instances)
  useEffect(() => {
    if (!userId) {
      // Defer to avoid synchronous setState in effect body
      const t = setTimeout(() => setSnap({ owner: null, counts: EMPTY_COUNTS, loaded: false }), 0);
      return () => clearTimeout(t);
    }

    const t = setTimeout(() => {
      if (sharedCountsUserId === userId) setSnap({ owner: userId, counts: sharedCounts, loaded: sharedCountsLoaded });
    }, 0);
    const unsubscribe = subscribeSyncStatus(userId, () => setSnap({ owner: userId, counts: sharedCounts, loaded: sharedCountsLoaded }));
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
      // Вето здесь при смене аккаунта недопустимо: очередь синхронизации уже
      // сохранена в IndexedDB, а отмена перезагрузки оставляет интерфейс старого
      // аккаунта поверх новой сессии (подмена аккаунта во вкладке).
      if (isAccountReloadPending()) return;
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
  // R4-006: пока первый опрос не ответил, ни «synced», ни «unsynced» сказать
  // нельзя — показываем нейтральное «sync_off» (индикатор без обещаний).
  let status: SyncStatus = loaded ? 'synced' : 'sync_off';

  if (!loaded) {
    // no-op: остаёмся в нейтральном состоянии до первого замера
  } else if (!isBrowserOnline) {
    status = 'offline';
  } else if (hasUnknown) {
    status = 'cloud_unavailable';
  } else if (pendingCount > 0 && showPending) {
    status = 'pending';
  } else if (unsyncedCount > 0) {
    status = 'unsynced';
  } else if (aiStorePendingCount + aiStoreDeadCount > 0) {
    status = 'ai_store_unsynced';
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
    deadCount,
    aiStorePendingCount,
    aiStoreDeadCount,
    autoSyncEnabled,
  };
}
