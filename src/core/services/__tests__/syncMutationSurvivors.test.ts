// F-2: каждый тест здесь — поломка, которую пережил весь набор тестов слоя
// синхронизации (docs/sync-mutation-sweep.md, id в названии). Тест написан
// после того, как сломанный код прошёл зелёным, и проверен красным на поломке.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { SyncService } from '../SyncService';
import { StorageService } from '../StorageService';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { VersionService } from '../VersionService';
import { LocalStorageService } from '../LocalStorageService';
import { LocalDocumentService } from '../LocalDocumentService';
import * as authModule from '../../auth';
import { setEncryptionEnabled, setProfileLoaded } from '../../crypto/cryptoHelpers';
import { generateDataKey, setSessionKey, clearSessionKey } from '../../crypto/encrypt';

const USER = 'user_survivors';

async function seedDoc(id: string, overrides?: Record<string, unknown>) {
  const db = await getLocalDb(USER);
  await db.put('documents', {
    id, guestId: USER, title: 'n', currentVersion: 1, totalWords: 1,
    totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1,
    tags: [], linkedCloudId: '',
    ...overrides,
  } as never);
}

async function queueTask(documentId: string) {
  const db = await getLocalDb(USER);
  await db.put('syncQueue', { id: `sync_${documentId}`, documentId, type: 'document' as const, createdAt: Date.now(), ownerId: USER });
}

beforeEach(async () => {
  setProfileLoaded(USER, true);
  setEncryptionEnabled(USER, false);
  const db = await getLocalDb(USER);
  await db.clear('documents');
  await db.clear('syncQueue');
  await db.clear('versions');
  vi.restoreAllMocks();
});

describe('SyncService (ss-*)', () => {
  // ss-02: если облако не прочиталось, ручная выгрузка обязана отказать, а не
  // выгружать вслепую — иначе заметка с потерянной ссылкой уедет вторым документом.
  it('ss-02: syncAllUnlinked refuses to upload when the relink check itself fails', async () => {
    await seedDoc('d_relink_fails');
    vi.spyOn(CloudSyncService, 'relinkOrphanedDocuments').mockRejectedValue(new Error('cloud unreadable'));
    const upload = vi.spyOn(StorageService, 'addCloudCopy').mockResolvedValue('cloud_x');

    await expect(SyncService.syncAllUnlinked(USER)).rejects.toThrow('cloud unreadable');
    expect(upload).not.toHaveBeenCalled();
  });

  // ss-06: '' от addCloudCopy = параллельный проход держит lock. Задачи документа
  // должны остаться в очереди, иначе правка никогда не повторится.
  it('ss-06: syncDocument keeps the queue when addCloudCopy returns an empty cloudId', async () => {
    await seedDoc('d_lock_held');
    await queueTask('d_lock_held');
    vi.spyOn(StorageService, 'addCloudCopy').mockResolvedValue('');

    expect(await SyncService.syncDocument(USER, 'd_lock_held')).toBe(false);
    const db = await getLocalDb(USER);
    expect(await db.get('syncQueue', 'sync_d_lock_held')).toBeDefined();
  });

  // ss-10: If the relink check fails the drain uploads blind with an empty skip-set
  it('ss-10: drainPendingQueue refuses to upload when relink check fails', async () => {
    await seedDoc('d_ss10');
    await queueTask('d_ss10');
    vi.spyOn(CloudSyncService, 'relinkOrphanedDocuments').mockRejectedValue(new Error('relink check failed'));
    const addCloudCopy = vi.spyOn(StorageService, 'addCloudCopy');

    const res = await SyncService.syncPending(USER, { force: true });
    expect(addCloudCopy).not.toHaveBeenCalled();
    expect(res.failed).toBe(1);
    const db = await getLocalDb(USER);
    expect(await db.get('syncQueue', 'sync_d_ss10')).toBeDefined();
  });

  // ss-12: Drain uploads notes whose relink was skipped because the lock was held
  it('ss-12: drainPendingQueue skips notes in skippedSet from relink', async () => {
    await seedDoc('d_ss12');
    await queueTask('d_ss12');
    vi.spyOn(CloudSyncService, 'relinkOrphanedDocuments').mockResolvedValue({
      relinked: 0,
      skippedIds: ['d_ss12'],
    });
    const addCloudCopy = vi.spyOn(StorageService, 'addCloudCopy');

    await SyncService.syncPending(USER, { force: true });
    expect(addCloudCopy).not.toHaveBeenCalledWith(USER, 'd_ss12');
  });
});

describe('StorageService (st-*)', () => {
  // st-02: A retried cloud delete has no owner stamp
  it('st-02: deleteDocument stamps ownerId on queued delete task when cloud delete fails', async () => {
    vi.spyOn(CloudSyncService, 'removeCloudCopy').mockRejectedValue(new Error('network error'));
    await StorageService.deleteDocument(USER, undefined, 'cloud_del_st02');

    const db = await getLocalDb(USER);
    const tasks = await db.getAll('syncQueue');
    const deleteTasks = tasks.filter(t => t.type === 'delete' && t.documentId === 'cloud_del_st02');
    expect(deleteTasks).toHaveLength(1);
    expect(deleteTasks[0]?.ownerId).toBe(USER);
  });

  // st-03: Restore-from-trash that fails in the cloud is never retried
  it('st-03: restoreDocument queues metadata retry when cloud restore fails', async () => {
    await seedDoc('d_st03');
    vi.spyOn(DocumentService, 'restoreDocument').mockRejectedValue(new Error('cloud offline'));

    const res = await StorageService.restoreDocument(USER, 'd_st03', 'cloud_st03');
    expect(res.cloudSynced).toBe(false);

    const db = await getLocalDb(USER);
    const tasks = await db.getAll('syncQueue');
    const retryTasks = tasks.filter(t => t.documentId === 'd_st03');
    expect(retryTasks.length).toBeGreaterThan(0);
    const doc = await db.get('documents', 'd_st03');
    expect(doc?.metadataDirty).toBe(true);
  });
});

describe('CloudSyncService (csc-*)', () => {
  // csc-05: addLocalCopy no longer short-circuits on an already-linked note
  it('csc-05: addLocalCopy returns existing localId without creating duplicate when note is already linked', async () => {
    await seedDoc('d_csc05', { linkedCloudId: 'cloud_csc05' });
    const getDocSpy = vi.spyOn(DocumentService, 'getDocument');

    const result = await CloudSyncService.addLocalCopy(USER, 'cloud_csc05');
    expect(result).toBe('d_csc05');
    expect(getDocSpy).not.toHaveBeenCalled();
  });

  // csc-06: Downloaded notes lose their canonical uuid
  it('csc-06: addLocalCopy preserves cloud uuid on downloaded note when not trashed', async () => {
    vi.spyOn(DocumentService, 'getDocument').mockResolvedValue({
      id: 'cloud_csc06',
      uuid: 'canonical_uuid_csc06',
      title: 'Title',
      currentVersion: 1,
      totalWords: 5,
      tags: [],
    } as never);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([
      { id: 'v1', version: 1, content: 'Text', savedAt: new Date().toISOString() } as never,
    ]);

    const localId = await CloudSyncService.addLocalCopy(USER, 'cloud_csc06');
    const db = await getLocalDb(USER);
    const doc = await db.get('documents', localId);
    expect(doc?.uuid).toBe('canonical_uuid_csc06');
  });

  // csc-19: In the two-tab race the WINNER's cloud doc is deleted instead of our duplicate
  it('csc-19: addCloudCopy deletes our duplicate cloud doc when concurrent tab linked first', async () => {
    await seedDoc('d_csc19');
    const db = await getLocalDb(USER);
    await db.put('versions', {
      id: 'v_csc19',
      documentId: 'd_csc19',
      guestId: USER,
      version: 1,
      content: 'Race test',
      wordCount: 2,
      wordsAdded: 2,
      charsAdded: 9,
      duration: 1,
      wpm: 1,
      savedAt: new Date(),
    } as never);

    vi.spyOn(DocumentService, 'createDocument').mockResolvedValue('cloud_dup_19' as never);
    vi.spyOn(VersionService, 'addVersion').mockImplementation(async () => {
      // Simulate another tab winning the race while upload was in flight:
      await LocalStorageService.updateLinkedCloudId('d_csc19', 'cloud_winner_19', USER);
      return 'v1' as never;
    });
    vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockResolvedValue(undefined as never);
    const deleteDocSpy = vi.spyOn(DocumentService, 'deleteDocument').mockResolvedValue(undefined as never);

    const result = await CloudSyncService.addCloudCopy(USER, 'd_csc19');
    expect(result).toBe('cloud_winner_19');
    expect(deleteDocSpy).toHaveBeenCalledWith(USER, 'cloud_dup_19');
    expect(deleteDocSpy).not.toHaveBeenCalledWith(USER, 'cloud_winner_19');
  });

  // csc-29: Background push finishing after an account switch writes to previous owner DB
  it('csc-29: syncVersionToCloud writes lastSyncedCloudVersion to note owner DB even after account switch', async () => {
    const USER_A = 'user_acc_A_29';
    const USER_B = 'user_acc_B_29';
    setProfileLoaded(USER_A, true);
    setEncryptionEnabled(USER_A, false);
    setProfileLoaded(USER_B, true);
    setEncryptionEnabled(USER_B, false);

    const dbA = await getLocalDb(USER_A);
    await dbA.clear('documents');
    await dbA.put('documents', {
      id: 'd_csc29',
      guestId: USER_A,
      title: 'Title A',
      currentVersion: 2,
      totalWords: 5,
      totalDuration: 5,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
      linkedCloudId: 'cloud_csc29',
    } as never);

    const dbB = await getLocalDb(USER_B);
    await dbB.clear('documents');

    let activeUser: string = USER_A;
    vi.spyOn(authModule, 'getCurrentUser').mockImplementation(() => ({
      uid: activeUser,
      email: `${activeUser}@test.local`,
      displayName: null,
      photoURL: null,
      metadata: { creationTime: null, lastSignInTime: null },
    }));

    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue({ id: 'cloud_csc29', currentVersion: 1 } as never);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([
      { id: 'v1', version: 1, content: 'Base' } as never,
    ]);
    vi.spyOn(VersionService, 'addVersion').mockImplementation(async () => {
      // Account switch occurs while network call is in flight
      activeUser = USER_B;
      return 'v2';
    });
    vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockResolvedValue(undefined as never);

    await CloudSyncService.syncVersionToCloud(
      USER_A,
      'd_csc29',
      'cloud_csc29',
      {
        title: 'Title A',
        content: 'New content',
        tags: [],
        wordCount: 2,
        duration: 1,
        wpm: 1,
        sessionStartedAt: new Date(),
      } as never,
      2,
      'Base'
    );

    // USER_B DB must NOT have USER_A's document
    const leakedDoc = await dbB.get('documents', 'd_csc29');
    expect(leakedDoc).toBeUndefined();

    // USER_A DB must have lastSyncedCloudVersion updated
    const updatedA = await dbA.get('documents', 'd_csc29');
    expect(updatedA?.lastSyncedCloudVersion).toBe(2);
  });

  // csc-32: A cloud doc already linked to one local note can be re-linked to a second local note sharing the uuid
  it('csc-32: relinkOrphanedDocuments skips cloud docs whose id is already taken by a local note', async () => {
    const db = await getLocalDb(USER);
    // Note 1: already linked to cloud_taken, has uuid_taken
    await db.put('documents', {
      id: 'd_linked_1',
      guestId: USER,
      title: 'Note 1',
      currentVersion: 1,
      totalWords: 5,
      totalDuration: 5,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
      uuid: 'uuid_taken_32',
      linkedCloudId: 'cloud_taken',
    } as never);
    // Note 2: unlinked, has uuid_target
    await db.put('documents', {
      id: 'd_unlinked_2',
      guestId: USER,
      title: 'Note 2',
      currentVersion: 1,
      totalWords: 5,
      totalDuration: 5,
      sessionsCount: 1,
      firstSessionAt: 2000,
      lastSessionAt: 2000,
      tags: [],
      uuid: 'uuid_target_32',
      linkedCloudId: '',
    } as never);

    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([
      { id: 'cloud_taken', uuid: 'uuid_target_32', title: 'Note 2' } as never,
    ]);

    await CloudSyncService.relinkOrphanedDocuments(USER);

    const doc2 = await db.get('documents', 'd_unlinked_2');
    expect(doc2?.linkedCloudId).toBeFalsy();
  });
});

describe('LocalDocumentService (ld-*)', () => {
  // ld-09: Owner migration silently no-ops
  it('ld-09: migrateDocumentOwner updates guestId on document when guestId differs from newOwnerId', async () => {
    const db = await getLocalDb(USER);
    await db.put('documents', {
      id: 'd_ld09',
      guestId: 'guest_previous',
      title: 'Guest Note',
      currentVersion: 1,
      totalWords: 5,
      totalDuration: 5,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
      linkedCloudId: '',
    } as never);

    await LocalDocumentService.migrateDocumentOwner('d_ld09', USER, USER);

    const doc = await db.get('documents', 'd_ld09');
    expect(doc?.guestId).toBe(USER);
  });

  // ld-10: Owner filter dropped
  it('ld-10: getDocumentsByOwner filters out documents belonging to another owner in the same DB', async () => {
    const db = await getLocalDb(USER);
    await db.put('documents', {
      id: 'd_own_10',
      guestId: USER,
      title: 'Own Doc',
      currentVersion: 1,
      totalWords: 5,
      totalDuration: 5,
      sessionsCount: 1,
      firstSessionAt: 2000,
      lastSessionAt: 2000,
      tags: [],
    } as never);
    await db.put('documents', {
      id: 'd_other_10',
      guestId: 'guest_other_user',
      title: 'Other Doc',
      currentVersion: 1,
      totalWords: 5,
      totalDuration: 5,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
    } as never);

    const docs = await LocalDocumentService.getDocumentsByOwner(USER);
    expect(docs.map(d => d.id)).toEqual(['d_own_10']);
  });
});

// Находки в прод-коде из отчёта F-2.
describe('bugs found by the sweep', () => {
  // F-2 отчёт, баг B-1: повтор записи версии после коллизии номеров
  // (split metadata) отправляет mood открытым текстом при _encrypted: true.
  // Первая попытка шифрует mood, повтор берёт data.mood как есть.
  it('B-1: split-metadata retry keeps mood encrypted', async () => {
    setProfileLoaded(USER, true);
    setEncryptionEnabled(USER, true);
    setSessionKey(await generateDataKey());
    try {
      const docId = await LocalStorageService.createDocument(USER, { title: 'm', tags: [] });
      await LocalStorageService.updateLinkedCloudId(docId, 'cloud_mood', USER);
      vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue({ id: 'cloud_mood', currentVersion: 1 } as never);
      let calls = 0;
      vi.spyOn(VersionService, 'getVersions').mockImplementation(async () => {
        calls++;
        return calls === 1
          ? [{ id: 'v1', version: 1, content: 'Base' } as never]
          : [{ id: 'v1', version: 1, content: 'Base' } as never, { id: 'v2', version: 2, content: 'x' } as never];
      });
      const moods: unknown[] = [];
      vi.spyOn(VersionService, 'addVersion').mockImplementation(async (_u, _c, data) => {
        moods.push(data.mood);
        if (moods.length === 1) throw new Error('duplicate key value violates unique constraint');
        return `v${data.versionNumber}`;
      });
      vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockResolvedValue(undefined as never);

      await CloudSyncService.syncVersionToCloud(USER, docId, 'cloud_mood', {
        title: 'm', content: 'New text', tags: [], wordCount: 2, duration: 1, wpm: 1,
        sessionStartedAt: new Date(), mood: '😊',
      } as never, 2, 'Base');

      expect(moods).toHaveLength(2);
      expect(moods[0]).not.toBe('😊');
      expect(moods[1]).not.toBe('😊');
    } finally {
      clearSessionKey();
      setEncryptionEnabled(USER, false);
    }
  });
});

