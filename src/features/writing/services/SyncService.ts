import { getLocalDb } from '../../../shared/lib/localDb';
import { MigrationService } from './MigrationService';

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

  async syncPending(userId: string): Promise<void> {
    const db = await getLocalDb();
    const queue = await db.getAll('syncQueue');
    const pending = queue.filter(item => !item.id.startsWith('migrated_'));

    if (pending.length === 0) return;

    const documentIds = [...new Set(pending.map(p => p.documentId))];
    await MigrationService.migrateToCloud(userId, documentIds);

    const tx = db.transaction('syncQueue', 'readwrite');
    await Promise.all(pending.map(p => tx.store.delete(p.id)));
    await tx.done;
  },
};
