import { getLocalDb } from '../storage/localDb';
import { logger } from '../../shared/errors/logger';
import { StorageService } from './StorageService';
import { LocalDocumentService } from './LocalDocumentService';
import { DocumentService } from './DocumentService';
import { CloudSyncService } from './CloudSyncService';
import pLimit from 'p-limit';

const _syncInProgress = new Map<string, boolean>();
const limit = pLimit(5);

export const SyncService = {
  async addToQueue(documentId: string): Promise<void> {
    const db = await getLocalDb();
    const existing = await db.getAll('syncQueue');
    const cutoff = Date.now() - 60_000;
    const hasRecent = existing.some(item => item.documentId === documentId && item.createdAt >= cutoff);
    if (hasRecent) return;
    await db.put('syncQueue', {
      id: `sync_${documentId}_${Date.now()}`,
      documentId,
      type: 'document' as const,
      createdAt: Date.now(),
    });
  },

  async getPendingCount(): Promise<number> {
    const db = await getLocalDb();
    const all = await db.getAll('syncQueue');
    return all.filter(i => !i.id.startsWith('lock_cloud_')).length;
  },

  async getUnsyncedCount(userId: string): Promise<number> {
    const localDocs = await LocalDocumentService.getGuestDocuments(userId);
    return localDocs.filter(d => !d.linkedCloudId).length;
  },

  async syncPending(userId: string): Promise<void> {
    if (localStorage.getItem('auto_sync_enabled') === 'false') return;
    if (_syncInProgress.get(userId)) return;
    _syncInProgress.set(userId, true);

    try {
      await _drainPendingQueue(userId);
    } finally {
      _syncInProgress.delete(userId); // [A-08] delete вместо set(false): очищаем Map, а не накапливаем false-записи
    }
  },

  async syncAllUnlinked(userId: string): Promise<{ synced: number; failed: number }> {
    if (_syncInProgress.get(userId)) return { synced: 0, failed: 0 };
    _syncInProgress.set(userId, true);

    try {
      await _drainPendingQueue(userId);

      const localDocs = await LocalDocumentService.getGuestDocuments(userId);
      const unlinked = localDocs.filter(d => !d.linkedCloudId);

      const results = await Promise.allSettled(unlinked.map(doc =>
        limit(() => StorageService.addCloudCopy(userId, doc.id).then(cloudId => {
          if (!cloudId) throw new Error('no cloudId');
        }))
      ));

      let synced = 0;
      let failed = 0;
      for (const r of results) {
        if (r.status === 'fulfilled') synced++;
        else failed++;
      }

      return { synced, failed };
    } finally {
      _syncInProgress.delete(userId);  // [A-08] delete instead of set(false)
    }
  },

  async syncOne(userId: string, localId: string): Promise<string> {
    const cloudId = await StorageService.addCloudCopy(userId, localId);
    return cloudId || '';
  },

  async syncDocument(userId: string, localId: string, encryptionRequired = true): Promise<void> {
    await StorageService.addCloudCopy(userId, localId, encryptionRequired);
    const db = await getLocalDb();
    const queue = await db.getAll('syncQueue');
    const docTasks = queue.filter(p => p.documentId === localId);
    if (docTasks.length > 0) {
      const tx = db.transaction('syncQueue', 'readwrite');
      await Promise.all(docTasks.map(p => tx.store.delete(p.id)));
      await tx.done;
    }
  },

  async downloadAllFromCloud(
    userId: string
  ): Promise<{ downloaded: number; skipped: number; failed: number }> {
    const [cloudDocs, localDocs] = await Promise.all([
      DocumentService.getUserDocuments(userId),
      LocalDocumentService.getGuestDocuments(userId),
    ]);

    const linkedCloudIds = new Set(localDocs.map(d => d.linkedCloudId).filter(Boolean));
    const toDownload = cloudDocs.filter(d => !linkedCloudIds.has(d.id));

    const results = await Promise.allSettled(
      toDownload.map(cloudDoc => limit(() => StorageService.addLocalCopy(userId, cloudDoc.id)))
    );

    let downloaded = 0;
    let failed = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') downloaded++;
      else { failed++; logger.error('downloadAllFromCloud', 'Download failed', { reason: String(r.reason) }); }
    }

    return { downloaded, skipped: linkedCloudIds.size, failed };
  },

};

async function _drainPendingQueue(userId: string): Promise<void> {
  const db = await getLocalDb();
  const queue = await db.getAll('syncQueue');

  const pending = queue.filter(item => {
    if (item.id.startsWith('lock_cloud_')) return false;
    return true;
  });

  if (pending.length === 0) return;

  const deleteTasks = pending.filter(p => p.type === 'delete');
  const portraitTasks = pending.filter(p => p.type === 'portrait');
  const docTasks = pending.filter(p => p.type === 'document' || p.type === 'version');

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
      }
    }
  }

  // 2. Process portrait tasks. Calls CloudSyncService (also core), not
  // AIProfileService (features/ai) — core must not import from features/
  // (ARCHITECTURE.md), even via dynamic import (eslint catches that too).
  if (portraitTasks.length > 0) {
    const portraitResults = await Promise.allSettled(portraitTasks.map(task =>
      limit(async () => {
        await CloudSyncService.syncPortraitToCloud(task.documentId);
        return task.id;
      })
    ));
    for (const r of portraitResults) {
      if (r.status === 'fulfilled') {
        syncedIds.push(r.value);
      } else {
        logger.error('drainPendingQueue_portrait', 'Portrait sync failed', { reason: String(r.reason) });
      }
    }
  }

  // 3. Process document/version tasks
  if (docTasks.length > 0) {
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

    for (const r of results) {
      if (r.status === 'fulfilled') syncedIds.push(...r.value);
      else logger.error('drainPendingQueue', 'Sync failed', { reason: String(r.reason) });
    }
  }

  if (syncedIds.length > 0) {
    const cleanupDb = await getLocalDb();
    const tx = cleanupDb.transaction('syncQueue', 'readwrite');
    await Promise.all(syncedIds.map(id => tx.store.delete(id)));
    await tx.done;
  }
}
