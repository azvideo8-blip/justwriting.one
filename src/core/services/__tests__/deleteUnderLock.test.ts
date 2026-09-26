import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';

const doc: { id: string; linkedCloudId?: string } = { id: 'loc1' };
vi.mock('../LocalStorageService', () => ({
  LocalStorageService: { getDocument: vi.fn(async () => ({ ...doc })), deleteDocument: vi.fn(async () => {}) },
}));
vi.mock('../CloudSyncService', () => ({ CloudSyncService: { removeCloudCopy: vi.fn(async () => {}) } }));

import { StorageService } from '../StorageService';
import { CloudSyncService } from '../CloudSyncService';

// R3-10: удаление во время первой выгрузки: облачный ряд создавался уже после
// удаления локальной записи, никто его не удалял, и заметка возвращалась.
describe('R3-10: delete waits for an in-flight upload of the same note', () => {
  it('deletes the cloud row the upload just created', async () => {
    const db = await getLocalDb('u1');
    await db.put('syncQueue', { id: 'lock_cloud_loc1', documentId: 'loc1', type: 'document', createdAt: Date.now(), ownerToken: 'drain' });
    setTimeout(() => {
      doc.linkedCloudId = 'cloud1';
      void db.delete('syncQueue', 'lock_cloud_loc1');
    }, 300);

    await StorageService.deleteDocument('u1', 'loc1');
    expect(CloudSyncService.removeCloudCopy).toHaveBeenCalledWith('u1', 'cloud1');
  });
});
