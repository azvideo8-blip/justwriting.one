import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { SyncService } from '../SyncService';
import { StorageService } from '../StorageService';
import { CloudSyncService } from '../CloudSyncService';

const USER = 'user_retry';

async function seed() {
  const db = await getLocalDb();
  for (const rec of await db.getAll('documents')) await db.delete('documents', (rec as { id: string }).id);
  for (const rec of await db.getAll('syncQueue')) await db.delete('syncQueue', (rec as { id: string }).id);
  await db.put('documents', {
    id: 'local_fails', guestId: USER, title: 'n', currentVersion: 1, totalWords: 1,
    totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1,
    tags: [], linkedCloudId: '',
  } as never);
}

// syncAllUnlinked зовут только перенос гостевых заметок и ручная кнопка в
// диагностике. Автоматического прохода по несвязанным заметкам нет: если
// выгрузка упала и задачу никто не поставил в очередь, заметка остаётся только
// локальной навсегда.
describe('syncAllUnlinked queues what it could not upload', () => {
  beforeEach(async () => {
    await seed();
    vi.restoreAllMocks();
    vi.spyOn(CloudSyncService, 'relinkOrphanedDocuments').mockResolvedValue(undefined as never);
  });

  it('puts a failed upload into the sync queue', async () => {
    vi.spyOn(StorageService, 'addCloudCopy').mockRejectedValue(new Error('network'));

    const { synced, failed } = await SyncService.syncAllUnlinked(USER);

    expect(synced).toBe(0);
    expect(failed).toBe(1);
    const db = await getLocalDb();
    const queued = (await db.getAll('syncQueue')).filter(i => i.documentId === 'local_fails');
    expect(queued).toHaveLength(1);
    // A7: задача принадлежит своему аккаунту, иначе дренаж её пропустит.
    expect(queued[0]!.ownerId).toBe(USER);
  });

  it('does not queue anything when the upload succeeds', async () => {
    vi.spyOn(StorageService, 'addCloudCopy').mockResolvedValue('cloud_1');

    const { synced, failed } = await SyncService.syncAllUnlinked(USER);

    expect(synced).toBe(1);
    expect(failed).toBe(0);
    const db = await getLocalDb();
    expect((await db.getAll('syncQueue')).filter(i => i.documentId === 'local_fails')).toHaveLength(0);
  });
});
