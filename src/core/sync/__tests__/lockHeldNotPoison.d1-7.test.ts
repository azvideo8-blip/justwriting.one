import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { withDocumentLock } from '../withDocumentLock';
import { classifySyncError, isPoisonSyncError } from '../classifySyncError';

/**
 * П-1 (D1-7): текст LOCK_HELD заканчивался словами «is currently locked», и
 * правило LOCKED ловило его по границам слов: занятый замок классифицировался
 * как отравленная ошибка. Читатели ищут только префикс LOCK_HELD.
 */
describe('П-1: занятый замок — не отравленная ошибка', () => {
  beforeEach(async () => {
    const db = await getLocalDb();
    await db.clear('syncQueue');
  });

  it('LOCK_HELD не совпадает с правилом LOCKED, префикс для читателей на месте', async () => {
    let started = false;
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });

    const first = withDocumentLock('doc_d1_7_lock', async () => {
      started = true;
      await gate;
    }, { heartbeat: false });
    await vi.waitFor(() => expect(started).toBe(true));

    const err = await withDocumentLock('doc_d1_7_lock', async () => 'never', { queueOnHeld: false })
      .then(() => null, (e: unknown) => e);
    release();
    await first;

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message.startsWith('LOCK_HELD'), 'читатели ищут префикс').toBe(true);
    expect(isPoisonSyncError(err), 'не отравленная').toBe(false);
    expect(classifySyncError(err)).not.toBe('blocked-until-unlock');
  });
});
