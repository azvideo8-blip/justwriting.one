import { describe, it, expect, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LifecycleRunner } from '../lifecycleRunner';
import { Device, activateDevice, forgetDevice } from '../harnessDevice';
import { StorageService } from '../../../core/services/StorageService';
import { SyncService } from '../../../core/services/SyncService';
import { CloudSyncService } from '../../../core/services/CloudSyncService';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { getLocalDb } from '../../../core/storage/localDb';

/**
 * S2-6: досыл метаданных — только поля, изменённые на этом приборе
 * («последний по серверу» по полю, владелец 02.11). Прежде досыл тегов писал и
 * `trashedAt` из локальной копии и снимал корзину, поставленную другим прибором.
 *
 * Мутации: досыл всех полей (без `metadataDirtyFields`) → «корзина другого
 * прибора» красный; объединение полей заменено последним → «два поля» красный.
 */
describe('S2-6: досыл только изменённых полей', () => {
  const runner = new LifecycleRunner();
  afterEach(() => { runner.teardown(); forgetDevice(); });

  async function linkedNote(uid: string): Promise<{ localId: string; uuid: string }> {
    const { localId } = await StorageService.saveNew(uid, { title: 'Note', content: 'one', wordCount: 1, duration: 5, wpm: 10, tags: [], sessionStartedAt: new Date() });
    await SyncService.addToQueue(localId);
    await SyncService.syncOne(uid, localId);
    const row = runner.interceptor.postgres.getRows('documents').find(d => d.user_id === uid)!;
    return { localId, uuid: String(row.uuid) };
  }

  it('досыл тегов не снимает корзину, поставленную другим прибором', async () => {
    activateDevice(new Device('A'));
    await runner.setup();
    const uid = runner.userId;
    localStorage.setItem('auto_sync_enabled', 'true');
    const { localId, uuid } = await linkedNote(uid);

    // Другой прибор положил заметку в корзину.
    runner.interceptor.postgres.executeUpdate('documents', { trashed_at: new Date().toISOString() }, [{ type: 'eq', column: 'uuid', value: uuid }]);
    // Здесь поменяли теги, облако не ответило — правка ждёт досыла.
    await LocalDocumentService.updateTags(localId, ['новый'], uid);
    await LocalDocumentService.setMetadataDirty(localId, true, uid, 'tags');

    await CloudSyncService.addCloudCopy(uid, localId);

    const row = runner.interceptor.postgres.getRows('documents').find(d => d.uuid === uuid)!;
    expect(row.trashed_at, 'корзина другого прибора снята досылом тегов').toBeTruthy();
    expect(row.tags).toBeTruthy();
    const local = await (await getLocalDb()).get('documents', localId);
    expect(local?.metadataDirty).toBeFalsy();
  });

  it('два поля подряд копятся; флаг без поля — «дослать всё»', async () => {
    activateDevice(new Device('A'));
    await runner.setup();
    const uid = runner.userId;
    const { localId } = await linkedNote(uid);

    await LocalDocumentService.setMetadataDirty(localId, true, uid, 'tags');
    await LocalDocumentService.setMetadataDirty(localId, true, uid, 'trashedAt');
    let doc = await (await getLocalDb()).get('documents', localId);
    expect([...(doc?.metadataDirtyFields ?? [])].sort()).toEqual(['tags', 'trashedAt']);

    await LocalDocumentService.setMetadataDirty(localId, false, uid);
    await LocalDocumentService.setMetadataDirty(localId, true, uid);
    await LocalDocumentService.setMetadataDirty(localId, true, uid, 'title');
    doc = await (await getLocalDb()).get('documents', localId);
    expect(doc?.metadataDirty).toBe(true);
    expect(doc?.metadataDirtyFields, 'флаг «всё» сузился до одного поля').toBeUndefined();
  });

  // Сид 88: своя запись в ряд, где уже лежала чужая правка, не должна объявлять
  // её «увиденной». Мутация: метка своей записи вместо 'keep' → красный.
  it('сид 88: чужое «из корзины» не покрывается меткой своей записи', async () => {
    activateDevice(new Device('A'));
    await runner.setup();
    const uid = runner.userId;
    localStorage.setItem('auto_sync_enabled', 'true');
    const { localId, uuid } = await linkedNote(uid);
    await StorageService.trashDocument(uid, localId);
    await SyncService.pullNotes(uid);
    const db = await getLocalDb();
    expect((await db.get('documents', localId))?.trashedAt).toBeTruthy();

    // Другой прибор вернул заметку из корзины.
    runner.interceptor.postgres.executeUpdate('documents', { trashed_at: null }, [{ type: 'eq', column: 'uuid', value: uuid }]);
    // Здесь до забора легла новая версия (сохранена офлайн) и уходит в облако.
    const doc = (await db.get('documents', localId))!;
    await db.put('versions', {
      id: `ver_${localId}_2`, documentId: localId, guestId: uid, version: 2, content: 'two', wordCount: 1,
      wordsAdded: 1, charsAdded: 3, duration: 5, wpm: 10, savedAt: new Date().toISOString(), sessionStartedAt: new Date().toISOString(),
    } as never);
    await db.put('documents', { ...doc, currentVersion: 2 });
    await CloudSyncService.addCloudCopy(uid, localId);

    await SyncService.pullNotes(uid);
    expect((await db.get('documents', localId))?.trashedAt ?? null, 'чужое «из корзины» не приехало').toBeNull();
  });
});

