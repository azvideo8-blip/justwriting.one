import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { LOCK_TTL_MS } from '../../sync/withDocumentLock';

const doc: { id: string; linkedCloudId?: string } = { id: 'loc1' };
vi.mock('../LocalStorageService', () => ({
  LocalStorageService: {
    getDocument: vi.fn(async () => ({ ...doc })),
    deleteDocument: vi.fn(async () => true),
  },
}));
vi.mock('../CloudSyncService', () => ({ CloudSyncService: { removeCloudCopy: vi.fn(async () => {}) } }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { StorageService } from '../StorageService';
import { LocalStorageService } from '../LocalStorageService';
import { CloudSyncService } from '../CloudSyncService';
import { reportError } from '../../../shared/errors/reportError';

const USER = 'u_a2_lockwait';
const LOCK_KEY = 'lock_cloud_loc1';
const UPLOADER_TOKEN = 'uploader';

// Кто владел замком в момент, когда удаление дошло до локального ряда.
let lockOwnerAtDelete: string | null | undefined;

// A-2 (R2-005, R2-029): замок омолаживается heartbeat'ом каждые ttl/3, поэтому
// «занят» может значить «работает» хоть десять минут. Старый код ждал 20 × 500 мс
// и удалял в обход замка — выгрузка дописывала облачный ряд поверх удаления, и
// заметка возвращалась из облака.
async function holdLiveLock(localId: string) {
  const db = await getLocalDb(USER);
  await db.put('syncQueue', {
    id: `lock_cloud_${localId}`,
    documentId: localId,
    type: 'document' as const,
    createdAt: Date.now(),
    ownerToken: UPLOADER_TOKEN,
  });
  const heartbeat = setInterval(() => {
    void (async () => {
      const cur = await db.get('syncQueue', `lock_cloud_${localId}`);
      if (cur) await db.put('syncQueue', { ...cur, createdAt: Date.now() });
    })();
  }, Math.floor(LOCK_TTL_MS / 3));
  return {
    release: async () => {
      clearInterval(heartbeat);
      await db.delete('syncQueue', `lock_cloud_${localId}`);
    },
  };
}

describe('A-2: deleteDocument never deletes outside the document lock', () => {
  beforeEach(async () => {
    doc.id = 'loc1';
    delete doc.linkedCloudId;
    lockOwnerAtDelete = undefined;
    vi.mocked(LocalStorageService.getDocument).mockClear();
    vi.mocked(LocalStorageService.deleteDocument)
      .mockClear()
      .mockImplementation(async () => {
        const row = await (await getLocalDb(USER)).get('syncQueue', LOCK_KEY);
        lockOwnerAtDelete = row ? row.ownerToken ?? '(no token)' : null;
        return true;
      });
    vi.mocked(CloudSyncService.removeCloudCopy).mockClear();
    vi.mocked(reportError).mockClear();
    // setImmediate/queueMicrotask не подменяем: на них держится fake-indexeddb,
    // с полным набором таймеров транзакции не завершаются никогда.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const db = await getLocalDb(USER);
    await db.clear('syncQueue');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not delete the local row while the uploader still owns the lock', async () => {
    const lock = await holdLiveLock('loc1');
    doc.linkedCloudId = 'cloud1';
    const deleting = StorageService.deleteDocument(USER, 'loc1');

    // Старый код сдавался на ~10-й секунде фейкового времени и удалял без замка;
    // новый ждёт до потолка LOCK_TTL_MS * 2.
    for (let t = 0; t < 30_000; t += 500) {
      await vi.advanceTimersByTimeAsync(500);
      if (lockOwnerAtDelete !== undefined) break;
    }
    expect(lockOwnerAtDelete).not.toBe(UPLOADER_TOKEN);

    await lock.release();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(deleting).resolves.toMatchObject({ derivativesOk: true });
    // Удаление всё-таки дошло — но уже под нашим замком, а не в обход чужого.
    expect(lockOwnerAtDelete).toBeDefined();
    expect(lockOwnerAtDelete).not.toBe(UPLOADER_TOKEN);
    expect(CloudSyncService.removeCloudCopy).toHaveBeenCalledWith(USER, 'cloud1');
  }, 30_000);

  it('past the ceiling refuses instead of orphaning the cloud row an upload is creating', async () => {
    const lock = await holdLiveLock('loc1');
    const deleting = StorageService.deleteDocument(USER, 'loc1');

    await vi.advanceTimersByTimeAsync(LOCK_TTL_MS * 2 + 5_000);
    await expect(deleting).resolves.toEqual({ cloudSynced: false, derivativesOk: false });

    expect(LocalStorageService.deleteDocument).not.toHaveBeenCalled();
    expect(CloudSyncService.removeCloudCopy).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'deleteDocument_lockTimeout', documentId: 'loc1' }),
      'warning',
    );
    await lock.release();
  });

  it('past the ceiling records the local intent and queues a known cloud row', async () => {
    doc.linkedCloudId = 'cloud1';
    const lock = await holdLiveLock('loc1');
    const deleting = StorageService.deleteDocument(USER, 'loc1');

    await vi.advanceTimersByTimeAsync(LOCK_TTL_MS * 2 + 5_000);
    await expect(deleting).resolves.toEqual({ cloudSynced: false, derivativesOk: true });

    expect(LocalStorageService.deleteDocument).toHaveBeenCalledWith('loc1', USER, {
      remove: true,
      cloudId: 'cloud1',
    });
    expect(CloudSyncService.removeCloudCopy).not.toHaveBeenCalled();
    await lock.release();
  });
});
