// MS-3: забор по rev — удаление только по надгробию (`deleted_at`), не по
// отсутствию строки. Три входа:
//   1) надгробие связанной заметки: текст на устройстве цел, заметка
//      поставлена в очередь (выгрузка увидит надгробие и отвяжет её с localOnly);
//   2) надгробие строки, которая была отложена: обязательство по ней закрыто —
//      запись уходит из списка отложенных, а не повторяется каждым забором;
//   3) версия без строки заметки (сирота на сервере): это не «заметки нет» —
//      локальная копия остаётся связанной, в очередь ничего не ставится.
import { describe, it, expect, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LifecycleRunner } from '../lifecycleRunner';
import type { InMemoryPostgres } from '../inMemoryPostgres';
import { Device, activateDevice, forgetDevice } from '../harnessDevice';
import { SyncService } from '../../../core/services/SyncService';
import { StorageService } from '../../../core/services/StorageService';
import { getLocalDb } from '../../../core/storage/localDb';
import { getSyncRevDeferred } from '../../../core/sync/revCursor';
import { setEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';

function seedCloudNote(pg: InMemoryPostgres, uid: string, uuid: string, text: string, over: Record<string, unknown> = {}): void {
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
}

function save(uid: string, localId: string, content: string, at: number) {
  return StorageService.saveVersion(uid, localId, {
    title: 'Note', content, wordCount: content.split(' ').length, duration: 10, wpm: 10, tags: [],
    sessionStartedAt: new Date(at),
  });
}

async function latestText(localId: string): Promise<string | undefined> {
  const db = await getLocalDb();
  const vs = await db.getAllFromIndex('versions', 'by-document', localId);
  return vs.sort((a, b) => b.version - a.version)[0]?.content;
}

describe('MS-3: забор по rev удаляет только по надгробию', () => {
  const runner = new LifecycleRunner();
  afterEach(() => {
    setEncryptionEnabled(runner.userId, false);
    runner.teardown();
    forgetDevice();
  });

  it('надгробие связанной заметки: текст цел, заметка поставлена в очередь, копия не скачана', async () => {
    activateDevice(new Device('T'));
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    const { localId } = await StorageService.saveNew(uid, {
      title: 'Note', content: 'MARKER_MS3_начальный_текст', wordCount: 2, duration: 5, wpm: 10,
      tags: [], sessionStartedAt: new Date(1000),
    });
    const cloudId = await StorageService.addCloudCopy(uid, localId);
    expect(cloudId).toBeTruthy();
    await SyncService.pullNotes(uid);

    await save(uid, localId, 'MARKER_MS3_правка_после_выгрузки', 2000);
    const db = await getLocalDb();
    // Наблюдаем именно постановку забором: очередь от локальной правки убираем.
    for (const q of await db.getAll('syncQueue')) {
      if (q.id.startsWith('sync_')) await db.delete('syncQueue', q.id);
    }

    pg.executeUpdate('documents', { deleted_at: new Date().toISOString() }, [
      { type: 'eq', column: 'uuid', value: cloudId },
    ]);
    const res = await SyncService.pullNotes(uid);

    const doc = await db.get('documents', localId);
    expect(doc, 'надгробие не стирает локальный текст').toBeTruthy();
    expect(doc!.linkedCloudId, 'отвязка — дело выгрузки, не забора').toBe(cloudId);
    expect(doc!.localOnly).toBeFalsy();
    expect(await latestText(localId)).toBe('MARKER_MS3_правка_после_выгрузки');
    const localCopies = (await db.getAll('documents')).filter(d => d.guestId === uid);
    expect(localCopies, 'надгробие не рождает вторую локальную копию').toHaveLength(1);
    expect(res.downloaded).toBe(0);
    expect(await db.get('syncQueue', `sync_${localId}`), 'заметка поставлена в очередь на отвязку').toBeTruthy();
  });

  it('надгробие отложенной строки закрывает обязательство: запись уходит из отложенных', async () => {
    activateDevice(new Device('D'));
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    // Строка не проходит схему — первый забор её откладывает.
    seedCloudNote(pg, uid, 'ms3-bad-deferred', 'MARKER_MS3_битая', { current_version: 'три' });
    await SyncService.pullNotes(uid);
    expect((await getSyncRevDeferred(uid)).map(r => r.uuid)).toEqual(['ms3-bad-deferred']);

    pg.executeUpdate('documents', { deleted_at: new Date().toISOString() }, [
      { type: 'eq', column: 'uuid', value: 'ms3-bad-deferred' },
    ]);
    await SyncService.pullNotes(uid);

    expect(await getSyncRevDeferred(uid), 'надгробие снимает отложенную строку').toEqual([]);
  });

  it('версия без строки заметки — не удаление: локальная копия остаётся связанной', async () => {
    activateDevice(new Device('O'));
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    const db = await getLocalDb();
    await db.put('documents', {
      id: 'local_ms3_orphan', uuid: 'ms3-orphan-ver', guestId: uid, title: 'Note',
      currentVersion: 1, totalWords: 2, totalDuration: 10, sessionsCount: 1,
      firstSessionAt: 1000, lastSessionAt: 1000, tags: [],
      linkedCloudId: 'ms3-orphan-ver',
    } as never);
    await db.put('versions', {
      id: 'ver_ms3_orphan', documentId: 'local_ms3_orphan', version: 1,
      content: 'MARKER_MS3_локальный_текст', wordCount: 2, savedAt: 1000,
    } as never);
    // На сервере строки заметки нет, но версия с её uuid есть (сирота).
    pg.executeInsert('versions', {
      document_uuid: 'ms3-orphan-ver', user_id: uid, version: 1, content: 'cloud orphan',
      word_count: 1, duration: 1, wpm: 1, _encrypted: false,
      saved_at: '2026-01-01T00:00:00Z', session_started_at: '2026-01-01T00:00:00Z',
    });

    const res = await SyncService.pullNotes(uid);

    const doc = await db.get('documents', 'local_ms3_orphan');
    expect(doc, 'сирота-версия не стирает локальную заметку').toBeTruthy();
    expect(doc!.linkedCloudId, 'сирота-версия не отвязывает заметку').toBe('ms3-orphan-ver');
    expect(doc!.localOnly).toBeFalsy();
    expect(await latestText('local_ms3_orphan')).toBe('MARKER_MS3_локальный_текст');
    expect(await db.get('syncQueue', 'sync_local_ms3_orphan'), '«нет строки» не ставит задачу').toBeUndefined();
    expect(res.downloaded).toBe(0);
  });
});
