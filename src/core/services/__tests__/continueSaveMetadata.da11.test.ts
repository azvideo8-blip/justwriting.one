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
import { rememberMetadataBase } from '../metadataBase';
import { LocalDocumentService } from '../LocalDocumentService';

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
  // Открыли заметку для продолжения — окно «Завершить» держит эти значения.
  rememberMetadataBase(docId, { title: 'Название', tags: ['t1'], labelId: undefined });
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

  // Ревью DA-11 (1): снятие отметки после отправки своих полей теряло ждущее
  // «скрыть от ИИ». Мутация: слать только свои поля — красный.
  it('ждущее «скрыть от ИИ» уходит вместе с меткой, а не теряется', async () => {
    await LocalDocumentService.updateExcludedFromAI(docId, true, U);
    await LocalDocumentService.setMetadataDirty(docId, true, U, 'excludedFromAI');
    vi.spyOn(CloudSyncService, 'syncVersionToCloud').mockResolvedValue({ forked: false, cloudSynced: true } as never);
    const meta = vi.spyOn(DocumentService, 'updateMetadataFields').mockResolvedValue(undefined);

    await save({ labelId: 'L1' });

    const [, , payload, fields] = meta.mock.calls[0]!;
    expect([...fields!].sort()).toEqual(['excludedFromAI', 'labelId']);
    expect(payload).toMatchObject({ excludedFromAI: true, labelId: 'L1' });
  });

  // Ревью DA-11 (2): за сессию забор принёс теги с другого устройства в строку; окно
  // держит открытые значения — ничего не меняли, значит, и не шлём.
  // Мутация: сравнивать со строкой, а не с открытыми значениями — красный.
  it('строку обновил забор, человек ничего не менял — чужую правку не откатываем', async () => {
    const db = await getLocalDb(U);
    await db.put('documents', { ...(await db.get('documents', docId))!, tags: ['t1', 'с другого'], labelId: 'L2' } as never);
    vi.spyOn(CloudSyncService, 'syncVersionToCloud').mockResolvedValue({ forked: false, cloudSynced: true } as never);
    const meta = vi.spyOn(DocumentService, 'updateMetadataFields').mockResolvedValue(undefined);

    await save();

    expect(meta).not.toHaveBeenCalled();
  });

  it('развилка — поля оригиналу не помечаются', async () => {
    vi.spyOn(CloudSyncService, 'syncVersionToCloud').mockResolvedValue({ forked: true, forkTitle: 'x', cloudSynced: false } as never);
    await save({ labelId: 'L1' });
    expect((await LocalStorageService.getDocument(docId, U))?.metadataDirty).toBeFalsy();
  });

  // Случай владельца 27.11: новая заметка сохранена, дописал голосом и сохранил её
  // же второй раз — уже с меткой. Мутация: не запоминать значения в saveNew — красный.
  it('сохранил новую, затем ту же второй раз с меткой — метка уходит', async () => {
    const res = await StorageService.saveNew(U, { title: 'Пока жду', content: 'Синтетический первый текст', wordCount: 3, duration: 5, wpm: 30, tags: ['Аудио'], sessionStartedAt: new Date(1) } as never);
    await LocalStorageService.updateLinkedCloudId(res.localId, 'cloud_new', U);
    vi.spyOn(CloudSyncService, 'syncVersionToCloud').mockResolvedValue({ forked: false, cloudSynced: true } as never);
    const meta = vi.spyOn(DocumentService, 'updateMetadataFields').mockResolvedValue(undefined);

    await StorageService.saveVersion(U, res.localId, { title: 'Пока жду', content: 'Синтетический первый текст и голосом', wordCount: 3, duration: 5, wpm: 30, tags: ['Аудио'], labelId: 'L_audio', sessionStartedAt: new Date(2) } as never);

    expect(meta).toHaveBeenCalledTimes(1);
    expect(meta.mock.calls[0]![2]).toMatchObject({ labelId: 'L_audio' });
    expect(meta.mock.calls[0]![3]).toEqual(['labelId']);
  });

  // Повторное ревью DA-11: поле, помеченное, пока шла отправка (провалилась правка
  // тегов в архиве), не снимается. Мутация: снимать всю отметку — красный.
  it('поле, помеченное во время отправки, остаётся ждать', async () => {
    vi.spyOn(CloudSyncService, 'syncVersionToCloud').mockResolvedValue({ forked: false, cloudSynced: true } as never);
    vi.spyOn(DocumentService, 'updateMetadataFields').mockImplementation(async () => {
      await LocalDocumentService.setMetadataDirty(docId, true, U, 'tags');
    });

    await save({ labelId: 'L1' });

    const row = await LocalStorageService.getDocument(docId, U);
    expect(row?.metadataDirty).toBe(true);
    expect(row?.metadataDirtyFields).toEqual(['tags']);
  });
});
