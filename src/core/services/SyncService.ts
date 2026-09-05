import { getLocalDb } from '../storage/localDb';
import { logger } from '../../shared/errors/logger';
import { reportError } from '../../shared/errors/reportError';
import { StorageService } from './StorageService';
import { LocalDocumentService } from './LocalDocumentService';
import { DocumentService } from './DocumentService';
import { CloudSyncService } from './CloudSyncService';
import { cloudSyncEnabled } from '../sync/cloudSyncEnabled';
import pLimit from 'p-limit';

const _syncInProgress = new Map<string, boolean>();
const limit = pLimit(5);

// AUDIT-H4: детерминированные ошибки (LOCKED, DECRYPTION_ERROR,
// Invalid sessionStartedAt, ENCRYPT_REQUIRED) не исправятся ретраями — задача уходит в карантин
// сразу; остальным даём MAX_ATTEMPTS проходов, потом тоже карантин.
const MAX_ATTEMPTS = 10;
const DETERMINISTIC_ERROR = /LOCKED|DECRYPTION_ERROR|Invalid sessionStartedAt|ENCRYPT_REQUIRED/;

async function bumpAttempts(
  taskId: string,
  reason: unknown,
  mutate: (id: string, patch: { attempts: number; dead: boolean; lastError?: string }) => Promise<void>,
): Promise<void> {
  const db = await getLocalDb();
  const item = await db.get('syncQueue', taskId);
  if (!item || item.dead) return;
  const attempts = (item.attempts ?? 0) + 1;
  const reasonStr = String(reason);
  const dead = DETERMINISTIC_ERROR.test(reasonStr) || attempts >= MAX_ATTEMPTS;
  await mutate(taskId, { attempts, dead, lastError: reasonStr });
  if (dead) {
    reportError(new Error('Sync task quarantined'), { taskId, attempts, reason: reasonStr }, 'warning');
    announceQueueChange();
  }
}

async function markAttempt(taskId: string, patch: { attempts: number; dead: boolean; lastError?: string }): Promise<void> {
  const db = await getLocalDb();
  const item = await db.get('syncQueue', taskId);
  if (!item) return;
  await db.put('syncQueue', { ...item, attempts: patch.attempts, dead: patch.dead, lastError: patch.lastError });
}

// AUD-25: индикатор синка больше не опрашивает IndexedDB каждые 10 секунд —
// слой синка сам объявляет об изменениях очереди, и подписчики перечитывают
// счётчики только тогда, когда что-то действительно изменилось.
function announceQueueChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('sync-queue-changed'));
  } catch { /* non-critical */ }
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
  async addToQueue(documentId: string): Promise<void> {
    const db = await getLocalDb();
    // The queue task inherits the note's owner. A task with no owner could be
    // drained under whichever account happens to be signed in next.
    const doc = await db.get('documents', documentId);
    const tx = db.transaction('syncQueue', 'readwrite');
    const taskId = `sync_${documentId}`;
    const existing = await tx.store.get(taskId);
    const cutoff = Date.now() - 60_000;
    // Overwrite or update task; avoid rapid re-queueing of recent tasks unless failed/dead
    if (!existing || existing.createdAt < cutoff || existing.dead) {
      await tx.store.put({
        id: taskId,
        documentId,
        type: 'document' as const,
        createdAt: Date.now(),
        ownerId: doc?.guestId,
      });
    }
    await tx.done;
    announceQueueChange();
  },

  async removeQueueTasksForDocument(documentId: string): Promise<void> {
    const db = await getLocalDb();
    const tx = db.transaction('syncQueue', 'readwrite');
    const all = await tx.store.getAll();
    const matching = all.filter(t => t.documentId === documentId || t.id === `sync_${documentId}`);
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
      (item.lastError?.includes('LOCKED') || item.lastError?.includes('locked') || item.lastError?.includes('ENCRYPT_REQUIRED') || item.lastError?.includes('SYNC_UNRESOLVED')) &&
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
      if (d.localOnly) {
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

  async syncPending(userId: string): Promise<SyncPendingResult> {
    // SEC-8: Автосинк выключен по умолчанию: молчание = согласия нет.
    if (!cloudSyncEnabled()) {
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
      await CloudSyncService.relinkOrphanedDocuments(userId);

      // 2. Resolve unknown cloud versions against cloud map
      await this.getUnsyncedSummary(userId);

      // 3. Collect work: any note that is not localOnly and where the cloud lacks
      // what the device has (unlinked or linked-but-behind).
      const localDocs = await LocalDocumentService.getDocumentsByOwner(userId);
      const toUpload = localDocs.filter(d => {
        if (d.localOnly || d._locked || d._decryptionError) return false;
        if (!d.linkedCloudId) return true;
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
        if (r.value) synced++;
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

      return { synced, failed: failedIds.length };
    } finally {
      _syncInProgress.delete(userId);  // [A-08] delete instead of set(false)
    }
  },

  async syncOne(userId: string, localId: string): Promise<string> {
    const cloudId = await StorageService.addCloudCopy(userId, localId);
    return cloudId || '';
  },

  async syncDocument(userId: string, localId: string, encryptionRequired = true): Promise<boolean> {
    const cloudId = await StorageService.addCloudCopy(userId, localId, encryptionRequired);
    // addCloudCopy returns '' when a concurrent sync holds the lock (no-op). Don't
    // clear this doc's queue items then — the pending edit would never be retried.
    // Also never delete the lock_cloud_ entry itself.
    if (!cloudId) return false;
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
    userId: string
  ): Promise<{ downloaded: number; skipped: number; failed: number }> {
    const [cloudDocs, localDocs] = await Promise.all([
      DocumentService.getUserDocuments(userId),
      LocalDocumentService.getDocumentsByOwner(userId),
    ]);

    const linkedCloudMap = new Map(localDocs.filter(d => d.linkedCloudId).map(d => [d.linkedCloudId!, d]));
    const toDownload = cloudDocs.filter(d => !linkedCloudMap.has(d.id));
    const toReconcile = cloudDocs.filter(d => linkedCloudMap.has(d.id));

    const downloadResults = await Promise.allSettled(
      toDownload.map(cloudDoc => limit(() => StorageService.addLocalCopy(userId, cloudDoc.id)))
    );

    const reconcileResults = await Promise.allSettled(
      toReconcile.map(cloudDoc => {
        const localDoc = linkedCloudMap.get(cloudDoc.id)!;
        return limit(() => StorageService.addCloudCopy(userId, localDoc.id));
      })
    );

    let downloaded = 0;
    let failed = 0;
    for (const r of downloadResults) {
      if (r.status === 'fulfilled') downloaded++;
      else { failed++; logger.error('downloadAllFromCloud', 'Download failed', { reason: String(r.reason) }); }
    }
    for (const r of reconcileResults) {
      if (r.status === 'rejected') {
        failed++;
        logger.error('downloadAllFromCloud', 'Reconcile failed', { reason: String(r.reason) });
      }
    }

    return { downloaded, skipped: toReconcile.length, failed };
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
    pendingBumps.push(bumpAttempts(taskId, reason, markAttempt));
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
    try {
      await CloudSyncService.relinkOrphanedDocuments(userId);
    } catch (e) {
      logger.error('drainPendingQueue', 'Skipping uploads: could not verify cloud links', { reason: String(e) });
      if (syncedIds.length > 0) await _clearQueueItems(syncedIds);
      return { drained: syncedIds.length, failed: docTasks.length };
    }

    const documentIds = [...new Set(docTasks.map(p => p.documentId))];
    const pendingByDoc = new Map<string, typeof docTasks>();
    for (const p of docTasks) {
      const arr = pendingByDoc.get(p.documentId);
      if (arr) arr.push(p); else pendingByDoc.set(p.documentId, [p]);
    }

    const results = await Promise.allSettled(documentIds.map(localId =>
      limit(() => StorageService.addCloudCopy(userId, localId).then(cloudId => {
        if (!cloudId) return [];
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
