import { describe, it, expect, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { LifecycleRunner } from '../lifecycleRunner';
import type { InMemoryPostgres } from '../inMemoryPostgres';
import { Device, activateDevice, forgetDevice } from '../harnessDevice';
import { StorageService } from '../../../core/services/StorageService';
import { CloudSyncService } from '../../../core/services/CloudSyncService';
import { SyncService } from '../../../core/services/SyncService';
import { getLocalDb } from '../../../core/storage/localDb';
import { advanceSyncRevCursor, getSyncRevCursor } from '../../../core/sync/revCursor';
import { setEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';

/**
 * S1-6: точки поведения нового забора. Инварианты случайного прогона — в
 * twoDevices; здесь — точечные случаи, которые в случайном не видны.
 */

function seedCloudNote(pg: InMemoryPostgres, uid: string, uuid: string, text: string): void {
  pg.executeInsert('documents', {
    uuid, user_id: uid, title: 'Note', current_version: 1, total_words: 1,
    total_duration: 1, sessions_count: 1, tags: [], _encrypted: false,
    first_session_at: '2026-01-01T00:00:00Z', last_session_at: '2026-01-01T00:00:00Z',
  });
  pg.executeInsert('versions', {
    document_uuid: uuid, user_id: uid, version: 1, content: text, word_count: 1,
    duration: 1, wpm: 1, _encrypted: false,
    saved_at: '2026-01-01T00:00:00Z', session_started_at: '2026-01-01T00:00:00Z',
  });
}

async function localLiveTexts(uid: string): Promise<string[]> {
  const db = await getLocalDb();
  const out: string[] = [];
  for (const d of (await db.getAll('documents')).filter(x => x.guestId === uid)) {
    if (d.trashedAt || d.localOnly || d.unlinkedByTombstone) continue;
    const vs = await db.getAllFromIndex('versions', 'by-document', d.id);
    const latest = vs.sort((a, b) => b.version - a.version)[0];
    out.push(latest?.content ?? '');
  }
  return out.sort();
}

describe('pullNotes by rev (S1-6)', () => {
  const runner = new LifecycleRunner();
  afterEach(() => {
    // Сейф включён «для любого аккаунта» на уровне стора: без сброса
    // следующий тест расшифровывает открытые строки как шифр.
    setEncryptionEnabled(runner.userId, false);
    runner.interceptor.postgres.setWithRev(true);
    runner.interceptor.postgres.setMaxRows(1000);
    runner.teardown();
    forgetDevice();
  });

  it('maxRows=3 does not stop the pull short and the cursor lands on the last applied rev', async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_pull_pager';
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    for (let i = 0; i < 10; i++) seedCloudNote(pg, uid, `pull-many-${i}`, `text-${i}`);

    pg.setMaxRows(3);
    const res = await SyncService.pullNotes(uid);
    expect(res.locked).toBeFalsy();
    expect(await localLiveTexts(uid)).toEqual(Array.from({ length: 10 }, (_, i) => `text-${i}`).sort());

    const cursor = await getSyncRevCursor(uid);
    const maxDocRev = Math.max(...pg.getRows('documents').map(r => Number(r.rev)));
    const maxVerRev = Math.max(...pg.getRows('versions').map(r => Number(r.rev)));
    expect(cursor.documents).toBe(maxDocRev);
    expect(cursor.versions).toBe(maxVerRev);
  });

  it('server without 0045 falls back to the old full path, no loss', async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_pull_norev';
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    seedCloudNote(pg, uid, 'pull-no-rev', 'without rev');
    // Курсор от прошлой жизни колонки: сервер без rev обязан его сбросить,
    // иначе после возврата колонки с новой последовательностью строки младше
    // курсора не приедут никогда.
    await advanceSyncRevCursor(uid, 'documents', 5);
    await advanceSyncRevCursor(uid, 'versions', 5);

    pg.setWithRev(false);
    const res = await SyncService.pullNotes(uid);
    expect(res.locked).toBeFalsy();
    expect(await localLiveTexts(uid)).toEqual(['without rev']);
    // Старый путь курсор по rev не двигает: колонки нет.
    expect(await getSyncRevCursor(uid)).toEqual({ documents: 0, versions: 0 });
  });

  it('vault on: an encrypted note arrives and decrypts', async () => {
    runner.vaultEnabled = true;
    runner.userId = 'user_pull_vault';
    activateDevice(new Device('VA'));
    await runner.setup();
    const uid = runner.userId;
    const a = await StorageService.saveNew(uid, {
      title: 'Note', content: 'secret text', wordCount: 2, duration: 5, wpm: 10,
      tags: [], sessionStartedAt: new Date(),
    });
    const cloudId = await StorageService.addCloudCopy(uid, a.localId);
    expect(cloudId).toBeTruthy();

    // Второе устройство того же аккаунта: своя IndexedDB, тот же сейф.
    activateDevice(new Device('VB'));
    localStorage.setItem('auto_sync_enabled', 'true');
    await SyncService.pullNotes(uid);
    expect(await localLiveTexts(uid)).toEqual(['secret text']);
  });

  it('a failure in the middle of a page leaves the cursor on the last applied row', async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_pull_midpage';
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    seedCloudNote(pg, uid, 'pull-fail-1', 'first');
    seedCloudNote(pg, uid, 'pull-fail-2', 'second');
    const firstRev = Number(pg.getRows('documents').find(r => r.uuid === 'pull-fail-1')!.rev);

    const original = CloudSyncService.addLocalCopy.bind(CloudSyncService);
    vi.spyOn(CloudSyncService, 'addLocalCopy').mockImplementation(async (user, cloudId) => {
      if (cloudId === 'pull-fail-2') throw new Error('midpage boom');
      return original(user, cloudId);
    });

    await expect(SyncService.pullNotes(uid)).rejects.toThrow(/midpage boom|PULL_APPLY_FAILED/);
    expect(await getSyncRevCursor(uid)).toEqual({ documents: firstRev, versions: 0 });
    expect(await localLiveTexts(uid)).toEqual(['first']);
    vi.restoreAllMocks();
  });

  it('network_pre/network_post on a page changes nothing and does not advance the cursor', async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_pull_net';
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    seedCloudNote(pg, uid, 'pull-net-1', 'first');

    for (const fault of ['network_pre', 'network_post'] as const) {
      runner.interceptor.setStep('device_b_edit');
      runner.interceptor.armFault(fault, 'device_b_edit');
      await expect(SyncService.pullNotes(uid), fault).rejects.toBeTruthy();
      runner.interceptor.clearArmedFault();
      runner.interceptor.setStep('initial_write');
      expect(await localLiveTexts(uid), `${fault}: локальное изменилось`).toEqual([]);
      expect(await getSyncRevCursor(uid), `${fault}: курсор сдвинулся`).toEqual({ documents: 0, versions: 0 });
    }

    await SyncService.pullNotes(uid);
    expect(await localLiveTexts(uid)).toEqual(['first']);
    expect((await getSyncRevCursor(uid)).documents).toBeGreaterThan(0);
  });

  it('locked vault reads nothing and leaves the cursor alone', async () => {
    runner.vaultEnabled = true;
    activateDevice(new Device('B'));
    runner.userId = 'user_pull_locked';
    await runner.setup();
    const uid = runner.userId;
    runner.interceptor.setStep('device_b_edit');
    runner.interceptor.armFault('vault_locked', 'device_b_edit');

    const res = await SyncService.pullNotes(uid);
    expect(res.locked).toBe(true);
    expect(await localLiveTexts(uid)).toEqual([]);
    expect(await getSyncRevCursor(uid)).toEqual({ documents: 0, versions: 0 });
  });

  it('one changed note costs a fixed number of requests at 50 and 300 notes', async () => {
    const measured: Record<number, { byRev: number; oldPath: number }> = {};
    for (const n of [50, 300]) {
      runner.userId = `user_pull_metric_${n}`;
      activateDevice(new Device(`B${n}`));
      await runner.setup();
      const uid = runner.userId;
      const pg = runner.interceptor.postgres;
      for (let i = 0; i < n; i++) seedCloudNote(pg, uid, `metric-${i}`, `metric text ${i}`);
      await SyncService.pullNotes(uid);

      const target = 'metric-0';
      pg.executeInsert('versions', {
        document_uuid: target, user_id: uid, version: 2, content: 'changed by rev',
        word_count: 3, duration: 1, wpm: 1, _encrypted: false,
        saved_at: new Date().toISOString(), session_started_at: new Date().toISOString(),
      });
      pg.executeUpdate('documents', { current_version: 2 }, [{ type: 'eq', column: 'uuid', value: target }]);

      pg.resetRequestCounts();
      await SyncService.pullNotes(uid);
      const byRev = pg.getRequestCount();

      // Старый путь — отдельное изменение: сверка идёт по «облако новее».
      pg.executeInsert('versions', {
        document_uuid: target, user_id: uid, version: 3, content: 'changed for old path',
        word_count: 4, duration: 1, wpm: 1, _encrypted: false,
        saved_at: new Date().toISOString(), session_started_at: new Date().toISOString(),
      });
      pg.executeUpdate('documents', { current_version: 3 }, [{ type: 'eq', column: 'uuid', value: target }]);
      pg.resetRequestCounts();
      await SyncService.pullNotesOldPath(uid);
      const oldPath = pg.getRequestCount();

      measured[n] = { byRev, oldPath };
      expect(byRev, `${n} notes: rev path must stay small`).toBeLessThanOrEqual(6);
    }
    expect(measured[50]?.byRev).toBe(measured[300]?.byRev);
    expect(measured[50]?.oldPath).toBe(measured[300]?.oldPath);
    console.log('requests per one changed note:', measured);
  }, 30_000);

  it('a local edit made while nothing moved in the cloud survives the pull', async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_pull_local';
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    seedCloudNote(pg, uid, 'pull-local-1', 'cloud text');
    await SyncService.pullNotes(uid);

    const db = await getLocalDb();
    const local = (await db.getAll('documents')).find(d => d.guestId === uid)!;
    await StorageService.saveVersion(uid, local.id, {
      title: 'Note', content: 'my local edit', wordCount: 3, duration: 1, wpm: 1,
      tags: [], sessionStartedAt: new Date(),
    });
    await SyncService.pullNotes(uid);
    expect(await localLiveTexts(uid)).toEqual(['my local edit']);
  });
});
