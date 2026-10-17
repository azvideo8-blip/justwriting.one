import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LocalStoreSyncService } from '../LocalStoreSyncService';
import { DataProvider } from '../../data';

vi.mock('../../sync/cloudSyncEnabled', () => ({
  cloudSyncEnabled: () => true,
}));

const USER = 'u_ls_delete_retry';

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
  getCurrentUserId: () => USER,
}));

describe('Area 1: LocalStoreSyncService delete queue must retry on network failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('FAILING TEST: when delete fails with network error, it must remain queued for retry', async () => {
    let callCount = 0;
    // T-8: «Отправить всё» читает серверные отметки — облака здесь нет.
    vi.spyOn(DataProvider, 'getLocalStoreStamps').mockResolvedValue([]);
    vi.spyOn(DataProvider, 'deleteLocalStoreRecord').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Failed to fetch (network error)');
      }
    });

    // Schedule a deletion
    LocalStoreSyncService.scheduleStoreDelete('aiDialogues', 'diag_to_delete');

    // Run 1: Network fails
    const run1 = await LocalStoreSyncService.syncAllLocalStores(USER);
    expect(run1.failed).toBe(1);

    // Run 2: Network is restored. The item MUST be retried!
    const run2 = await LocalStoreSyncService.syncAllLocalStores(USER);
    expect(run2.synced).toBe(1);
    expect(callCount).toBe(2);
  });
});
