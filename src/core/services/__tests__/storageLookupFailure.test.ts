import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';

vi.mock('../LocalStorageService', () => ({
  LocalStorageService: { getDocument: vi.fn(), deleteDocument: vi.fn(async () => true) },
}));
vi.mock('../LocalDocumentService', () => ({
  LocalDocumentService: { trashDocument: vi.fn(async () => {}), restoreDocument: vi.fn(async () => {}), setMetadataDirty: vi.fn(async () => {}) },
}));
vi.mock('../DocumentService', () => ({
  DocumentService: { trashDocument: vi.fn(async () => {}), restoreDocument: vi.fn(async () => {}) },
}));
vi.mock('../CloudSyncService', () => ({ CloudSyncService: { removeCloudCopy: vi.fn(async () => {}) } }));

import { StorageService } from '../StorageService';
import { LocalStorageService } from '../LocalStorageService';
import { LocalDocumentService } from '../LocalDocumentService';
import { CloudSyncService } from '../CloudSyncService';

const U = 'u_lookup';

// Облачный номер заметки берётся из локальной записи. Не прочиталась — где
// лежит облачная копия, неизвестно, и облако не тронуто. Раньше ошибка
// глоталась, а ответ был «в облаке тоже» — удалённая заметка возвращалась
// следующей загрузкой, корзина на других устройствах не появлялась.
describe('не прочиталась локальная запись — облако не объявляется сделанным', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(LocalStorageService.getDocument).mockRejectedValue(new Error('idb read'));
    const db = await getLocalDb(U);
    await db.clear('syncQueue');
  });

  it('удаление', async () => {
    const res = await StorageService.deleteDocument(U, 'loc1');
    expect(CloudSyncService.removeCloudCopy).not.toHaveBeenCalled();
    expect(res.cloudSynced).toBe(false);
  });

  it('корзина: не «в облаке тоже», и метаданные встают в очередь', async () => {
    const res = await StorageService.trashDocument(U, 'loc1');
    expect(res.cloudSynced).toBe(false);
    expect(LocalDocumentService.setMetadataDirty).toHaveBeenCalledWith('loc1', true, U);
    const queue = await (await getLocalDb(U)).getAll('syncQueue');
    expect(queue.map(t => t.documentId)).toContain('loc1');
  });

  it('восстановление из корзины', async () => {
    const res = await StorageService.restoreDocument(U, 'loc1');
    expect(res.cloudSynced).toBe(false);
    expect(LocalDocumentService.setMetadataDirty).toHaveBeenCalledWith('loc1', true, U);
  });
});
