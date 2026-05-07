import { getLocalDb } from '../../../shared/lib/localDb';
import { StorageService } from './StorageService';
import { LocalDocumentService } from './LocalDocumentService';

const _syncInProgress = new Map<string, boolean>();

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
    if (_syncInProgress.get(userId)) return;
    _syncInProgress.set(userId, true);

    try {
      const db = await getLocalDb();
      const queue = await db.getAll('syncQueue');
      const pending = queue.filter(item => !item.id.startsWith('migrated_'));

      if (pending.length === 0) return;

      const documentIds = [...new Set(pending.map(p => p.documentId))];

      const results = await Promise.allSettled(documentIds.map(async (localId) => {
        const cloudId = await StorageService.addCloudCopy(userId, localId);
        if (!cloudId) return [];
        return pending.filter(p => p.documentId === localId).map(p => p.id);
      }));

      const syncedIds: string[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled') syncedIds.push(...r.value);
        else console.error(`Sync failed:`, r.reason);
      }

      if (syncedIds.length > 0) {
        const tx = db.transaction('syncQueue', 'readwrite');
        await Promise.all(syncedIds.map(id => tx.store.delete(id)));
        await tx.done;
      }
    } finally {
      _syncInProgress.set(userId, false);
    }
  },

  async syncAllUnlinked(userId: string): Promise<{ synced: number; failed: number }> {
    if (_syncInProgress.get(userId)) return { synced: 0, failed: 0 };
    _syncInProgress.set(userId, true);

    try {
      await SyncService.syncPending(userId);

      const localDocs = await LocalDocumentService.getGuestDocuments(userId);
      const unlinked = localDocs.filter(d => !d.linkedCloudId);

      const results = await Promise.allSettled(unlinked.map(async (doc) => {
        const cloudId = await StorageService.addCloudCopy(userId, doc.id);
        if (!cloudId) throw new Error('no cloudId');
      }));

      let synced = 0;
      let failed = 0;
      for (const r of results) {
        if (r.status === 'fulfilled') synced++;
        else failed++;
      }

      return { synced, failed };
    } finally {
      _syncInProgress.set(userId, false);
    }
  },

  async syncOne(userId: string, localId: string): Promise<string> {
    const cloudId = await StorageService.addCloudCopy(userId, localId);
    return cloudId || '';
  },
};
