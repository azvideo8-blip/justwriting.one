// DA-11 (владелец 27.11): продолжил заметку на телефоне и в окне «Завершить» поставил
// метку — на телефоне метка есть, на компьютере нет никогда. Продолжение связанной
// заметки слало в облако только версию; название, теги и метка оставались локальными.
// Настоящие StorageService/LocalStorageService/LocalDocumentService над IndexedDB;
// подменены облачные вызовы.
// Мутация: не звать pushChangedMetadata после версии — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));

import { StorageService } from '../StorageService';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { LocalStorageService } from '../LocalStorageService';
import { getLocalDb } from '../../storage/localDb';
import { setEncryptionEnabled, setProfileLoaded } from '../../crypto/cryptoHelpers';

const U = 'user_da11';

const save = (over: object = {}) => StorageService.saveVersion(U, docId, {
  title: 'Название', content: 'Синтетический текст продолжения', wordCount: 3, duration: 10, wpm: 18,
  tags: ['t1'], sessionStartedAt: new Date(1), ...over,
} as never);

let docId = '';

beforeEach(async () => {
  vi.restoreAllMocks();
  setProfileLoaded(U, true);
  setEncryptionEnabled(U, false);
  const db = await getLocalDb(U);
  for (const s of ['documents', 'versions', 'syncQueue'] as const) await db.clear(s);
  docId = await LocalStorageService.createDocument(U, { title: 'Название', tags: ['t1'] });
  await LocalStorageService.updateLinkedCloudId(docId, 'cloud_1', U);
});

describe('DA-11: продолжение заметки отправляет изменённые название, теги и метку', () => {
  it('поставили метку и поменяли теги — уходят в облако сразу после версии, отметка снята', async () => {
    vi.spyOn(CloudSyncService, 'syncVersionToCloud').mockResolvedValue({ forked: false, cloudSynced: true } as never);
    const meta = vi.spyOn(DocumentService, 'updateMetadataFields').mockResolvedValue(undefined);

    await save({ labelId: 'L1', tags: ['t1', 't2'] });

    expect(meta).toHaveBeenCalledTimes(1);
    const [, cloudId, payload, fields] = meta.mock.calls[0]!;
    expect(cloudId).toBe('cloud_1');
    expect(payload).toMatchObject({ labelId: 'L1', tags: ['t1', 't2'] });
    expect([...fields!].sort()).toEqual(['labelId', 'tags']);
    expect((await LocalStorageService.getDocument(docId, U))?.metadataDirty).toBeFalsy();
  });

  it('облако не приняло поля — отметка остаётся, задача в очереди (дошлёт дренаж)', async () => {
    vi.spyOn(CloudSyncService, 'syncVersionToCloud').mockResolvedValue({ forked: false, cloudSynced: true } as never);
    vi.spyOn(DocumentService, 'updateMetadataFields').mockRejectedValue(new Error('сеть'));

    await save({ labelId: 'L1' });

    const row = await LocalStorageService.getDocument(docId, U);
    expect(row?.metadataDirty).toBe(true);
    expect(row?.metadataDirtyFields).toEqual(['labelId']);
    expect((await (await getLocalDb(U)).getAll('syncQueue')).some(t => t.documentId === docId)).toBe(true);
  });

  it('версия не ушла — поля не шлём отдельно, отметка ждёт дренажа', async () => {
    vi.spyOn(CloudSyncService, 'syncVersionToCloud').mockResolvedValue({ forked: false, cloudSynced: false } as never);
    const meta = vi.spyOn(DocumentService, 'updateMetadataFields').mockResolvedValue(undefined);

    await save({ title: 'Новое название' });

    expect(meta).not.toHaveBeenCalled();
    expect((await LocalStorageService.getDocument(docId, U))?.metadataDirtyFields).toEqual(['title']);
  });

  it('ничего не меняли — лишнего вызова нет', async () => {
    vi.spyOn(CloudSyncService, 'syncVersionToCloud').mockResolvedValue({ forked: false, cloudSynced: true } as never);
    const meta = vi.spyOn(DocumentService, 'updateMetadataFields').mockResolvedValue(undefined);

    await save();

    expect(meta).not.toHaveBeenCalled();
    expect((await LocalStorageService.getDocument(docId, U))?.metadataDirty).toBeFalsy();
  });
});
