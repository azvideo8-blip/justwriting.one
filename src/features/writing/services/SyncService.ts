import { getLocalDb } from '../../../shared/lib/localDb';
import { StorageService } from './StorageService';
import { LocalDocumentService } from './LocalDocumentService';

let _syncInProgress = false;

export const SyncService = {
  async addToQueue(documentId: string): Promise<void> {
    const db = await getLocalDb();
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
    return all.filter(item => !item.id.startsWith('migrated_')).length;
  },

  async getUnsyncedCount(userId: string): Promise<number> {
    const localDocs = await LocalDocumentService.getGuestDocuments(userId);
    return localDocs.filter(d => !d.linkedCloudId).length;
  },

  async syncPending(userId: string): Promise<void> {
    if (_syncInProgress) return;
    _syncInProgress = true;

    try {
      const db = await getLocalDb();
      const queue = await db.getAll('syncQueue');
      const pending = queue.filter(item => !item.id.startsWith('migrated_'));

      if (pending.length === 0) return;

      const documentIds = [...new Set(pending.map(p => p.documentId))];
      const syncedIds: string[] = [];

      for (const localId of documentIds) {
        try {
          const cloudId = await StorageService.addCloudCopy(userId, localId);
          await LocalDocumentService.updateLinkedCloudId(localId, cloudId);
          const itemsForDoc = pending.filter(p => p.documentId === localId);
          syncedIds.push(...itemsForDoc.map(p => p.id));
        } catch (e) {
          console.error(`Sync failed for ${localId}:`, e);
        }
      }

      if (syncedIds.length > 0) {
        const tx = db.transaction('syncQueue', 'readwrite');
        await Promise.all(syncedIds.map(id => tx.store.delete(id)));
        await tx.done;
      }
    } finally {
      _syncInProgress = false;
    }
  },

  async syncAllUnlinked(userId: string): Promise<{ synced: number; failed: number }> {
    await SyncService.syncPending(userId);

    const localDocs = await LocalDocumentService.getGuestDocuments(userId);
    const unlinked = localDocs.filter(d => !d.linkedCloudId);

    let synced = 0;
    let failed = 0;

    for (const doc of unlinked) {
      try {
        const cloudId = await StorageService.addCloudCopy(userId, doc.id);
        await LocalDocumentService.updateLinkedCloudId(doc.id, cloudId);
        synced++;
      } catch (e) {
        console.error(`Sync failed for ${doc.id}:`, e);
        failed++;
      }
    }

    return { synced, failed };
  },

  async syncOne(userId: string, localId: string): Promise<string> {
    const cloudId = await StorageService.addCloudCopy(userId, localId);
    await LocalDocumentService.updateLinkedCloudId(localId, cloudId);
    return cloudId;
  },

  async maybeSyncAfterSave(userId: string, localId: string, autoSync: boolean): Promise<void> {
    if (!autoSync) return;
    await SyncService.addToQueue(localId);
    await SyncService.syncPending(userId);
  },
};
