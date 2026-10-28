import { describe, it, expect, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LifecycleRunner } from '../lifecycleRunner';
import type { InMemoryPostgres } from '../inMemoryPostgres';
import { Device, activateDevice, forgetDevice } from '../harnessDevice';
import { SyncService } from '../../../core/services/SyncService';
import { getLocalDb } from '../../../core/storage/localDb';
import { getSyncRevCursor, getSyncRevDeferred } from '../../../core/sync/revCursor';
import { setEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';

/**
 * S1-12: одна стойко плохая строка (схема, расшифровка, заметка без версий)
 * не должна навсегда останавливать забор аккаунта: раньше каждый забор
 * бросал на ней, всё после неё не приезжало, а при включённом флаге
 * видимость больше не звала checkAndSyncCursor — правки с других устройств
 * переставали приходить молча. Теперь такая строка откладывается
 * (uuid+rev в базе аккаунта), курсор идёт дальше, отложенные повторяются
 * каждым забором. Сеть, LOCKED, сбой посреди страницы — по-прежнему стоп.
 */

function seedCloudNote(pg: InMemoryPostgres, uid: string, uuid: string, text: string, over: Record<string, unknown> = {}): number {
  pg.executeInsert('documents', {
    uuid, user_id: uid, title: 'Note', current_version: 1, total_words: 1,
    total_duration: 1, sessions_count: 1, tags: [], _encrypted: false,
    first_session_at: '2026-01-01T00:00:00Z', last_session_at: '2026-01-01T00:00:00Z',
    ...over,
  });
  if (text !== null) {
    pg.executeInsert('versions', {
      document_uuid: uuid, user_id: uid, version: 1, content: text, word_count: 1,
      duration: 1, wpm: 1, _encrypted: false,
      saved_at: '2026-01-01T00:00:00Z', session_started_at: '2026-01-01T00:00:00Z',
    });
  }
  return Number(pg.getRows('documents').find(r => r.uuid === uuid)!.rev);
}

async function localLiveTexts(uid: string): Promise<string[]> {
  const db = await getLocalDb(uid);
  const out: string[] = [];
  for (const d of (await db.getAll('documents')).filter(x => x.guestId === uid)) {
    if (d.trashedAt || d.localOnly || d.unlinkedByTombstone) continue;
    const vs = await db.getAllFromIndex('versions', 'by-document', d.id);
    const latest = vs.sort((a, b) => b.version - a.version)[0];
    out.push(latest?.content ?? '');
  }
  return out.sort();
}

describe('S1-12: a persistently bad row is deferred, not a wall', () => {
  const runner = new LifecycleRunner();
  afterEach(() => {
    setEncryptionEnabled(runner.userId, false);
    runner.teardown();
    forgetDevice();
  });

  it('schema-broken row between two good ones: both good arrive, the bad one is deferred and retried', async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_pull_deferred';
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    seedCloudNote(pg, uid, 'def-a', 'text a');
    // Строка есть, но не проходит схему: current_version строкой.
    const revBad = seedCloudNote(pg, uid, 'def-bad', 'text bad', { current_version: 'три' });
    const revC = seedCloudNote(pg, uid, 'def-c', 'text c');

    const res = await SyncService.pullNotes(uid);
    expect(res.locked).toBeFalsy();
    expect(await localLiveTexts(uid)).toEqual(['text a', 'text c']);
    expect((await getSyncRevCursor(uid)).documents).toBe(revC);
    expect(await getSyncRevDeferred(uid)).toEqual([
      expect.objectContaining({ uuid: 'def-bad', rev: revBad }),
    ]);

    // Повторный забор: отложенная перечитывается (запрос по uuid), всё ещё плохая.
    pg.resetRequestCounts();
    await SyncService.pullNotes(uid);
    expect(pg.getRequestCount('documents', 'select')).toBeGreaterThanOrEqual(2);
    expect((await getSyncRevDeferred(uid)).map(r => r.uuid)).toEqual(['def-bad']);
    expect(await localLiveTexts(uid)).toEqual(['text a', 'text c']);

    // Строку починили на месте, без нового rev: приезжает повтором отложенных.
    pg.getRows('documents').find(r => r.uuid === 'def-bad')!.current_version = 1;
    await SyncService.pullNotes(uid);
    expect(await localLiveTexts(uid)).toEqual(['text a', 'text bad', 'text c']);
    expect(await getSyncRevDeferred(uid)).toEqual([]);
  });

  it('a note without versions is deferred; its version arriving later brings the note', async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_pull_deferred_empty';
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    seedCloudNote(pg, uid, 'def-empty', null as unknown as string);
    const revF = seedCloudNote(pg, uid, 'def-f', 'text f');

    await SyncService.pullNotes(uid);
    expect(await localLiveTexts(uid)).toEqual(['text f']);
    expect((await getSyncRevCursor(uid)).documents).toBe(revF);
    expect((await getSyncRevDeferred(uid)).map(r => r.uuid)).toEqual(['def-empty']);

    pg.executeInsert('versions', {
      document_uuid: 'def-empty', user_id: uid, version: 1, content: 'text empty', word_count: 2,
      duration: 1, wpm: 1, _encrypted: false,
      saved_at: new Date().toISOString(), session_started_at: new Date().toISOString(),
    });
    await SyncService.pullNotes(uid);
    expect(await localLiveTexts(uid)).toEqual(['text empty', 'text f']);
    expect(await getSyncRevDeferred(uid)).toEqual([]);
  });

  it('the deferred list survives a cursor advance (same record, two fields)', async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_pull_deferred_keep';
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    seedCloudNote(pg, uid, 'keep-bad', 'x', { current_version: 'три' });
    await SyncService.pullNotes(uid);
    expect((await getSyncRevDeferred(uid)).map(r => r.uuid)).toEqual(['keep-bad']);

    seedCloudNote(pg, uid, 'keep-good', 'text good');
    await SyncService.pullNotes(uid);
    expect(await localLiveTexts(uid)).toEqual(['text good']);
    expect((await getSyncRevDeferred(uid)).map(r => r.uuid)).toEqual(['keep-bad']);
  });
});
