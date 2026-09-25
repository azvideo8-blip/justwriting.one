import { describe, it, expect, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LifecycleRunner } from '../lifecycleRunner';
import { getLocalDb } from '../../../core/storage/localDb';
import { SyncService } from '../../../core/services/SyncService';
import { StorageService } from '../../../core/services/StorageService';
import { LocalStorageService } from '../../../core/services/LocalStorageService';

/**
 * Next-steps №1: the server as a hostile channel. The vault encrypts titles and
 * texts with a key the server never sees (AES-GCM, authenticated) — so a server
 * cannot forge a note. Unless the client takes a row marked «not encrypted» at
 * face value.
 */
describe('№1: hostile server', () => {
  const runner = new LifecycleRunner();
  afterEach(() => runner.teardown());

  it('with the vault on, a plaintext row the server made up is not taken as a note', async () => {
    runner.vaultEnabled = true;
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    pg.executeInsert('documents', { uuid: 'forged-doc', user_id: uid, title: 'Письмо от банка', current_version: 1, _encrypted: false, first_session_at: 1000, last_session_at: 1000, tags: [] });
    pg.executeInsert('versions', { document_uuid: 'forged-doc', user_id: uid, version: 1, content: 'Срочно перейдите по ссылке и введите пароль', _encrypted: false, word_count: 7, duration: 1, wpm: 1, session_started_at: new Date(1000).toISOString() });

    await SyncService.downloadAllFromCloud(uid);
    const db = await getLocalDb();
    const texts = (await db.getAll('versions')).map(v => v.content);
    expect(texts).not.toContain('Срочно перейдите по ссылке и введите пароль');
  });

  // TB-14: сервер ответил «сохранено», но ничего не сохранил (или потерял
  // строку позже). Худший исход — клиент решит, что заметку удалили на другом
  // устройстве, и сотрёт её у себя. Заметка на устройстве обязана уцелеть, а
  // следующие обычные проходы синхронизации — вернуть её в облако.
  it('a note the server acknowledged but never kept survives on the device and goes back up', async () => {
    runner.vaultEnabled = true;
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    const localId = await LocalStorageService.createDocument(uid, { title: 'Acked', tags: [], firstSessionAt: 1000, lastSessionAt: 1000 });
    await StorageService.saveVersion(uid, localId, { title: 'Acked', content: 'Текст, который сервер «сохранил»', wordCount: 4, duration: 10, wpm: 24, tags: [], sessionStartedAt: new Date(1000) });
    const cloudId = await StorageService.addCloudCopy(uid, localId);
    expect(cloudId).toBeTruthy();

    // Сервер теряет всё, что подтвердил.
    pg.executeDelete('versions', [{ type: 'eq', column: 'user_id', value: uid }]);
    pg.executeDelete('documents', [{ type: 'eq', column: 'user_id', value: uid }]);
    expect(pg.getRows('documents')).toHaveLength(0);

    // Обычные проходы приложения: загрузка, сверка связанных, обход сирот, очередь.
    await SyncService.downloadAllFromCloud(uid);
    await SyncService.reconcileLinkedDocuments(uid);
    await SyncService.sweepOrphanedDocuments(uid, 0);
    await SyncService.syncPending(uid);

    const db = await getLocalDb();
    const doc = await db.get('documents', localId);
    expect(doc, 'заметка стёрта с устройства после того, как сервер её потерял').toBeTruthy();
    const texts = (await db.getAll('versions')).filter(v => v.documentId === localId).map(v => v.content);
    expect(texts).toContain('Текст, который сервер «сохранил»');
    expect(pg.getRows('documents').filter(r => r.user_id === uid), 'заметка не вернулась в облако').toHaveLength(1);
  });

  // TB-14: сервер (сломанный RLS или подменённый ответ) отдаёт строки чужого
  // аккаунта. С сейфом их не прочитать, а без сейфа открытый текст чужого
  // человека лёг бы в заметки этого — утечка на экран. Клиент берёт только свои.
  it("rows owned by another account are not adopted, even when the server ignores the owner filter", async () => {
    runner.vaultEnabled = false;
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    const other = '11111111-1111-1111-1111-111111111111';
    pg.executeInsert('documents', { uuid: 'foreign-doc', user_id: other, title: 'Чужая заметка', current_version: 1, _encrypted: false, first_session_at: 1000, last_session_at: 1000, tags: [] });
    pg.executeInsert('versions', { document_uuid: 'foreign-doc', user_id: other, version: 1, content: 'Чужой личный текст', _encrypted: false, word_count: 3, duration: 1, wpm: 1, session_started_at: new Date(1000).toISOString() });

    const select = pg.executeSelect.bind(pg);
    pg.executeSelect = ((table, filters, ...rest) =>
      select(table, filters.filter(f => !(f.column === 'user_id' || f.column === 'uid')), ...rest)) as typeof pg.executeSelect;

    await SyncService.downloadAllFromCloud(uid);
    const db = await getLocalDb();
    const texts = (await db.getAll('versions')).map(v => v.content);
    const titles = (await db.getAll('documents')).map(d => d.title);
    expect(texts).not.toContain('Чужой личный текст');
    expect(titles).not.toContain('Чужая заметка');
  });
});
