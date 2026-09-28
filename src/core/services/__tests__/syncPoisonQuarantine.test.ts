import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CloudSyncService } from '../CloudSyncService';
import { SyncService } from '../SyncService';
import { DocumentService } from '../DocumentService';
import { getLocalDb } from '../../storage/localDb';

const USER = 'user_poison_test';

describe('A-2.2 (F-053): poison errors write a dead task to syncQueue', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    const db = await getLocalDb(USER);
    await db.clear('documents');
    await db.clear('versions');
    await db.clear('syncQueue');
    await db.put('documents', {
      id: 'doc_poison_1',
      guestId: USER,
      title: 'Title',
      currentVersion: 1,
      totalWords: 10,
      totalDuration: 10,
      sessionsCount: 1,
      firstSessionAt: Date.now(),
      lastSessionAt: Date.now(),
      tags: [],
      linkedCloudId: 'cloud_poison_1',
    } as never);
    await db.put('versions', {
      id: 'ver_1',
      documentId: 'doc_poison_1',
      versionNumber: 1,
      content: 'hello',
      sessionStartedAt: new Date(),
      wordCount: 10,
      duration: 10,
      wpm: 60,
    } as never);
  });

  const dummyData = {
    title: 'Title',
    tags: [],
    content: 'hello',
    wordCount: 10,
    duration: 10,
    wpm: 60,
    sessionStartedAt: new Date(),
  };

  it('ENCRYPT_REQUIRED writes a dead task with lastError that reviveLockedTasks revives', async () => {
    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockRejectedValue(new Error('ENCRYPT_REQUIRED'));

    const res = await CloudSyncService.syncVersionToCloud(USER, 'doc_poison_1', 'cloud_poison_1', dummyData, 2, 'hello');
    expect(res.cloudSynced).toBe(false);

    const db = await getLocalDb(USER);
    const task = await db.get('syncQueue', 'sync_doc_poison_1');
    expect(task).toBeDefined();
    expect(task?.dead).toBe(true);
    expect(task?.lastError).toBe('ENCRYPT_REQUIRED');

    const revivedCount = await SyncService.reviveLockedTasks(USER);
    expect(revivedCount).toBe(1);

    const taskAfter = await db.get('syncQueue', 'sync_doc_poison_1');
    expect(taskAfter?.dead).toBe(false);
  });

  it('DECRYPTION_ERROR writes a dead task and is NOT revived by reviveLockedTasks', async () => {
    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockRejectedValue(new Error('DECRYPTION_ERROR'));

    const res = await CloudSyncService.syncVersionToCloud(USER, 'doc_poison_1', 'cloud_poison_1', dummyData, 2, 'hello');
    expect(res.cloudSynced).toBe(false);

    const db = await getLocalDb(USER);
    const task = await db.get('syncQueue', 'sync_doc_poison_1');
    expect(task).toBeDefined();
    expect(task?.dead).toBe(true);
    expect(task?.lastError).toBe('DECRYPTION_ERROR');

    const revivedCount = await SyncService.reviveLockedTasks(USER);
    expect(revivedCount).toBe(0);

    const taskAfter = await db.get('syncQueue', 'sync_doc_poison_1');
    expect(taskAfter?.dead).toBe(true);
  });

  // csc-30: перепутать ветки — «временную ошибку в карантин, ядовитую в повтор» —
  // матрица постулатов не ловит (задача есть в обоих случаях). Ловит эта проверка.
  it('a transient error (network) requeues a LIVE task — not dead, without lastError', async () => {
    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockRejectedValue(new TypeError('Failed to fetch'));

    const res = await CloudSyncService.syncVersionToCloud(USER, 'doc_poison_1', 'cloud_poison_1', dummyData, 2, 'hello');
    expect(res.cloudSynced).toBe(false);

    const db = await getLocalDb(USER);
    const task = await db.get('syncQueue', 'sync_doc_poison_1');
    expect(task).toBeDefined();
    expect(task?.dead).toBeFalsy();
    expect(task?.lastError).toBeUndefined();
    expect(task?.updatedAt).toBeTypeOf('number');
  });
});
