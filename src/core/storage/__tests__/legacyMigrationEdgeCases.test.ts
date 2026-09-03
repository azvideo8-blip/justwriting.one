import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';

const USER_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const USER_B = 'bbbbbbbb-2222-4222-8222-222222222222';

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER_A }),
  getCurrentUserId: () => USER_A,
}));

const { getLocalDb } = await import('../localDb');

function doc(id: string, guestId: string) {
  return {
    id, uuid: `uuid-${id}`, guestId, title: id,
    currentVersion: 1, totalWords: 10, totalDuration: 0, sessionsCount: 1,
    firstSessionAt: 1, lastSessionAt: 1, tags: [],
  };
}

describe('Area 2: Migration under non-happy-path conditions', () => {
  beforeEach(async () => {
    localStorage.clear();
    const dbs = ['justwriting-local', `justwriting-local-${USER_A}`, `justwriting-local-${USER_B}`];
    for (const name of dbs) {
      await deleteDB(name).catch(() => {});
    }
  });

  it('FAILING TEST 1: empty userDocs must set migration flag to avoid repeated legacy scans', async () => {
    // Legacy DB has 0 docs for USER_A
    const legacy = await getLocalDb('justwriting-local');
    await legacy.clear('documents');

    // Trigger migration for USER_A
    await getLocalDb(USER_A);

    // Expected: migration key MUST be set so future calls don't scan legacy DB
    expect(localStorage.getItem(`jw_legacy_migrated_${USER_A}`)).toBe('1');
  });

  it('FAILING TEST 2: two accounts in legacy DB: second account must NOT steal unowned records', async () => {
    // Legacy DB has docs from BOTH USER_A and USER_B
    const legacy = await getLocalDb('justwriting-local');
    await legacy.put('documents', doc('doc_a', USER_A) as never);
    await legacy.put('documents', doc('doc_b', USER_B) as never);
    // Unowned portrait singleton
    await legacy.put('aiPortrait', { id: 'singleton', portrait: 'Secret psychological diary of USER_A', updatedAt: 1 } as never);

    // 1. User A migrates first
    const dbA = await getLocalDb(USER_A);
    const portraitA = await dbA.get('aiPortrait', 'singleton');
    // User A correctly does not claim portrait because legacy DB had 2 owners
    expect(portraitA).toBeUndefined();

    // 2. User B migrates second
    // At this point, User A's doc_a was deleted from legacy DB, so legacy DB only contains doc_b!
    const dbB = await getLocalDb(USER_B);
    const portraitB = await dbB.get('aiPortrait', 'singleton');

    // USER_B MUST NOT CLAIM USER_A'S PORTRAIT!
    // Currently this FAILS because User B sees ownersInLegacy.size === 1!
    expect(portraitB).toBeUndefined();
  });
});
