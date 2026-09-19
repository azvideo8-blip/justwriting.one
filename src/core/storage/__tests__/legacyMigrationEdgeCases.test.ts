import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';

const USER_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const USER_B = 'bbbbbbbb-2222-4222-8222-222222222222';

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER_A }),
  getCurrentUserId: () => USER_A,
}));

const { getLocalDb, migrateLegacyIfNeeded } = await import('../localDb');

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
      aiFacets: { id: 'facet_1', name: 'Secret facet of USER_A' },
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
    };

    const targetStores = [
      'aiPortrait',
      'aiBeliefs',
      'aiBeliefRejections',
      'aiChatMemory',
      'aiFacets',
      'aiSummaries',
      'aiEmbeddings',
      'aiDialogues',
      'aiDialogueEvents',
      'aiThemeLedger',
      'aiTimeline',
      'aiMonthlyDigest',
      'aiPersonas',
      'aiThreads',
      'lifeStory',
      'aiCommitments',
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

  it('CONSOL-3 & LEGACY-1: migrateLegacyIfNeeded wipes aiBeliefRejections and all unowned AI stores when multi-owner detected', async () => {
    const legacy = await getLocalDb('justwriting-local');
    await legacy.put('documents', doc('doc_user_a', USER_A) as never);
    await legacy.put('documents', doc('doc_user_b', USER_B) as never);

    await legacy.put('aiPortrait', { id: 'singleton', portrait: 'Portrait text', updatedAt: 1 } as never);
    await legacy.put('aiBeliefs', { id: 'belief-1', belief: 'Belief text', evidence: [], firstSeenAt: '2026-01-01', clusterSize: 1, createdAt: 1, updatedAt: 1, judgeVerdict: 'PASSED', unitIds: [] } as never);
    await legacy.put('aiChatMemory', { id: 'mem-1', kind: 'fact', text: 'Memory text', sourceDialogueId: 'dlg-1', createdAt: 1, updatedAt: 1 } as never);
    await legacy.put('aiBeliefRejections', { id: 'rej-1', timestamp: 1, clusterSize: 1, firstSeenAt: '2026-01-01', reason: 'Distortion', kind: 'judge_rejected', rewriteAttempted: false, rejectedTextSnippet: 'Rejected quote', unitIds: [] } as never);
    await legacy.put('aiThemeLedger', { id: 'theme-1', theme: 'Theme text' } as never);
    await legacy.put('aiTimeline', { documentId: 'doc-1', date: '2026-07-01' } as never);
    await legacy.put('aiMonthlyDigest', { month: '2026-07', narrative: 'Digest text' } as never);
    await legacy.put('aiPersonas', { id: 'persona-1', name: 'Persona' } as never);
    await legacy.put('aiThreads', { id: 'thread-1', summary: 'Thread' } as never);
    await legacy.put('lifeStory', { eventDate: '2026-07-01', text: 'Life story' } as never);
    await legacy.put('aiCommitments', { id: 'comm-1', text: 'Commitment' } as never);

    await migrateLegacyIfNeeded(`justwriting-local-${USER_A}`, USER_A);

    const unownedStores = [
      'aiPortrait',
      'aiBeliefs',
      'aiBeliefRejections',
      'aiChatMemory',
      'aiThemeLedger',
      'aiTimeline',
      'aiMonthlyDigest',
      'aiPersonas',
      'aiThreads',
      'lifeStory',
      'aiCommitments',
    ] as const;

    // 1. Assert unowned stores are empty in legacy DB afterward
    for (const store of unownedStores) {
      expect(await legacy.getAll(store as never), `legacy ${store} should be wiped`).toHaveLength(0);
    }

    // 2. Assert target per-account DB contains none of them
    const targetDb = await getLocalDb(USER_A);
    for (const store of unownedStores) {
      expect(await targetDb.getAll(store as never), `target ${store} should be empty`).toHaveLength(0);
    }

    // 3. Target DB only has the calling user's own document
    const targetDocs = await targetDb.getAll('documents');
    expect(targetDocs.map(d => d.id)).toEqual(['doc_user_a']);
  });
});
