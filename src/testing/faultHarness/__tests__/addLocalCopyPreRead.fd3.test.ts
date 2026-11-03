import { describe, it, expect, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { LifecycleRunner } from '../lifecycleRunner';
import { Device, activateDevice, forgetDevice } from '../harnessDevice';
import { CloudSyncService } from '../../../core/services/CloudSyncService';
import { DocumentService } from '../../../core/services/DocumentService';
import { getLocalDb } from '../../../core/storage/localDb';
import type { Document } from '../../../types';

/**
 * FD-3: строка, которая уже в руках вызывающего, не читается второй раз.
 * Чтение по uuid обязано ОСТАТЬСЯ для вызовов без переданной строки
 * (`archiveCrud`, действия заметки, диагностика) — иначе они молча получают
 * «Cloud document not found».
 */
describe('FD-3: addLocalCopy с переданной строкой не перечитывает её', () => {
  const runner = new LifecycleRunner();

  afterEach(() => {
    runner.teardown();
    forgetDevice();
    vi.restoreAllMocks();
  });

  const seed = (uid: string, uuid: string) => {
    const pg = runner.interceptor.postgres;
    pg.executeInsert('documents', {
      uuid, user_id: uid, title: 'Note', current_version: 1, total_words: 1,
      total_duration: 1, sessions_count: 1, tags: [], _encrypted: false,
      first_session_at: '2026-01-01T00:00:00Z', last_session_at: '2026-01-01T00:00:00Z',
    });
    pg.executeInsert('versions', {
      document_uuid: uuid, user_id: uid, version: 1, content: 'текст', word_count: 1,
      duration: 1, wpm: 1, _encrypted: false,
      saved_at: '2026-01-01T00:00:00Z', session_started_at: '2026-01-01T00:00:00Z',
    });
  };

  it('переданная строка — ноль чтений по uuid, копия всё равно создаётся', async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_fd3_preread';
    await runner.setup();
    const uid = runner.userId;
    seed(uid, 'fd3_a');
    const reads = vi.spyOn(DocumentService, 'getDocument');

    const row = { id: 'fd3_a', uuid: 'fd3_a', guestId: uid, title: 'Note', content: 'текст' } as unknown as Document;
    const localId = await CloudSyncService.addLocalCopy(uid, 'fd3_a', row);

    expect(reads).not.toHaveBeenCalled();
    const db = await getLocalDb();
    expect((await db.getAll('documents')).some(d => d.id === localId)).toBe(true);
  });

  it('без переданной строки чтение по uuid остаётся', async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_fd3_noread';
    await runner.setup();
    const uid = runner.userId;
    seed(uid, 'fd3_b');
    const reads = vi.spyOn(DocumentService, 'getDocument');

    await CloudSyncService.addLocalCopy(uid, 'fd3_b');

    expect(reads).toHaveBeenCalledTimes(1);
    expect(reads).toHaveBeenCalledWith(uid, 'fd3_b');
  });

  it(`переданная нечитаемая строка не становится локальной копией (${`_decryptionError`})`, async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_fd3_locked';
    await runner.setup();
    const uid = runner.userId;
    seed(uid, 'fd3_c');

    const bad = { id: 'fd3_c', uuid: 'fd3_c', guestId: uid, title: 'Note', _decryptionError: true } as unknown as Document;
    await expect(CloudSyncService.addLocalCopy(uid, 'fd3_c', bad)).rejects.toThrow(/DECRYPTION_ERROR/);
  });
});
