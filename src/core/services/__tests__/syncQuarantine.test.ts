// AUDIT-H4: poison-pill задачи (детерминированные ошибки) карантинятся сразу,
// остальные — после MAX_ATTEMPTS неудач; карантинная задача не дренируется.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { SyncService } from '../SyncService';
import { StorageService } from '../StorageService';
import { CloudSyncService } from '../CloudSyncService';
import { reportError } from '../../../shared/errors/reportError';

vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));

const USER = 'user_quarantine';

async function seedDoc(id: string) {
  const db = await getLocalDb();
  await db.put('documents', {
    id, guestId: USER, title: 'n', currentVersion: 1, totalWords: 1,
    totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1,
    tags: [], linkedCloudId: '',
  } as never);
}

async function queueTask(documentId: string) {
  const db = await getLocalDb();
  await db.put('syncQueue', {
    id: `sync_${documentId}_${Date.now()}`,
    documentId,
    type: 'document' as const,
    createdAt: Date.now(),
    ownerId: USER,
  });
}

async function getTasks() {
  const db = await getLocalDb();
  return (await db.getAll('syncQueue')).filter(i => i.id.startsWith('sync_'));
}

beforeEach(async () => {
  const db = await getLocalDb();
  for (const rec of await db.getAll('documents')) await db.delete('documents', (rec as { id: string }).id);
  for (const rec of await db.getAll('syncQueue')) await db.delete('syncQueue', (rec as { id: string }).id);
  vi.restoreAllMocks();
  vi.spyOn(CloudSyncService, 'relinkOrphanedDocuments').mockResolvedValue(undefined as never);
  vi.spyOn(await import('../../../shared/errors/reportError'), 'reportError').mockImplementation(() => {});
});

describe('AUDIT-H4 sync queue quarantine', () => {
  it('deterministic error quarantines the task on the first drain', async () => {
    await seedDoc('doc_det');
    await queueTask('doc_det');
    vi.spyOn(StorageService, 'addCloudCopy')
      .mockRejectedValue(new Error('LOCKED: cannot add cloud copy of locked document'));

    await SyncService.syncPending(USER);

    const tasks = await getTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.dead).toBe(true);
    // Карантин репортится.
    expect(reportError).toHaveBeenCalled();
  });

  it('quarantined task is not retried by later drains', async () => {
    await seedDoc('doc_dead');
    await queueTask('doc_dead');
    const spy = vi.spyOn(StorageService, 'addCloudCopy')
      .mockRejectedValue(new Error('DECRYPTION_ERROR: unreadable'));

    await SyncService.syncPending(USER); // карантин
    expect(spy).toHaveBeenCalledTimes(1);

    vi.mocked(StorageService.addCloudCopy).mockResolvedValue('cloud_x');
    await SyncService.syncPending(USER); // дренаж не должен тронуть dead-задачу
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('transient errors retry up to MAX_ATTEMPTS, then quarantine', async () => {
    await seedDoc('doc_flaky');
    await queueTask('doc_flaky');
    const spy = vi.spyOn(StorageService, 'addCloudCopy').mockRejectedValue(new Error('network down'));

    // MAX_ATTEMPTS = 10 в SyncService. Девять проходов — ещё жива, десятый — карантин.
    for (let i = 0; i < 9; i++) await SyncService.syncPending(USER);
    let tasks = await getTasks();
    expect(tasks[0]!.dead ?? false).toBe(false);
    expect(tasks[0]!.attempts).toBe(9);

    await SyncService.syncPending(USER);
    tasks = await getTasks();
    expect(tasks[0]!.dead).toBe(true);
    expect(spy).toHaveBeenCalledTimes(10);
  });

  it('successful drain clears the attempts counter path (no false quarantine)', async () => {
    await seedDoc('doc_ok');
    await queueTask('doc_ok');
    vi.spyOn(StorageService, 'addCloudCopy').mockResolvedValue('cloud_1');

    await SyncService.syncPending(USER);
    expect(await getTasks()).toHaveLength(0);
  });

  it('concurrent lock loss (addCloudCopy returns empty string) records no failure and no attempt bump (AG-QUAR-1)', async () => {
    await seedDoc('doc_lock_loss');
    await queueTask('doc_lock_loss');
    // Lock contention returns ''
    vi.spyOn(StorageService, 'addCloudCopy').mockResolvedValue('');

    const res = await SyncService.syncPending(USER);
    expect(res.failed).toBe(0);

    const tasks = await getTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.attempts ?? 0).toBe(0);
    expect(tasks[0]!.dead ?? false).toBe(false);
  });

  it('device-only note and tombstoned note drain without incrementing attempts (AG-QUAR-1)', async () => {
    await seedDoc('doc_device_only');
    await queueTask('doc_device_only');
    // Device-only / tombstone returns '' after cleanup
    vi.spyOn(StorageService, 'addCloudCopy').mockResolvedValue('');

    const res = await SyncService.syncPending(USER);
    expect(res.failed).toBe(0);

    const tasks = await getTasks();
    expect(tasks[0]!.attempts ?? 0).toBe(0);
    expect(tasks[0]!.dead ?? false).toBe(false);
  });

  it('quarantined task can be revived via retryQuarantinedTasks and reviveLockedTasks and drains afterwards (AG-QUAR-1)', async () => {
    await seedDoc('doc_revive');
    await queueTask('doc_revive');
    const db = await getLocalDb();
    const tasks = await getTasks();
    const taskId = tasks[0]!.id;

    // Simulate task quarantined with SYNC_UNRESOLVED
    await db.put('syncQueue', {
      ...tasks[0]!,
      dead: true,
      attempts: 10,
      lastError: 'SYNC_UNRESOLVED: unreadable cloud version cannot be compared',
    });

    // 1. Revive via reviveLockedTasks
    const revivedCount = await SyncService.reviveLockedTasks(USER);
    expect(revivedCount).toBe(1);

    let currentTask = await db.get('syncQueue', taskId);
    expect(currentTask?.dead).toBe(false);
    expect(currentTask?.attempts).toBe(0);

    // Re-quarantine to test retryQuarantinedTasks
    await db.put('syncQueue', {
      ...currentTask!,
      dead: true,
      attempts: 10,
      lastError: 'Some other persistent error',
    });

    // 2. Revive via retryQuarantinedTasks
    const retryCount = await SyncService.retryQuarantinedTasks(USER);
    expect(retryCount).toBe(1);

    currentTask = await db.get('syncQueue', taskId);
    expect(currentTask?.dead).toBe(false);
    expect(currentTask?.attempts).toBe(0);

    // 3. Successfully drains afterwards
    vi.spyOn(StorageService, 'addCloudCopy').mockResolvedValue('cloud_revived');
    await SyncService.syncPending(USER);
    expect(await getTasks()).toHaveLength(0);
  });

  // N-52: сбой записи счётчика попыток у одной задачи не должен оставить в
  // очереди уже выгруженную другую — иначе её выгрузят в облако ещё раз.
  it('a failing attempt-counter write does not keep an uploaded task in the queue', async () => {
    await seedDoc('doc_ok');
    await seedDoc('doc_bad');
    await queueTask('doc_ok');
    await queueTask('doc_bad');
    vi.spyOn(StorageService, 'addCloudCopy').mockImplementation(async (_u, id) => {
      if (id === 'doc_bad') throw new Error('network');
      return 'cloud_ok';
    });
    const origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (value && typeof value === 'object' && 'lastError' in (value as object)) throw new DOMException('quota', 'QuotaExceededError');
      return origPut.call(this, value, key);
    };
    try {
      await SyncService.syncPending(USER).catch(() => undefined);
    } finally {
      IDBObjectStore.prototype.put = origPut;
    }
    const left = (await getTasks()).map(t => t.documentId);
    expect(left).not.toContain('doc_ok');
  });
});
