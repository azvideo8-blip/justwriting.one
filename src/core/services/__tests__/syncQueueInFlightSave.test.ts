// SB-1: правка, сделанная во время выгрузки, не должна исчезать из очереди.
// Два механизма из тикета работают вместе: `addToSyncQueue` молча пропускает
// повторную постановку молодой задачи (`syncQueueOps.ts:20`), а `_drainPendingQueue`
// удаляет задачи по снимку, сделанному до выгрузки (`SyncService.ts:413`), —
// то есть удаляет и ту запись, которая появилась во время полёта.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { SyncService } from '../SyncService';
import { StorageService } from '../StorageService';
import { CloudSyncService } from '../CloudSyncService';
import { setEncryptionEnabled, setProfileLoaded } from '../../crypto/cryptoHelpers';
import { addToSyncQueue } from '../syncQueueOps';
import { requeueDocumentTask } from '../../sync/requeueDocumentTask';

const USER = 'user_inflight_save';

async function seedDoc(id: string) {
  const db = await getLocalDb(USER);
  await db.put('documents', {
    id, guestId: USER, title: 'n', currentVersion: 1, totalWords: 1,
    totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1,
    tags: [], linkedCloudId: 'cloud_x',
  } as never);
}

beforeEach(async () => {
  setProfileLoaded(USER, true);
  setEncryptionEnabled(USER, false);
  const db = await getLocalDb(USER);
  await db.clear('documents');
  await db.clear('syncQueue');
  vi.restoreAllMocks();
});

describe('SB-1 — сохранение во время выгрузки', () => {
  it('повторная постановка молодой задачи помечает её, а не пропадает молча', async () => {
    await seedDoc('d_touch');
    await addToSyncQueue('d_touch', USER);

    await addToSyncQueue('d_touch', USER);

    const db = await getLocalDb(USER);
    const task = await db.get('syncQueue', 'sync_d_touch');
    expect(task).toBeDefined();
    // Без отметки дренаж не может отличить «задача тронута во время полёта» от
    // «ничего нового» — и снимает задачу, которую только что поставили.
    expect(task?.updatedAt).toBeTypeOf('number');
  });

  it('задача, поставленная во время полёта addCloudCopy, остаётся в очереди', async () => {
    await seedDoc('d_inflight');
    await addToSyncQueue('d_inflight', USER);
    vi.spyOn(CloudSyncService, 'relinkOrphanedDocuments').mockResolvedValue({ relinked: 0, skippedIds: [] });

    let release: () => void = () => {};
    const inFlight = new Promise<void>(resolve => { release = resolve; });
    const started = vi.fn();
    vi.spyOn(StorageService, 'addCloudCopy').mockImplementation(async () => {
      started();
      await inFlight;
      return 'cloud_inflight';
    });

    const draining = SyncService.syncPending(USER, { force: true });
    await vi.waitFor(() => expect(started).toHaveBeenCalled());

    // Правка успевает сохраниться, пока выгрузка в полёте.
    await addToSyncQueue('d_inflight', USER);
    release();
    const res = await draining;

    const db = await getLocalDb(USER);
    expect(await db.get('syncQueue', 'sync_d_inflight')).toBeDefined();
    expect(res.drained).toBe(0);
  });

  it('A-2.1: задача, переставленная через requeueDocumentTask во время выгрузки, остаётся в очереди', async () => {
    await seedDoc('d_requeue_inflight');
    await addToSyncQueue('d_requeue_inflight', USER);
    vi.spyOn(CloudSyncService, 'relinkOrphanedDocuments').mockResolvedValue({ relinked: 0, skippedIds: [] });

    let release: () => void = () => {};
    const inFlight = new Promise<void>(resolve => { release = resolve; });
    const started = vi.fn();
    vi.spyOn(StorageService, 'addCloudCopy').mockImplementation(async () => {
      started();
      await inFlight;
      return 'cloud_requeue_inflight';
    });

    const draining = SyncService.syncPending(USER, { force: true });
    await vi.waitFor(() => expect(started).toHaveBeenCalled());

    // Requeue happens during flight
    await requeueDocumentTask('d_requeue_inflight', USER);
    release();
    const res = await draining;

    const db = await getLocalDb(USER);
    expect(await db.get('syncQueue', 'sync_d_requeue_inflight')).toBeDefined();
    expect(res.drained).toBe(0);
  });
});
