import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { SyncService } from '../SyncService';
import { CloudSyncService } from '../CloudSyncService';

const ME = 'user_me';
const SOMEONE_ELSE = 'user_other';

async function clearQueue() {
  const db = await getLocalDb();
  for (const rec of await db.getAll('syncQueue')) await db.delete('syncQueue', (rec as { id: string }).id);
  localStorage.setItem('auto_sync_enabled', 'true');
}

// _drainPendingQueue executes every task under the CURRENT user, including
// removeCloudCopy — deleting cloud documents. A task with no owner could be
// drained under whichever account signed in next.
describe('sync queue respects the owner', () => {
  beforeEach(clearQueue);

  it('does not run a task belonging to another account', async () => {
    const db = await getLocalDb();
    await db.put('syncQueue', {
      id: 'delete_theirs', documentId: 'cloud_theirs', type: 'delete',
      createdAt: Date.now(), ownerId: SOMEONE_ELSE,
    } as never);
    const remove = vi.spyOn(CloudSyncService, 'removeCloudCopy').mockResolvedValue(undefined);

    await SyncService.syncPending(ME);

    expect(remove).not.toHaveBeenCalled();
    // And it stays: it is not ours to delete either.
    expect(await db.get('syncQueue', 'delete_theirs')).toBeTruthy();
  });

  it('runs a task stamped with this account', async () => {
    const db = await getLocalDb();
    await db.put('syncQueue', {
      id: 'delete_mine', documentId: 'cloud_mine', type: 'delete',
      createdAt: Date.now(), ownerId: ME,
    } as never);
    const remove = vi.spyOn(CloudSyncService, 'removeCloudCopy').mockResolvedValue(undefined);

    await SyncService.syncPending(ME);

    expect(remove).toHaveBeenCalledWith(ME, 'cloud_mine');
  });

  it('stamps the note\'s owner when queueing', async () => {
    const db = await getLocalDb();
    await db.put('documents', {
      id: 'local_owned', guestId: ME, title: 'n', currentVersion: 1, totalWords: 1,
      totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [],
    } as never);

    await SyncService.addToQueue('local_owned');

    const queued = (await db.getAll('syncQueue')).find(i => i.documentId === 'local_owned');
    expect(queued?.ownerId).toBe(ME);
  });
});
