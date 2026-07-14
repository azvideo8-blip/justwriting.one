import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { SyncService } from '../SyncService';
import { LocalDocumentService } from '../LocalDocumentService';
import { getLocalDb } from '../../storage/localDb';
import { CloudSyncService } from '../CloudSyncService';

describe('SyncService Integration', () => {
  const userId = 'test_user_integration';

  beforeEach(async () => {
    const db = await getLocalDb();
    const tx = db.transaction(['documents', 'versions', 'syncQueue', 'profile'], 'readwrite');
    await Promise.all([
      tx.objectStore('documents').clear(),
      tx.objectStore('versions').clear(),
      tx.objectStore('syncQueue').clear(),
      tx.objectStore('profile').clear(),
      tx.done,
    ]);
  });

  it('addToQueue creates a sync queue entry', async () => {
    await SyncService.addToQueue('doc_1');
    const count = await SyncService.getPendingCount();
    expect(count).toBe(1);
  });

  it('getPendingCount returns 0 when queue is empty', async () => {
    const count = await SyncService.getPendingCount();
    expect(count).toBe(0);
  });

  it('getUnsyncedCount returns local docs without linkedCloudId', async () => {
    await LocalDocumentService.createDocument(userId, { title: 'Test Doc' });
    const count = await SyncService.getUnsyncedCount(userId);
    expect(count).toBe(1);
  });

  it('syncPending skips when auto_sync_enabled is false', async () => {
    localStorage.setItem('auto_sync_enabled', 'false');
    await SyncService.addToQueue('doc_1');
    await SyncService.syncPending(userId);
    const count = await SyncService.getPendingCount();
    expect(count).toBe(1);
    localStorage.removeItem('auto_sync_enabled');
  });

  it('syncPending skips when already in progress', async () => {
    localStorage.setItem('auto_sync_enabled', 'true');
    await SyncService.syncPending(userId);
    await SyncService.syncPending(userId);
    localStorage.removeItem('auto_sync_enabled');
  });

  it('expired queue items are cleaned up during sync', async () => {
    const db = await getLocalDb();
    await db.put('syncQueue', {
      id: 'sync_doc_old',
      documentId: 'doc_old',
      type: 'document' as const,
      createdAt: Date.now() - 25 * 60 * 60 * 1000,
    });
    const countBefore = await SyncService.getPendingCount();
    expect(countBefore).toBe(1);
  });

  it('drains delete and portrait tasks from syncQueue', async () => {
    const removeCloudCopySpy = vi.spyOn(CloudSyncService, 'removeCloudCopy').mockResolvedValue(undefined);
    const syncPortraitSpy = vi.spyOn(CloudSyncService, 'syncPortraitToCloud').mockResolvedValue(undefined);

    const db = await getLocalDb();
    
    await db.put('syncQueue', {
      id: 'delete_cloud_123',
      documentId: 'cloud_123',
      type: 'delete' as const,
      createdAt: Date.now(),
    });

    await db.put('syncQueue', {
      id: `portrait_${userId}`,
      documentId: userId,
      type: 'portrait' as const,
      createdAt: Date.now(),
    });

    localStorage.setItem('auto_sync_enabled', 'true');
    await SyncService.syncPending(userId);
    localStorage.removeItem('auto_sync_enabled');

    expect(removeCloudCopySpy).toHaveBeenCalledWith(userId, 'cloud_123');
    expect(syncPortraitSpy).toHaveBeenCalledWith(userId);

    const count = await SyncService.getPendingCount();
    expect(count).toBe(0);

    removeCloudCopySpy.mockRestore();
    syncPortraitSpy.mockRestore();
  });
});
