import { describe, it, expect, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * B5 (ревью 2026-10-22, R-5 и R-7 + инвариант S1-12):
 * - R-5: повтор отложенных шёл вне try, который ловит PullPaused — занятый
 *   замок на отложенной строке роняла весь забор ошибкой. Теперь пауза.
 * - Инвариант «отложенные пишутся ДО сдвига курсора»: курсор за строкой без
 *   записи о ней — потерянная заметка. Мутации «сначала сдвиг, потом запись» и
 *   «в catch страницы не сохранять» обязаны краснеть.
 * - C3: тот же инвариант на обычном конце страницы (без сбоя посреди) — там
 *   перестановка «сначала курсор» не краснила ни один тест.
 */

const ctl = vi.hoisted(() => ({ failPersist: false }));
vi.mock('../../../core/sync/revCursor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/sync/revCursor')>();
  return {
    ...actual,
    setSyncRevDeferred: (...a: Parameters<typeof actual.setSyncRevDeferred>) =>
      ctl.failPersist ? Promise.reject(new Error('persist failed')) : actual.setSyncRevDeferred(...a),
  };
});

import { LifecycleRunner } from '../lifecycleRunner';
import type { InMemoryPostgres } from '../inMemoryPostgres';
import { Device, activateDevice, forgetDevice } from '../harnessDevice';
import { SyncService } from '../../../core/services/SyncService';
import { CloudSyncService } from '../../../core/services/CloudSyncService';
import { getLocalDb } from '../../../core/storage/localDb';
import { getSyncRevCursor, getSyncRevDeferred } from '../../../core/sync/revCursor';
import { setEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';
import { withDocumentLock } from '../../../core/sync/withDocumentLock';

function seedCloudNote(pg: InMemoryPostgres, uid: string, uuid: string, text: string, over: Record<string, unknown> = {}): number {
  pg.executeInsert('documents', {
    uuid, user_id: uid, title: 'Note', current_version: 1, total_words: 1,
    total_duration: 1, sessions_count: 1, tags: [], _encrypted: false,
    first_session_at: '2026-01-01T00:00:00Z', last_session_at: '2026-01-01T00:00:00Z',
    ...over,
  });
  pg.executeInsert('versions', {
    document_uuid: uuid, user_id: uid, version: 1, content: text, word_count: 1,
    duration: 1, wpm: 1, _encrypted: false,
    saved_at: '2026-01-01T00:00:00Z', session_started_at: '2026-01-01T00:00:00Z',
  });
  return Number(pg.getRows('documents').find(r => r.uuid === uuid)!.rev);
}

const byUuid = (uuid: string) => [{ type: 'eq' as const, column: 'uuid', value: uuid }];

describe('B5: отложенные строки — пауза на замке и запись до сдвига курсора', () => {
  const runner = new LifecycleRunner();
  afterEach(() => {
    ctl.failPersist = false;
    vi.restoreAllMocks();
    setEncryptionEnabled(runner.userId, false);
    runner.teardown();
    forgetDevice();
  });

  it('R-5: замок занят на повторе отложенной → забор ставится на паузу, а не падает', async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_b5_busy';
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;

    seedCloudNote(pg, uid, 'r5', 'text r5');
    await SyncService.pullNotes(uid);
    const db = await getLocalDb(uid);
    const local = (await db.getAll('documents')).find(d => d.linkedCloudId === 'r5');
    expect(local, 'заметка скачана и связана').toBeDefined();

    // Строку испортили на сервере (новый rev) → отложена.
    pg.executeUpdate('documents', { current_version: 'три' }, byUuid('r5'));
    await SyncService.pullNotes(uid);
    expect((await getSyncRevDeferred(uid)).map(r => r.uuid)).toEqual(['r5']);

    // Починили; на повторе отложенной замок локальной заметки держит другой писатель.
    pg.executeUpdate('documents', { current_version: 1 }, byUuid('r5'));
    let res: Awaited<ReturnType<typeof SyncService.pullNotes>> | undefined;
    await withDocumentLock(local!.id, async () => {
      res = await SyncService.pullNotes(uid);
    }, { ownerId: uid });

    expect(res, 'забор завершился без ошибки').toBeDefined();
    expect(res!.skipped).toBeGreaterThanOrEqual(1);
    expect((await getSyncRevDeferred(uid)).map(r => r.uuid), 'отложенная не потеряна').toEqual(['r5']);

    // Замок отпущен — следующий забор применяет строку.
    await SyncService.pullNotes(uid);
    expect(await getSyncRevDeferred(uid)).toEqual([]);
  });

  it('инвариант: сбой посреди страницы — отложенная записана, курсор не дальше неё', async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_b5_order';
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;

    const revBad = seedCloudNote(pg, uid, 'inv-bad', 'x', { current_version: 'три' });
    seedCloudNote(pg, uid, 'inv-fail', 'text fail');
    const realAdd = CloudSyncService.addLocalCopy;
    vi.spyOn(CloudSyncService, 'addLocalCopy').mockImplementation(async (u, id) =>
      id === 'inv-fail' ? Promise.reject(new Error('network down')) : realAdd(u, id));

    await expect(SyncService.pullNotes(uid)).rejects.toThrow('network down');
    // Мутация «в catch страницы не сохранять» → отложенной нет, а курсор прошёл её.
    expect((await getSyncRevDeferred(uid)).map(r => r.uuid)).toEqual(['inv-bad']);
    expect((await getSyncRevCursor(uid)).documents).toBe(revBad);
  });

  it('инвариант: запись отложенных не удалась → курсор не двигается', async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_b5_persist';
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;

    seedCloudNote(pg, uid, 'p-bad', 'x', { current_version: 'три' });
    seedCloudNote(pg, uid, 'p-fail', 'text fail');
    const realAdd = CloudSyncService.addLocalCopy;
    vi.spyOn(CloudSyncService, 'addLocalCopy').mockImplementation(async (u, id) =>
      id === 'p-fail' ? Promise.reject(new Error('network down')) : realAdd(u, id));

    ctl.failPersist = true;
    await expect(SyncService.pullNotes(uid)).rejects.toThrow('network down');
    // Мутация «сначала сдвиг, потом запись» → курсор уже за отложенной, записи о ней нет.
    expect((await getSyncRevCursor(uid)).documents, 'курсор остался на старте').toBe(0);
  });

  it('C3: обычный конец страницы — запись отложенных не удалась → курсор не двигается', async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_b5_page_end';
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;

    seedCloudNote(pg, uid, 'e-bad', 'x', { current_version: 'три' });
    seedCloudNote(pg, uid, 'e-ok', 'text ok');

    ctl.failPersist = true;
    await expect(SyncService.pullNotes(uid)).rejects.toThrow('persist failed');
    expect((await getSyncRevCursor(uid)).documents, 'курсор остался на старте').toBe(0);
  });
});
