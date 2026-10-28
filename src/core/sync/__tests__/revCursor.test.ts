import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { clearAllLocalStores, getLocalDb, syncRevCursorKey } from '../../storage/localDb';
import { advanceSyncRevCursor, clearSyncRevCursor, getSyncRevCursor } from '../revCursor';
import { clearOtherUserData } from '../../../features/auth/services/localDataInventory';

/**
 * S1-5: курсор забора — отдельная запись в базе аккаунта, по таблицам и с uid
 * в ключе. Проверяем и то, что он сбрасывается на путях, которые стирают
 * заметки, не стирая базу.
 */
describe('sync rev cursor (S1-5)', () => {
  const A = 'u_cursor_a';
  const B = 'u_cursor_b';

  async function wipe() {
    await clearAllLocalStores(A);
    await clearAllLocalStores(B);
    await clearAllLocalStores('justwriting-local');
  }

  beforeEach(wipe);

  it('starts at zero and advances per table', async () => {
    expect(await getSyncRevCursor(A)).toEqual({ documents: 0, versions: 0 });
    await advanceSyncRevCursor(A, 'documents', 5);
    expect(await getSyncRevCursor(A)).toEqual({ documents: 5, versions: 0 });
    await advanceSyncRevCursor(A, 'versions', 3);
    expect(await getSyncRevCursor(A)).toEqual({ documents: 5, versions: 3 });
  });

  it('keeps accounts apart and stores the uid in the record key', async () => {
    await advanceSyncRevCursor(A, 'documents', 9);
    expect(await getSyncRevCursor(B)).toEqual({ documents: 0, versions: 0 });
    const dbA = await getLocalDb(A);
    const record = await dbA.get('profile', syncRevCursorKey(A));
    expect(record?.syncRevCursor).toEqual({ documents: 9, versions: 0 });
    expect(syncRevCursorKey(A)).toContain(A);
  });

  it('never moves backwards', async () => {
    await advanceSyncRevCursor(A, 'documents', 9);
    await advanceSyncRevCursor(A, 'documents', 4);
    expect((await getSyncRevCursor(A)).documents).toBe(9);
  });

  it('unreadable cursor means a full pull, not a skip', async () => {
    const db = await getLocalDb(A);
    await db.put('profile', {
      guestId: syncRevCursorKey(A),
      totalWords: 0, sessionsCount: 0, totalDuration: 0, lastSessionAt: 0,
      syncRevCursor: { documents: -1, versions: 'nine' },
    } as never);
    expect(await getSyncRevCursor(A)).toEqual({ documents: 0, versions: 0 });
  });

  it('clears on wipe-all and on explicit clear', async () => {
    await advanceSyncRevCursor(A, 'documents', 4);
    await clearSyncRevCursor(A);
    expect(await getSyncRevCursor(A)).toEqual({ documents: 0, versions: 0 });

    await advanceSyncRevCursor(A, 'documents', 4);
    await clearAllLocalStores(A);
    expect(await getSyncRevCursor(A)).toEqual({ documents: 0, versions: 0 });
  });

  it('clearOtherUserData removes the other account cursor from the shared db', async () => {
    const shared = await getLocalDb('justwriting-local');
    await shared.put('documents', { id: 'd_other', guestId: 'u_other', title: 'x' } as never);
    await shared.put('profile', {
      guestId: syncRevCursorKey('u_other'),
      totalWords: 0, sessionsCount: 0, totalDuration: 0, lastSessionAt: 0,
      syncRevCursor: { documents: 7, versions: 7 },
    } as never);

    await clearOtherUserData('u_current');

    expect(await shared.get('documents', 'd_other')).toBeUndefined();
    expect(await shared.get('profile', syncRevCursorKey('u_other'))).toBeUndefined();
  });
});
