import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';

/**
 * SB-2: удаление заметки из облака стоит в очереди ДО того, как заметка
 * исчезла с устройства, а не после сетевой попытки.
 *
 * Порядок был обратный: локальная строка удалена → запрос в облако → и только
 * в catch появляется задача 'delete'. Значит всё время полёта (а это сетевой
 * round-trip) удаление висит в воздухе: вкладка умерла — и облако осталось с
 * живым рядом, который downloadAllFromCloud возвращает на устройство по uuid.
 * «Удалил» превращается в «спрятал до следующей синхронизации».
 */

const LOCAL = 'loc_sb2';
const CLOUD = 'cloud_sb2';
const CANON = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeee0002';

const { removeCloudCopy } = vi.hoisted(() => ({ removeCloudCopy: vi.fn() }));

vi.mock('../../data', () => ({
  DataProvider: {
    deleteSummary: vi.fn(async () => undefined),
    deleteEmbedding: vi.fn(async () => undefined),
  },
}));
vi.mock('../../auth', () => ({ getCurrentUser: () => ({ uid: 'u1' }) }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../facetLock', () => ({
  withFacetLock: async (fn: () => Promise<void>) => fn(),
  writeFacetStore: async (fn: (store: unknown) => Promise<void>) => fn({
    getAll: async () => [],
    transaction: () => ({ store: { delete: async () => undefined, put: async () => undefined }, done: Promise.resolve() }),
  }),
}));
vi.mock('../LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreDelete: vi.fn(), scheduleStoreSync: vi.fn() },
}));
vi.mock('../CloudSyncService', () => ({ CloudSyncService: { removeCloudCopy } }));

import { StorageService } from '../StorageService';

async function deleteTasks() {
  const db = await getLocalDb('u1');
  const all = await db.getAll('syncQueue');
  return all.filter(t => t.type === 'delete' && t.documentId === CLOUD);
}

describe('SB-2: постановка удаления облачной копии', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await getLocalDb('u1');
    const tx = db.transaction(['documents', 'syncQueue'], 'readwrite');
    for (const store of ['documents', 'syncQueue'] as const) {
      const rows = (await tx.objectStore(store).getAll()) as Array<{ id: string; documentId?: string }>;
      for (const row of rows) {
        if (row.id === LOCAL || row.id === CLOUD || row.documentId === CLOUD) {
          await tx.objectStore(store).delete(row.id);
        }
      }
    }
    await tx.done;
    await db.put('documents', {
      id: LOCAL,
      uuid: CANON,
      guestId: 'u1',
      linkedCloudId: CLOUD,
      title: 'Заметка',
      currentVersion: 1,
      totalWords: 3,
      totalDuration: 60,
      sessionsCount: 1,
      firstSessionAt: 1,
      lastSessionAt: 1,
      tags: [],
    });
  });

  it('метка удаления есть в очереди, пока облачный ответ ещё в полёте', async () => {
    let release: () => void = () => {};
    removeCloudCopy.mockImplementation(() => new Promise<void>(res => { release = res; }));

    const deleting = StorageService.deleteDocument('u1', LOCAL);
    await vi.waitFor(() => expect(removeCloudCopy).toHaveBeenCalledWith('u1', CLOUD));

    // В этот момент заметки на устройстве уже нет. Если вкладка закроется здесь,
    // очередь — единственное, что помнит про облачный ряд.
    expect(await deleteTasks()).toHaveLength(1);

    release();
    await deleting;
  });

  it('после подтверждённого облачного удаления метка убирается', async () => {
    removeCloudCopy.mockResolvedValue(undefined);

    await StorageService.deleteDocument('u1', LOCAL);

    expect(await deleteTasks()).toHaveLength(0);
  });

  it('при сбое облачного удаления метка остаётся ровно одна', async () => {
    removeCloudCopy.mockRejectedValue(new Error('offline'));

    const res = await StorageService.deleteDocument('u1', LOCAL);

    expect(res.cloudSynced).toBe(false);
    expect(await deleteTasks()).toHaveLength(1);
  });
});
