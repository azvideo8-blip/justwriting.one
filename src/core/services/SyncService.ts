import { getLocalDb } from '../storage/localDb';
import { logger } from '../errors/logger';
import { StorageService } from './StorageService';
import { LocalDocumentService } from './LocalDocumentService';
import { DocumentService } from './DocumentService';
import pLimit from 'p-limit';

const _syncInProgress = new Map<string, boolean>();
const limit = pLimit(5);
const MAX_QUEUE_AGE_MS = 24 * 60 * 60 * 1000;

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
    return all.length;
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
  const now = Date.now();

  const expiredIds: string[] = [];
  const pending = queue.filter(item => {
    if (item.id.startsWith('lock_cloud_')) return false;
    if (now - item.createdAt > MAX_QUEUE_AGE_MS) {
      expiredIds.push(item.id);
      return false;
    }
    return true;
  });

  if (expiredIds.length > 0) {
    const tx = db.transaction('syncQueue', 'readwrite');
    await Promise.all(expiredIds.map(id => tx.store.delete(id)));
    await tx.done;
  }

  if (pending.length === 0) return;

  const documentIds = [...new Set(pending.map(p => p.documentId))];

  const results = await Promise.allSettled(documentIds.map(localId =>
    limit(() => StorageService.addCloudCopy(userId, localId).then(cloudId => {
      if (!cloudId) return [];
      return pending.filter(p => p.documentId === localId).map(p => p.id);
    }))
  ));

  const syncedIds: string[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') syncedIds.push(...r.value);
    else logger.error('drainPendingQueue', 'Sync failed', { reason: String(r.reason) });
  }

  if (syncedIds.length > 0) {
    const cleanupDb = await getLocalDb();
    const tx = cleanupDb.transaction('syncQueue', 'readwrite');
    await Promise.all(syncedIds.map(id => tx.store.delete(id)));
    await tx.done;
  }
}
