import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { SyncService } from '../SyncService';
import { LocalDocumentService } from '../LocalDocumentService';
import { DocumentService } from '../DocumentService';
import { getLocalDb } from '../../storage/localDb';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

const USER = 'user_a6_snapshot';

// R2-028: счёт «отстаёт» сравнивал currentVersion из снимка, прочитанного до
// сетевого вызова, с отметкой синхронизации, записанной после него. Сохранение
// в середине прохода (реальный случай — автосохранение, пока тянутся версии с
// другого устройства) смещало счётчик на единицу: заметка выглядела
// синхронизированной, хотя её новая версия в облако ещё не ехала.
describe('A-6 (R2-028): getUnsyncedSummary compares versions read at the same moment', () => {
  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(USER), 'true');
    const db = await getLocalDb(USER);
    const tx = db.transaction(['documents', 'syncQueue'], 'readwrite');
    await Promise.all([tx.objectStore('documents').clear(), tx.objectStore('syncQueue').clear(), tx.done]);
  });

  afterEach(() => vi.restoreAllMocks());

  it('замечает версию, сохранённую во время облачного запроса', async () => {
    const docId = await LocalDocumentService.createDocument(USER, { title: 'Note' });
    await LocalDocumentService.updateLinkedCloudId(docId, 'cloud_1', USER);
    await LocalDocumentService.updateDocument(docId, { currentVersion: 1 }, USER);

    vi.spyOn(DocumentService, 'getCloudDocumentVersions').mockImplementation(async () => {
      // Пользователь дописал абзац, пока запрос к облаку в полёте.
      await LocalDocumentService.updateDocument(docId, { currentVersion: 2 }, USER);
      return new Map([['cloud_1', 1]]);
    });

    const summary = await SyncService.getUnsyncedSummary(USER);

    expect(summary.behindCount).toBe(1);
    expect(summary.hasUnknown).toBe(false);
  });

  it('не придумывает отставание, когда локальная версия и есть облачная', async () => {
    const docId = await LocalDocumentService.createDocument(USER, { title: 'Note' });
    await LocalDocumentService.updateLinkedCloudId(docId, 'cloud_1', USER);
    await LocalDocumentService.updateDocument(docId, { currentVersion: 2 }, USER);
    vi.spyOn(DocumentService, 'getCloudDocumentVersions').mockResolvedValue(new Map([['cloud_1', 2]]));

    expect((await SyncService.getUnsyncedSummary(USER)).behindCount).toBe(0);
  });
});
