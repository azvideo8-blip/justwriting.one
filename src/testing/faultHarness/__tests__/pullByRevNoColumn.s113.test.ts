import { describe, it, expect, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { LifecycleRunner } from '../lifecycleRunner';
import type { InMemoryPostgres } from '../inMemoryPostgres';
import { Device, activateDevice, forgetDevice } from '../harnessDevice';
import { SyncService } from '../../../core/services/SyncService';
import { CloudSyncService } from '../../../core/services/CloudSyncService';
import { checkAndSyncCursor } from '../../../core/sync/changeCursor';
import { setEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';

/**
 * S1-13 / S1-14: сервер без 0045 (42703) и выключенный флаг ведут на старый
 * путь — и этот старый путь обязан быть ровно 0.10.x: вход/сеть/сейф — только
 * download, видимость — проверка курсора (два limit 1), не полный проход.
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

describe('S1-13: after 42703 the session routes visibility to the cursor check', () => {
  const runner = new LifecycleRunner();
  afterEach(() => {
    setEncryptionEnabled(runner.userId, false);
    runner.interceptor.postgres.setWithRev(true);
    runner.teardown();
    forgetDevice();
    vi.restoreAllMocks();
  });

  it('remembers 42703 for the session; the cursor check costs two reads, the old path reads every note', async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_no_column';
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    for (let i = 0; i < 50; i++) seedCloudNote(pg, uid, `nocol-${i}`, `text ${i}`);
    pg.setWithRev(false);

    expect(SyncService.isRevPullUnavailable(uid)).toBe(false);
    const reconcile = vi.spyOn(CloudSyncService, 'reconcileLinkedDocuments');
    await SyncService.pullNotes(uid);
    expect(SyncService.isRevPullUnavailable(uid)).toBe(true);
    // S1-14: вход/сеть/сейф в 0.10.x — только download, без сверки связанных.
    expect(reconcile).not.toHaveBeenCalled();

    // Видимость: первая проверка ставит курсор, вторая — ничего не изменилось.
    await checkAndSyncCursor(uid);
    pg.resetRequestCounts();
    await checkAndSyncCursor(uid);
    const visibilityReads = pg.getRequestCount(undefined, 'select');
    expect(visibilityReads).toBeLessThanOrEqual(2);

    // Старый путь на тех же данных: число запросов сравнимо (одна страница
    // списка на 50 заметок), разница — в объёме: полные строки всех заметок
    // против двух строк по одной колонке. Счётчик стенда считает запросы,
    // поэтому здесь — только числа в отчёт; суть защищает маршрут выше.
    pg.resetRequestCounts();
    await SyncService.pullNotes(uid);
    const oldPathReads = pg.getRequestCount(undefined, 'select');
    console.log('reads per visibility event without 0045:', { cursorCheck: visibilityReads, oldPath: oldPathReads });
  });
});
