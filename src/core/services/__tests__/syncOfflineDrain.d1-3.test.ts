import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { SyncService } from '../SyncService';
import { StorageService } from '../StorageService';
import { CloudSyncService } from '../CloudSyncService';

/**
 * D1-3: в офлайне каждый фоновый проход (120 с) считался попыткой отправки:
 * `addCloudCopy` бросает «Not connected to cloud», ошибка транзиентная, и через
 * 10 проходов задача уходила в карантин. Офлайн — пауза для всех типов задач
 * (и выгрузка, и удаление), как при запертом сейфе (F-1), а не израсходованная
 * попытка.
 */

vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));

const USER = 'user_d1_3_offline';
const DOC = 'doc_d1_3';

function setOnline(on: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
}

const task = () => getLocalDb(USER).then(db => db.get('syncQueue', `sync_${DOC}`));

beforeEach(async () => {
  const db = await getLocalDb(USER);
  await db.clear('documents');
  await db.clear('syncQueue');
  vi.restoreAllMocks();
  setOnline(false);
  vi.spyOn(CloudSyncService, 'relinkOrphanedDocuments').mockResolvedValue(undefined as never);
  vi.spyOn(CloudSyncService, 'removeCloudCopy').mockResolvedValue(undefined as never);
  vi.spyOn(StorageService, 'addCloudCopy').mockImplementation(async () => {
    throw new Error('Not connected to cloud');
  });

  await db.put('documents', {
    id: DOC, guestId: USER, title: 'n', currentVersion: 2, totalWords: 10,
    totalDuration: 10, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1,
    tags: [], linkedCloudId: 'cloud_d1_3',
  } as never);
  await db.put('syncQueue', {
    id: `sync_${DOC}`, documentId: DOC, type: 'document', createdAt: Date.now(), ownerId: USER,
  } as never);
  await db.put('syncQueue', {
    id: `sync_delete_${DOC}`, documentId: DOC, type: 'delete', createdAt: Date.now(), ownerId: USER,
  } as never);
});

describe('D1-3: офлайн не ждёт попыток и не карантинит очередь', () => {
  it('10 проходов без сети — задача жива и без попыток; сеть вернулась — уезжает', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await SyncService.syncPending(USER);
      expect(res).toEqual({ drained: 0, failed: 0, skippedReason: 'offline' });
    }

    expect(StorageService.addCloudCopy, 'в офлайне ни одного обращения к облаку').not.toHaveBeenCalled();
    expect(CloudSyncService.removeCloudCopy, 'удаление в офлайне тоже пауза, а не попытка').not.toHaveBeenCalled();
    const paused = await task();
    expect(paused?.attempts ?? 0).toBe(0);
    expect(paused?.dead ?? false).toBe(false);
    expect(paused?.lastError, 'пауза не оставляет следа в журнале попыток').toBeUndefined();
    expect(await SyncService.getPendingCount(USER), 'обе задачи ждут в очереди').toBe(2);
    expect(await SyncService.getDeadCount(USER)).toBe(0);

    setOnline(true);
    vi.mocked(StorageService.addCloudCopy).mockResolvedValue('cloud_d1_3');
    const res = await SyncService.syncPending(USER);

    expect(res.drained).toBe(2);
    expect(StorageService.addCloudCopy).toHaveBeenCalledTimes(1);
    expect(CloudSyncService.removeCloudCopy).toHaveBeenCalledTimes(1);
    expect(await task()).toBeUndefined();
    expect(await SyncService.getPendingCount(USER)).toBe(0);
  });
});
