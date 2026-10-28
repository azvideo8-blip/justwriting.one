import { describe, it, expect, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LifecycleRunner } from '../lifecycleRunner';
import type { InMemoryPostgres } from '../inMemoryPostgres';
import { Device, activateDevice, forgetDevice } from '../harnessDevice';
import { SyncService } from '../../../core/services/SyncService';
import { getLocalDb } from '../../../core/storage/localDb';
import { getSyncRevCursor } from '../../../core/sync/revCursor';
import { setEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';

/**
 * S1-11: занятый замок заметки (LOCK_HELD — выгрузка идёт в другой вкладке)
 * — это «не применено», а не «применено». Старый проход курсор не двигал;
 * забор по rev считал такую строку пройденной, и до следующего изменения
 * заметки её правка с другого устройства не приезжала.
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

function cloudEdit(pg: InMemoryPostgres, uid: string, uuid: string, version: number, text: string): number {
  pg.executeInsert('versions', {
    document_uuid: uuid, user_id: uid, version, content: text, word_count: 2,
    duration: 1, wpm: 1, _encrypted: false,
    saved_at: new Date().toISOString(), session_started_at: new Date().toISOString(),
  });
  pg.executeUpdate('documents', { current_version: version }, [{ type: 'eq', column: 'uuid', value: uuid }]);
  return Number(pg.getRows('documents').find(r => r.uuid === uuid)!.rev);
}

async function latestLocalText(uid: string, uuid: string): Promise<string> {
  const db = await getLocalDb(uid);
  const doc = (await db.getAll('documents')).find(d => d.guestId === uid && d.uuid === uuid)!;
  const vs = await db.getAllFromIndex('versions', 'by-document', doc.id);
  return vs.sort((a, b) => b.version - a.version)[0]?.content ?? '';
}

describe('S1-11: LOCK_HELD stops the pull on the previous row', () => {
  const runner = new LifecycleRunner();
  afterEach(() => {
    setEncryptionEnabled(runner.userId, false);
    runner.teardown();
    forgetDevice();
  });

  it('a locked note is not passed by the cursor; after the lock is released it arrives', async () => {
    activateDevice(new Device('B'));
    runner.userId = 'user_pull_busy';
    await runner.setup();
    const uid = runner.userId;
    const pg = runner.interceptor.postgres;
    seedCloudNote(pg, uid, 'busy-x', 'old x');
    seedCloudNote(pg, uid, 'busy-y', 'old y');
    await SyncService.pullNotes(uid);
    expect(await latestLocalText(uid, 'busy-x')).toBe('old x');

    // Телефон правит X и Y; ноутбук в это время держит замок X (выгрузка).
    const revX = cloudEdit(pg, uid, 'busy-x', 2, 'new x');
    const revY = cloudEdit(pg, uid, 'busy-y', 2, 'new y');
    const db = await getLocalDb(uid);
    const localX = (await db.getAll('documents')).find(d => d.uuid === 'busy-x')!;
    await db.put('syncQueue', {
      id: `lock_cloud_${localX.id}`, documentId: localX.id, type: 'document',
      createdAt: Date.now(), ownerToken: 'other-tab',
    } as never);

    const res = await SyncService.pullNotes(uid);
    expect(res.locked).toBeFalsy();
    expect(await latestLocalText(uid, 'busy-x')).toBe('old x');
    // Курсор остался ПЕРЕД строкой X: строка не применена — она не пройдена.
    expect((await getSyncRevCursor(uid)).documents).toBeLessThan(revX);
    expect(revY).toBeGreaterThan(revX);

    await db.delete('syncQueue', `lock_cloud_${localX.id}`);
    await SyncService.pullNotes(uid);
    expect(await latestLocalText(uid, 'busy-x')).toBe('new x');
    expect(await latestLocalText(uid, 'busy-y')).toBe('new y');
    expect((await getSyncRevCursor(uid)).documents).toBe(revY);
  });
});
