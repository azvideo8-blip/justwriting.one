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
import { setEncryptionEnabled, setProfileLoaded } from '../../crypto/cryptoHelpers';
import { generateDataKey, setSessionKey, clearSessionKey } from '../../crypto/encrypt';

const USER = 'user_survivors';

async function seedDoc(id: string) {
  const db = await getLocalDb(USER);
  await db.put('documents', {
    id, guestId: USER, title: 'n', currentVersion: 1, totalWords: 1,
    totalDuration: 0, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1,
    tags: [], linkedCloudId: '',
  } as never);
}

async function queueTask(documentId: string) {
  const db = await getLocalDb(USER);
  await db.put('syncQueue', { id: `sync_${documentId}`, documentId, type: 'document' as const, createdAt: Date.now(), ownerId: USER });
}

beforeEach(async () => {
  const db = await getLocalDb(USER);
  await db.clear('documents');
  await db.clear('syncQueue');
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

