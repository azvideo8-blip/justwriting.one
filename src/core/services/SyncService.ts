import { getLocalDb } from '../storage/localDb';
import { logger } from '../../shared/errors/logger';
import { reportError } from '../../shared/errors/reportError';
import { StorageService } from './StorageService';
import { LocalDocumentService } from './LocalDocumentService';
import { DocumentService } from './DocumentService';
import { CloudSyncService, CLOUD_COPY_LOCAL_ONLY, CLOUD_COPY_TOMBSTONE } from './CloudSyncService';
import { cloudSyncEnabled } from '../sync/cloudSyncEnabled';
import { syncStatusOf } from '../sync/syncStatus';
import { isPoisonSyncError, isRevivableOnUnlock } from '../sync/classifySyncError';
import { syncStreakFreezesWithCloud } from '../utils/streakFreeze';
import { announceQueueChange, addToSyncQueue } from './syncQueueOps';
import pLimit from 'p-limit';

const _syncInProgress = new Map<string, boolean>();
const limit = pLimit(5);

// AUDIT-H4 / FU-2: ядовитые ошибки (isPoisonSyncError: DECRYPTION_ERROR, LOCKED,
// Invalid sessionStartedAt, ENCRYPT_REQUIRED) не исправятся простыми ретраями — задача уходит в карантин
// сразу; остальным (включая SYNC_UNRESOLVED) даём MAX_ATTEMPTS проходов, потом тоже карантин.
// DEEP-4: LOCKED/ENCRYPT_REQUIRED/SYNC_UNRESOLVED детерминированы или ждут ключа;
// broadcast-канал vault оживляет задачи (isRevivableOnUnlock), когда сейф открыт.
const MAX_ATTEMPTS = 10;

// EA-12: чтение и запись счётчика — в одной readwrite-транзакции. Раньше это
// были две разные: два параллельных сбоя видели одно n и оба писали n+1
// (карантин откладывался), а задача, удалённая другой вкладкой, записывалась обратно.
async function bumpAttempts(taskId: string, reason: unknown): Promise<void> {
  const db = await getLocalDb();
  const tx = db.transaction('syncQueue', 'readwrite');
  const item = await tx.store.get(taskId);
  if (!item || item.dead) {
    await tx.done;
    return;
  }
  const attempts = (item.attempts ?? 0) + 1;
  const reasonStr = String(reason);
  const dead = isPoisonSyncError(reason) || attempts >= MAX_ATTEMPTS;
  await tx.store.put({ ...item, attempts, dead, lastError: reasonStr });
  await tx.done;
  if (dead) {
    reportError(new Error('Sync task quarantined'), { taskId, attempts, reason: reasonStr }, 'warning');
    announceQueueChange();
  }
}

export interface SyncUnsyncedSummary {
  unsyncedCount: number;
  behindCount: number;
  unlinkedCount: number;
  deviceOnlyCount: number;
  hasUnknown: boolean;
  deadCount?: number;
}

export interface SyncPendingResult {
  drained: number;
  failed: number;
  skippedReason?: 'sync_disabled' | 'in_progress' | undefined;
}

export const SyncService = {
  addToQueue: addToSyncQueue,

  async removeQueueTasksForDocument(documentId: string): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('syncQueue', 'readwrite');
    const all = await tx.store.getAll();
    const matching = all.filter(t => (t.documentId === documentId || t.id === `sync_${documentId}`) && !t.id.startsWith('lock_cloud_'));
    for (const item of matching) {
      await tx.store.delete(item.id);
    }
    await tx.done;
    if (matching.length > 0) announceQueueChange();
  },

  async reviveLockedTasks(userId?: string): Promise<number> {
    const db = await getLocalDb();
    const queue = await db.getAll('syncQueue');
    const toRevive = queue.filter(item =>
      Boolean(item.dead) &&
      isRevivableOnUnlock(item.lastError) &&
      (userId ? item.ownerId === undefined || item.ownerId === userId : true)
    );
    if (toRevive.length === 0) return 0;
    const tx = db.transaction('syncQueue', 'readwrite');
    for (const item of toRevive) {
      await tx.store.put({ ...item, dead: false, attempts: 0 });
    }
    await tx.done;
    announceQueueChange();
    return toRevive.length;
  },

  async retryQuarantinedTasks(userId?: string): Promise<number> {
    const db = await getLocalDb();
    const queue = await db.getAll('syncQueue');
    const toRevive = queue.filter(item =>
      Boolean(item.dead) &&
      (userId ? item.ownerId === undefined || item.ownerId === userId : true)
    );
    if (toRevive.length === 0) return 0;
    const tx = db.transaction('syncQueue', 'readwrite');
    for (const item of toRevive) {
      await tx.store.put({ ...item, dead: false, attempts: 0 });
    }
    await tx.done;
    announceQueueChange();
    return toRevive.length;
  },

  async getPendingCount(userId?: string): Promise<number> {
    const db = await getLocalDb();
    const all = await db.getAll('syncQueue');
    return all.filter(i =>
      !i.id.startsWith('lock_cloud_') &&
      !i.dead &&
      (userId ? (i.ownerId === undefined || i.ownerId === userId) : true)
    ).length;
  },

  async getDeadCount(userId?: string): Promise<number> {
    const db = await getLocalDb();
    const all = await db.getAll('syncQueue');
    return all.filter(i =>
      !i.id.startsWith('lock_cloud_') &&
      Boolean(i.dead) &&
      (userId ? (i.ownerId === undefined || i.ownerId === userId) : true)
    ).length;
  },

  async getPendingDeletionsCount(userId?: string): Promise<number> {
    const db = await getLocalDb();
    const all = await db.getAll('syncQueue');
    return all.filter(i =>
      !i.id.startsWith('lock_cloud_') &&
      !i.dead &&
      i.type === 'delete' &&
      (userId ? (i.ownerId === undefined || i.ownerId === userId) : true)
    ).length;
  },

  async getUnsyncedSummary(userId: string): Promise<SyncUnsyncedSummary> {
    const localDocs = await LocalDocumentService.getDocumentsByOwner(userId);
    let behindCount = 0;
    let unlinkedCount = 0;
    let deviceOnlyCount = 0;
    let hasUnknown = false;

    // 1. Identify unresolved linked documents whose lastSyncedCloudVersion is undefined
    const unresolvedDocs = localDocs.filter(
      d => Boolean(d.linkedCloudId) && d.lastSyncedCloudVersion === undefined && !d.localOnly
    );

    if (unresolvedDocs.length > 0) {
      if (!navigator.onLine) {
        hasUnknown = true;
      } else {
        try {
          const cloudDocVersions = await DocumentService.getCloudDocumentVersions(userId);
          const db = await getLocalDb();
          const tx = db.transaction('documents', 'readwrite');
          for (const d of unresolvedDocs) {
            const cloudVer = cloudDocVersions.get(d.linkedCloudId!) ?? 0;
            d.lastSyncedCloudVersion = cloudVer;
            await tx.store.put(d);
          }
          await tx.done;
        } catch (err) {
          reportError(err, { action: 'getUnsyncedSummary_resolveCloudVersions', userId }, 'warning');
          hasUnknown = true;
        }
      }
    }

    for (const d of localDocs) {
      if (d.localOnly || d.isTooLargeForSync) {
        deviceOnlyCount++;
        continue;
      }
      if (!d.linkedCloudId) {
        unlinkedCount++;
        continue;
      }
      if (d.lastSyncedCloudVersion === undefined) {
        hasUnknown = true;
        continue;
      }
      if ((d.currentVersion ?? 0) > d.lastSyncedCloudVersion) {
        behindCount++;
      }
    }

    const deadCount = await this.getDeadCount(userId);

    return {
      unsyncedCount: behindCount + unlinkedCount,
      behindCount,
      unlinkedCount,
      deviceOnlyCount,
      hasUnknown,
      deadCount,
    };
  },

  async getUnsyncedCount(userId: string): Promise<number> {
    const summary = await this.getUnsyncedSummary(userId);
    return summary.unsyncedCount;
  },

  async syncPending(userId: string, opts?: { force?: boolean }): Promise<SyncPendingResult> {
    // SEC-8: Автосинк выключен по умолчанию: молчание = согласия нет.
    // opts.force обходит тумблер только для явного действия человека; фоновый
    // дренаж (возврат сети, сохранение) его не передаёт — при выключенной
    // синхронизации очередь не уходит.
    if (!opts?.force && !cloudSyncEnabled(userId)) {
      return { drained: 0, failed: 0, skippedReason: 'sync_disabled' };
    }
    if (_syncInProgress.get(userId)) {
      return { drained: 0, failed: 0, skippedReason: 'in_progress' };
    }
    _syncInProgress.set(userId, true);

    try {
      const res = await _drainPendingQueue(userId);
      return res;
    } finally {
      _syncInProgress.delete(userId); // [A-08] delete вместо set(false): очищаем Map, а не накапливаем false-записи
    }
  },

  async syncAllUnlinked(userId: string): Promise<{ synced: number; failed: number }> {
    // SEC-8: Ручное действие пользователя («Отправить все заметки в облако»)
    // намеренно выполняется независимо от switch-настройки автосинка.
    if (_syncInProgress.get(userId)) return { synced: 0, failed: 0 };
    _syncInProgress.set(userId, true);

    try {
      // 1. Re-link first. A note whose link was lost still has its cloud copy, and
      // uploading it "unlinked" creates a second cloud document. Deliberately
      // not caught: if the cloud can't be read we must not upload blind, and
      // both callers surface the rejection to the user.
      const relinkRes = await CloudSyncService.relinkOrphanedDocuments(userId);
      const skippedIds = relinkRes?.skippedIds ?? [];
      const skippedSet = new Set(skippedIds);

      // 2. Resolve unknown cloud versions against cloud map
      await this.getUnsyncedSummary(userId);

      // 3. Collect work: any note that is not localOnly and where the cloud lacks
      // what the device has (unlinked or linked-but-behind).
      // L-2: A note whose relink was skipped because the document lock was held
      // must NOT be uploaded as an unlinked note on this pass. Doing so creates
      // a second cloud copy and splits history. Exclude skippedIds from toUpload.
      const localDocs = await LocalDocumentService.getDocumentsByOwner(userId);
      const toUpload = localDocs.filter(d => {
        const status = syncStatusOf(d);
        if (status === 'local-only' || status === 'locked' || status === 'unreadable') return false;
        if (skippedSet.has(d.id)) return false;
        if (status === 'unlinked-new') return true;
        return (d.currentVersion ?? 0) > (d.lastSyncedCloudVersion ?? 0);
      });

      const results = await Promise.allSettled(toUpload.map(doc =>
        limit(() => StorageService.addCloudCopy(userId, doc.id))
      ));

      let synced = 0;
      const failedIds: string[] = [];
      results.forEach((r, i) => {
        if (r.status === 'rejected') { failedIds.push(toUpload[i]!.id); return; }
        // AG-QUAR-1: пустой cloudId — не отказ. Так отвечают штатные ветки
        // addCloudCopy: работу забрал параллельный проход (жив lock) или
        // облачная копия удалена и ссылка уже снята. Обе прибрали за собой;
        // считать их провалом — занизить счётчик и поставить в очередь
        // работу, которой нет. Настоящий сбой приходит исключением.
        if (r.value && r.value !== CLOUD_COPY_LOCAL_ONLY && r.value !== CLOUD_COPY_TOMBSTONE) synced++;
      });

      // Failed uploads are put into the queue for subsequent retries.
      for (const id of failedIds) {
        try {
          await SyncService.addToQueue(id);
        } catch (e) {
          reportError(e, { action: 'syncAllUnlinked_queueFailed', documentId: id });
        }
      }

      // 4. Drain the queue AFTER all producers (relink, background tasks, deletes, portraits).
      await _drainPendingQueue(userId);

      // S-19: Sync streak freezes with cloud
      await syncStreakFreezesWithCloud(userId).catch(e =>
        reportError(e, { action: 'syncStreakFreezes_syncAllUnlinked', userId })
      );

      return { synced, failed: failedIds.length };
    } finally {
      _syncInProgress.delete(userId);  // [A-08] delete instead of set(false)
    }
  },

  async syncOne(userId: string, localId: string): Promise<string> {
    if (!cloudSyncEnabled(userId)) return '';
    const cloudId = await StorageService.addCloudCopy(userId, localId);
    const result = (cloudId === CLOUD_COPY_LOCAL_ONLY || cloudId === CLOUD_COPY_TOMBSTONE) ? '' : (cloudId || '');
    if (result) {
      await this.removeQueueTasksForDocument(localId);
    }
    return result;
  },

  async sweepOrphanedDocuments(userId: string, olderThanMs = 5 * 60 * 1000): Promise<{ enqueued: number }> {
    if (!userId || userId.startsWith('guest')) return { enqueued: 0 };
    if (!cloudSyncEnabled(userId)) return { enqueued: 0 };

    const db = await getLocalDb();
    const queue = await db.getAll('syncQueue');
    const queuedDocIds = new Set(queue.map(q => q.documentId).filter(Boolean));

    const localDocs = await LocalDocumentService.getDocumentsByOwner(userId);
    const now = Date.now();
    const cutoff = now - olderThanMs;

    const orphans = localDocs.filter(d => {
      if (d.localOnly || d.unlinkedByTombstone || d._locked || d._decryptionError || d.isTooLargeForSync) return false;
      if (queuedDocIds.has(d.id)) return false;

      const noteTime = d.lastSessionAt || d.firstSessionAt || 0;
      if (noteTime <= 0 || noteTime >= cutoff) return false;

      const status = syncStatusOf(d);
      if (status === 'unlinked-new') return true;
      if (d.linkedCloudId && d.lastSyncedCloudVersion !== undefined && (d.currentVersion ?? 0) > d.lastSyncedCloudVersion) {
        return true;
      }
      return false;
    });

    if (orphans.length === 0) return { enqueued: 0 };

    let enqueued = 0;
    for (const doc of orphans) {
      try {
        await this.addToQueue(doc.id);
        enqueued++;
      } catch (e) {
        reportError(e, { action: 'sweepOrphanedDocuments_enqueue', documentId: doc.id });
      }
    }

    return { enqueued };
  },

  async syncDocument(userId: string, localId: string, encryptionRequired = true): Promise<boolean> {
    const cloudId = await StorageService.addCloudCopy(userId, localId, encryptionRequired);
    // addCloudCopy returns '' when a concurrent sync holds the lock (no-op). Don't
    // clear this doc's queue items then — the pending edit would never be retried.
    // Also never delete the lock_cloud_ entry itself.
    if (!cloudId || cloudId === CLOUD_COPY_LOCAL_ONLY || cloudId === CLOUD_COPY_TOMBSTONE) return false;
    const db = await getLocalDb();
    const queue = await db.getAll('syncQueue');
    const docTasks = queue.filter(p => p.documentId === localId && !p.id.startsWith('lock_cloud_'));
    if (docTasks.length > 0) {
      const tx = db.transaction('syncQueue', 'readwrite');
      await Promise.all(docTasks.map(p => tx.store.delete(p.id)));
      await tx.done;
    }
    return true;
  },

  async downloadAllFromCloud(
    userId: string,
    opts?: { onProgress?: (current: number, total: number) => void }
  ): Promise<{ downloaded: number; skipped: number; failed: number; locked?: boolean }> {
    // The download itself lives in CloudSyncService so that
    // restoreMissingDocuments can share it without importing this module back
    // (import/no-cycle). This wrapper adds what only the sync layer owns.
    const res = await CloudSyncService.downloadAllFromCloud(userId, opts);
    if (res.downloaded > 0) announceQueueChange();

    if (!res.locked) {
      // S-19: Sync streak freezes with cloud so device B picks up freezes from device A
      await syncStreakFreezesWithCloud(userId).catch(e =>
        reportError(e, { action: 'syncStreakFreezes_downloadAllFromCloud', userId })
      );
    }
    return res;
  },

  async reconcileLinkedDocuments(
    userId: string,
    opts?: { getActiveDocumentId?: () => string | null }
  ): Promise<{ reconciled: number; skipped: number; failed: number; locked?: boolean }> {
    const res = await CloudSyncService.reconcileLinkedDocuments(userId, opts);
    if (res.reconciled > 0) announceQueueChange();
    return res;
  },

};

async function _drainPendingQueue(userId: string): Promise<{ drained: number; failed: number }> {
  const db = await getLocalDb();
  const queue = await db.getAll('syncQueue');

  // A task belongs to the account that created it. Draining someone else's —
  // after an account switch, a multi-tab race or a crash recovery — would upload
  // or DELETE their cloud documents under this user. Tasks predating the owner
  // field have no stamp and are treated as this user's: they can only have come
  // from this device's own earlier session.
  const foreign = queue.filter(item => item.ownerId !== undefined && item.ownerId !== userId);
  if (foreign.length > 0) {
    reportError(
      new Error(`Sync queue holds ${foreign.length} task(s) belonging to another account`),
      { action: 'drainPendingQueue_foreignOwner', count: foreign.length },
      'warning',
    );
  }

  const pending = queue.filter(item => {
    if (item.id.startsWith('lock_cloud_')) return false;
    if (item.dead) return false; // AUDIT-H4: карантинные задачи не дренируются
    if (item.ownerId !== undefined && item.ownerId !== userId) return false;
    return true;
  });

  if (pending.length === 0) return { drained: 0, failed: 0 };

  const deleteTasks = pending.filter(p => p.type === 'delete');
  const portraitTasks = pending.filter(p => p.type === 'portrait');
  const docTasks = pending.filter(p => p.type === 'document' || p.type === 'version');
  const pendingBumps: Promise<void>[] = [];
  const bump = (taskId: string, reason: unknown) => {
    pendingBumps.push(bumpAttempts(taskId, reason));
  };

  const syncedIds: string[] = [];

  // 1. Process delete tasks
  if (deleteTasks.length > 0) {
    const deleteResults = await Promise.allSettled(deleteTasks.map(task =>
      limit(async () => {
        await CloudSyncService.removeCloudCopy(userId, task.documentId);
        return task.id;
      })
    ));
    for (const r of deleteResults) {
      if (r.status === 'fulfilled') {
        syncedIds.push(r.value);
      } else {
        logger.error('drainPendingQueue_delete', 'Delete sync failed', { reason: String(r.reason) });
        const idx = deleteResults.indexOf(r);
        if (idx >= 0) bump(deleteTasks[idx]!.id, r.reason);
      }
    }
  }

  // 2. Process portrait tasks. Calls CloudSyncService (also core), not
  // AIProfileService (features/ai) — core must not import from features/
  // (ARCHITECTURE.md), even via dynamic import (eslint catches that too).
  if (portraitTasks.length > 0) {
    const portraitResults = await Promise.allSettled(portraitTasks.map(task =>
      limit(async () => {
        if (task.documentId !== userId) {
          logger.warn('drainPendingQueue_portrait', 'Skipping portrait task for mismatching user ID', { taskDocId: task.documentId, currentUserId: userId });
          return task.id;
        }
        await CloudSyncService.syncPortraitToCloud(task.documentId);
        return task.id;
      })
    ));
    for (const r of portraitResults) {
      if (r.status === 'fulfilled') {
        syncedIds.push(r.value);
      } else {
        logger.error('drainPendingQueue_portrait', 'Portrait sync failed', { reason: String(r.reason) });
        const idx = portraitResults.indexOf(r);
        if (idx >= 0) bump(portraitTasks[idx]!.id, r.reason);
      }
    }
  }

  // 3. Process document/version tasks
  if (docTasks.length > 0) {
    // Same rule as syncAllUnlinked: never upload a note whose link may only be
    // missing. If the check itself can't run, leave the queue alone and retry
    // on the next pass — a stuck task is recoverable, a duplicate cloud doc is
    // not.
    let skippedSet = new Set<string>();
    try {
      const relinkRes = await CloudSyncService.relinkOrphanedDocuments(userId);
      // Тот же приём, что в syncAllUnlinked: результат читается через `?.`.
      // Вызывающий не должен падать на форме ответа — TypeError здесь оставил
      // бы очередь недренированной, а документ незагруженным.
      skippedSet = new Set(relinkRes?.skippedIds ?? []);
    } catch (e) {
      logger.error('drainPendingQueue', 'Skipping uploads: could not verify cloud links', { reason: String(e) });
      if (syncedIds.length > 0) await _clearQueueItems(syncedIds);
      return { drained: syncedIds.length, failed: docTasks.length };
    }

    const eligibleDocTasks = docTasks.filter(p => !skippedSet.has(p.documentId));
    const documentIds = [...new Set(eligibleDocTasks.map(p => p.documentId))];
    const pendingByDoc = new Map<string, typeof docTasks>();
    for (const p of eligibleDocTasks) {
      const arr = pendingByDoc.get(p.documentId);
      if (arr) arr.push(p); else pendingByDoc.set(p.documentId, [p]);
    }

    const results = await Promise.allSettled(documentIds.map(localId =>
      limit(() => StorageService.addCloudCopy(userId, localId).then(cloudId => {
        if (!cloudId || cloudId === CLOUD_COPY_LOCAL_ONLY || cloudId === CLOUD_COPY_TOMBSTONE) return [];
        return (pendingByDoc.get(localId) ?? []).map(p => p.id);
      }))
    ));

    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (r.status === 'fulfilled') syncedIds.push(...r.value);
      else {
        logger.error('drainPendingQueue', 'Sync failed', { reason: String(r.reason) });
        // У документа может быть несколько задач — карантиним все его задачи.
        const localId = documentIds[i]!;
        for (const t of (pendingByDoc.get(localId) ?? [])) bump(t.id, r.reason);
      }
    }
  }

  if (pendingBumps.length > 0) await Promise.all(pendingBumps);

  if (syncedIds.length > 0) {
    await _clearQueueItems(syncedIds);
    announceQueueChange();
  }

  return { drained: syncedIds.length, failed: pendingBumps.length };
}

async function _clearQueueItems(ids: string[]): Promise<void> {
  const db = await getLocalDb();
  const tx = db.transaction('syncQueue', 'readwrite');
  await Promise.all(ids.map(id => tx.store.delete(id)));
  await tx.done;
}
