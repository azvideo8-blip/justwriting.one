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

    const storeSeeds: Record<string, unknown> = {
      aiPortrait: { id: 'singleton', portrait: 'Secret psychological diary of USER_A', updatedAt: 1 },
      aiBeliefs: { id: 'belief_1', content: 'Secret belief of USER_A' },
      aiChatMemory: { id: 'mem_1', memory: 'Secret memory of USER_A' },
      aiFacets: { id: 'facet_1', name: 'Secret facet of USER_A' },
      aiSummaries: { documentId: 'doc_unowned', summary: 'Secret summary of USER_A' },
      aiEmbeddings: { documentId: 'doc_unowned', embedding: [0.1, 0.2] },
      aiDialogues: { id: 'diag_1', title: 'Secret dialogue of USER_A' },
      aiDialogueEvents: { dialogueId: 'diag_1', event: 'Secret event of USER_A' },
    };

    const targetStores = [
      'aiPortrait',
      'aiBeliefs',
      'aiChatMemory',
      'aiFacets',
      'aiSummaries',
      'aiEmbeddings',
      'aiDialogues',
      'aiDialogueEvents',
    ] as const;

    for (const storeName of targetStores) {
      if (legacy.objectStoreNames.contains(storeName as never)) {
        await legacy.put(storeName as never, storeSeeds[storeName] as never);
      }
    }

    // 1. User A migrates first
    const dbA = await getLocalDb(USER_A);
    for (const storeName of targetStores) {
      if (dbA.objectStoreNames.contains(storeName as never)) {
        const records = await dbA.getAll(storeName as never);
        expect(records, `Store ${storeName} should not be claimed by User A`).toHaveLength(0);
      }
    }

    // 2. User B migrates second
    // At this point, User A's doc_a was deleted from legacy DB, so legacy DB only contains doc_b!
    const dbB = await getLocalDb(USER_B);
    for (const storeName of targetStores) {
      if (dbB.objectStoreNames.contains(storeName as never)) {
        const records = await dbB.getAll(storeName as never);
        expect(records, `Store ${storeName} should not be claimed by User B`).toHaveLength(0);
      }
    }

    // 3. All unowned stores present in legacy DB must have been wiped
    for (const storeName of targetStores) {
      if (legacy.objectStoreNames.contains(storeName as never)) {
        const records = await legacy.getAll(storeName as never);
        expect(records, `Store ${storeName} should be cleared from legacy DB`).toHaveLength(0);
      }
    }
  });
});
