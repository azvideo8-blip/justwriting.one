// TEST-1 §2.8: after migration the guest draft is consumed — the source row is
// gone and the localStorage copy is cleared, so the migration prompt cannot
// reappear and the draft cannot resurface as a ghost on the next guest session.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

import { getLocalDb } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { migrateDocuments } from '../migrateDocuments';

beforeEach(async () => {
  localStorage.clear();
  const db = await getLocalDb();
  // fresh stores per test: clear the two stores we touch
  const tx = db.transaction(['drafts', 'documents', 'versions'], 'readwrite');
  await Promise.all([
    tx.objectStore('drafts').clear(),
    tx.objectStore('documents').clear(),
    tx.objectStore('versions').clear(),
  ]);
  await tx.done;
});

describe('2.8 guest draft is consumed by migration', () => {
  it('copies to the user, deletes the source and clears the localStorage copy', async () => {
    const guestDb = await getLocalDb();
    await guestDb.put('drafts', {
      userId: 'guest_draft',
      content: 'черновик гостя до входа',
      updatedAt: Date.now(),
    } as never);
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, 'остаток в localStorage');

    const moved = await migrateDocuments('user_1');

    // The user now owns the draft in userDb…
    const userDb = await getLocalDb('user_1');
    const userDraft = await userDb.get('drafts', 'user_1');
    expect((userDraft as { content?: string })?.content).toBe('черновик гостя до входа');
    // …and the source is consumed either way, with no copy left in guestDb.
    expect(await guestDb.get('drafts', 'guest_draft')).toBeUndefined();
    expect(await guestDb.get('drafts', 'user_1')).toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT)).toBeNull();
    expect(moved.moved).toBeGreaterThanOrEqual(0);
  });

  it('consumes the source even when the user already had a draft', async () => {
    const guestDb = await getLocalDb();
    const userDb = await getLocalDb('user_2');
    await guestDb.put('drafts', { userId: 'guest_draft', content: 'гостевой', updatedAt: Date.now() } as never);
    await userDb.put('drafts', { userId: 'user_2', content: 'уже был черновик', updatedAt: Date.now() } as never);

    await migrateDocuments('user_2');

    expect(await guestDb.get('drafts', 'guest_draft')).toBeUndefined();
    expect(await guestDb.get('drafts', 'user_2')).toBeUndefined();
    expect(((await userDb.get('drafts', 'user_2')) as { content: string }).content).toBe('уже был черновик');
  });
});
