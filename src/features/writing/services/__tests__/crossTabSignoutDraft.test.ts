import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';

let mockCurrentUser: { uid: string } | null = { uid: 'user_alice' };

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => mockCurrentUser,
}));

import { WritingDraftService } from '../WritingDraftService';
import { getLocalDb, LocalDraft } from '../../../../core/storage/localDb';

describe('DEEP-1: Cross-tab sign-out draft partition isolation', () => {
  const ALICE_UID = 'user_alice';
  const GUEST_UID = 'guest';

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    mockCurrentUser = { uid: ALICE_UID };
    await deleteDB('justwriting-local').catch(() => {});
    await deleteDB(`justwriting-local-${ALICE_UID}`).catch(() => {});
  });

  it('writes draft to user partition even after auth state is cleared by another tab sign-out', async () => {
    // Tab A has a draft for Alice
    const draft: LocalDraft = {
      userId: ALICE_UID,
      content: 'Private thoughts from Alice',
      title: '',
      seconds: 0,
      wpm: 0,
      updatedAt: Date.now(),
      wordCount: 4,
    };

    // Tab B signs out: currentUser drops to null
    mockCurrentUser = null;

    // Tab A triggers autosave
    await WritingDraftService.saveToLocal(draft);

    // Verify: NOTHING was written to the shared guest database 'justwriting-local'
    const guestDb = await getLocalDb('justwriting-local');
    const guestDraft = await guestDb.get('drafts', ALICE_UID);
    expect(guestDraft).toBeUndefined();

    const allGuestDrafts = await guestDb.getAll('drafts');
    expect(allGuestDrafts).toHaveLength(0);

    // Verify: The draft was safely written to Alice's private database
    const userDb = await getLocalDb(ALICE_UID);
    const savedUserDraft = await userDb.get('drafts', ALICE_UID);
    expect(savedUserDraft).toBeDefined();
    expect(savedUserDraft?.content).toBe('Private thoughts from Alice');
  });

  it('genuine guest draft writes to justwriting-local', async () => {
    mockCurrentUser = null;
    const guestDraft: LocalDraft = {
      userId: GUEST_UID,
      content: 'Guest text',
      title: '',
      seconds: 0,
      wpm: 0,
      updatedAt: Date.now(),
      wordCount: 2,
    };

    await WritingDraftService.saveToLocal(guestDraft);

    const guestDb = await getLocalDb('justwriting-local');
    const saved = await guestDb.get('drafts', GUEST_UID);
    expect(saved).toBeDefined();
    expect(saved?.content).toBe('Guest text');
  });
});
