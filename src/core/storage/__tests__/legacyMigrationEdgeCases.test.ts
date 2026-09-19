import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';

const USER_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const USER_B = 'bbbbbbbb-2222-4222-8222-222222222222';

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER_A }),
  getCurrentUserId: () => USER_A,
}));

const { getLocalDb, migrateLegacyIfNeeded, LEGACY_WIPE_STORES } = await import('../localDb');

const storeSeeds: Record<(typeof LEGACY_WIPE_STORES)[number], unknown> = {
  aiPortrait: { id: 'singleton', portrait: 'Secret psychological diary of USER_A', updatedAt: 1 },
  aiBeliefs: { id: 'belief_1', content: 'Secret belief of USER_A' },
  aiBeliefRejections: {
    id: 'rej_1',
    timestamp: 100,
    clusterSize: 1,
    firstSeenAt: '2026-07-01',
    reason: 'Distortion',
    kind: 'judge_rejected',
    rewriteAttempted: false,
    rejectedTextSnippet: 'Secret rejected quote of USER_A',
    unitIds: ['u1'],
  },
  aiChatMemory: { id: 'mem_1', memory: 'Secret memory of USER_A' },
  aiProfileFacets: { id: 'facet_1', label: 'Secret facet of USER_A', summary: 'Summary', _excerptSeed: 'Seed', noteIds: ['n1'] },
  aiSummaries: { documentId: 'doc_unowned', summary: 'Secret summary of USER_A' },
  aiEmbeddings: { documentId: 'doc_unowned', embedding: [0.1, 0.2] },
  aiDialogues: { id: 'diag_1', title: 'Secret dialogue of USER_A' },
  aiDialogueEvents: { dialogueId: 'diag_1', event: 'Secret event of USER_A' },
  aiThemeLedger: { id: 'theme_1', theme: 'Secret theme of USER_A' },
  aiTimeline: { documentId: 'doc_timeline', date: '2026-07-01', summary: 'Secret timeline of USER_A' },
  aiMonthlyDigest: { month: '2026-07', narrative: 'Secret digest of USER_A' },
  aiPersonas: { id: 'persona_1', name: 'Secret persona of USER_A' },
  aiThreads: { id: 'thread_1', summary: 'Secret thread of USER_A' },
  lifeStory: { eventDate: '2026-07-01', text: 'Secret life story of USER_A' },
  aiCommitments: { id: 'comm_1', text: 'Secret commitment of USER_A' },
  aiDomainVectors: { cacheKey: 'vec_1', seed: 'Taxonomy seed', vector: [0.1, 0.2] },
  aiInjectionJournal: { id: 'inj_1', timestamp: 100, candidates: [{ textSnippet: 'Snippet' }] },
};

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

    for (const storeName of LEGACY_WIPE_STORES) {
      await legacy.put(storeName as never, storeSeeds[storeName] as never);
    }

    // 1. User A migrates first
    const dbA = await getLocalDb(USER_A);
    for (const storeName of LEGACY_WIPE_STORES) {
      const records = await dbA.getAll(storeName as never);
      expect(records, `Store ${storeName} should not be claimed by User A`).toHaveLength(0);
    }

    // 2. User B migrates second
    // At this point, User A's doc_a was deleted from legacy DB, so legacy DB only contains doc_b!
    const dbB = await getLocalDb(USER_B);
    for (const storeName of LEGACY_WIPE_STORES) {
      const records = await dbB.getAll(storeName as never);
      expect(records, `Store ${storeName} should not be claimed by User B`).toHaveLength(0);
    }

    // 3. All unowned stores present in legacy DB must have been wiped
    for (const storeName of LEGACY_WIPE_STORES) {
      const records = await legacy.getAll(storeName as never);
      expect(records, `Store ${storeName} should be cleared from legacy DB`).toHaveLength(0);
    }
  });

  it('CONSOL-3 & LEGACY-1: migrateLegacyIfNeeded wipes aiBeliefRejections and all unowned AI stores when multi-owner detected', async () => {
    const legacy = await getLocalDb('justwriting-local');
    await legacy.put('documents', doc('doc_user_a', USER_A) as never);
    await legacy.put('documents', doc('doc_user_b', USER_B) as never);

    for (const storeName of LEGACY_WIPE_STORES) {
      await legacy.put(storeName as never, storeSeeds[storeName] as never);
    }

    await migrateLegacyIfNeeded(`justwriting-local-${USER_A}`, USER_A);

    // 1. Assert unowned stores are empty in legacy DB afterward
    for (const store of LEGACY_WIPE_STORES) {
      expect(await legacy.getAll(store as never), `legacy ${store} should be wiped`).toHaveLength(0);
    }

    // 2. Assert target per-account DB contains none of them
    const targetDb = await getLocalDb(USER_A);
    for (const store of LEGACY_WIPE_STORES) {
      expect(await targetDb.getAll(store as never), `target ${store} should be empty`).toHaveLength(0);
    }

    // 3. Target DB only has the calling user's own document
    const targetDocs = await targetDb.getAll('documents');
    expect(targetDocs.map(d => d.id)).toEqual(['doc_user_a']);
  });

  it('LEGACY-4: single-owner migration copies aiPortrait to account DB and clears it from legacy DB', async () => {
    const legacy = await getLocalDb('justwriting-local');
    await legacy.put('documents', doc('doc_single', USER_A) as never);
    await legacy.put('aiPortrait', { id: 'singleton', portrait: 'User A portrait', updatedAt: 1 } as never);

    await migrateLegacyIfNeeded(`justwriting-local-${USER_A}`, USER_A);

    const targetDb = await getLocalDb(USER_A);
    // Account DB has the document and the portrait
    const targetDoc = await targetDb.get('documents', 'doc_single');
    expect(targetDoc).toBeDefined();
    const targetPortrait = await targetDb.get('aiPortrait', 'singleton');
    expect(targetPortrait).toBeDefined();
    expect((targetPortrait as { portrait?: string })?.portrait).toBe('User A portrait');

    // Legacy DB has neither the document nor the portrait
    const legacyDoc = await legacy.get('documents', 'doc_single');
    expect(legacyDoc).toBeUndefined();
    const legacyPortrait = await legacy.get('aiPortrait', 'singleton');
    expect(legacyPortrait).toBeUndefined();
  });

  it('LEGACY-4 negative: when copyFailed is forced, legacy portrait survives', async () => {
    const legacy = await getLocalDb('justwriting-local');
    await legacy.put('documents', doc('doc_single', USER_A) as never);
    await legacy.put('aiPortrait', { id: 'singleton', portrait: 'User A portrait', updatedAt: 1 } as never);

    const origPut = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: any, key?: any) {
      if (this.name === 'aiPortrait' && this.transaction.db.name === `justwriting-local-${USER_A}`) {
        throw new Error('Forced copy failure for test');
      }
      return origPut.call(this, value, key);
    });

    try {
      await migrateLegacyIfNeeded(`justwriting-local-${USER_A}`, USER_A);

      // Verification failed due to copyFailed -> legacy originals must survive
      const legacyDoc = await legacy.get('documents', 'doc_single');
      expect(legacyDoc).toBeDefined();
      const legacyPortrait = await legacy.get('aiPortrait', 'singleton');
      expect(legacyPortrait).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });
});
