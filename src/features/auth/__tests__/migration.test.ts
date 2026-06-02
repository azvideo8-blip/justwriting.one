/**
 * Comprehensive tests for guest→account data migration logic.
 *
 * Covers:
 *  - migrateDocuments() in MigrationPrompt.tsx  (re-keys IDB docs from guestId→userId)
 *  - SyncService.syncAllUnlinked()              (uploads local IDB docs to Firestore)
 *  - StorageService.addCloudCopy()             (creates Firestore doc + versions)
 */

// ── Must be first: patch globalThis.indexedDB before any idb import ──────────
import 'fake-indexeddb/auto';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — must be declared before any subject imports.
// vi.mock factories are hoisted so they cannot close over top-level variables.
// We use vi.hoisted() to create the shared state that both the factory and the
// test body can reference.
// ─────────────────────────────────────────────────────────────────────────────
const { cloudDocs, cloudVersions, MockDocumentService, MockVersionService } = vi.hoisted(() => {
  const cloudDocs = new Map<string, Record<string, unknown>>();
  const cloudVersions = new Map<string, Record<string, unknown>[]>();

  const MockDocumentService = {
    createDocument: vi.fn(async (_userId: string, data: Record<string, unknown>) => {
      const id = `cloud_${Math.random().toString(36).slice(2)}`;
      cloudDocs.set(id, { id, ...data, totalWords: 0, totalDuration: 0, currentVersion: 0 });
      return id;
    }),
    getDocument: vi.fn(async (_userId: string, id: string) => cloudDocs.get(id) ?? null),
    updateDocumentAfterSession: vi.fn(async (_userId: string, id: string, data: Record<string, unknown>) => {
      const doc = cloudDocs.get(id);
      if (doc) cloudDocs.set(id, { ...doc, ...data });
    }),
    deleteDocument: vi.fn(async (_userId: string, id: string) => { cloudDocs.delete(id); }),
  };

  const MockVersionService = {
    addVersion: vi.fn(async (_userId: string, docId: string, data: Record<string, unknown>) => {
      const versions = cloudVersions.get(docId) ?? [];
      versions.push(data);
      cloudVersions.set(docId, versions);
      return `ver_cloud_${Math.random().toString(36).slice(2)}`;
    }),
    getVersions: vi.fn(async (_userId: string, docId: string) => cloudVersions.get(docId) ?? []),
  };

  return { cloudDocs, cloudVersions, MockDocumentService, MockVersionService };
});

vi.mock('../../../core/services/DocumentService', () => ({
  DocumentService: MockDocumentService,
}));

vi.mock('../../../core/services/VersionService', () => ({
  VersionService: MockVersionService,
}));

vi.mock('../../../core/crypto/cryptoHelpers', () => ({
  maybeEncrypt: vi.fn(async (doc: Record<string, unknown>) => ({ ...doc, _encrypted: false })),
  maybeDecrypt: vi.fn(async (doc: Record<string, unknown>) => doc),
}));

vi.mock('../../../core/firebase/firestore', () => ({
  isFirestoreConnected: true,
  onConnectionChange: vi.fn(),
}));

// Mock localDb — keep everything real but override getOrCreateGuestId
vi.mock('../../../core/storage/localDb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/storage/localDb')>();
  return {
    ...actual,
    getOrCreateGuestId: () => 'guest_test123',
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Subject imports (after mocks are registered)
// ─────────────────────────────────────────────────────────────────────────────
import { getLocalDb, resetDbInstance } from '../../../core/storage/localDb';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { SyncService } from '../../../core/services/SyncService';
import { StorageService } from '../../../core/services/StorageService';

// ─────────────────────────────────────────────────────────────────────────────
// migrateDocuments() extracted for direct testing
// (identical logic to the private function in MigrationPrompt.tsx)
// ─────────────────────────────────────────────────────────────────────────────
async function migrateDocuments(guestId: string, userId: string): Promise<number> {
  const db = await getLocalDb();
  const guestDocs = await db.getAllFromIndex('documents', 'by-guest', guestId);
  if (guestDocs.length === 0) return 0;

  const guestVersions = await db.getAll('versions');
  const versionsToMigrate = guestVersions.filter(v => v.guestId === guestId);

  const tx = db.transaction(['documents', 'versions'], 'readwrite');
  const docStore = tx.objectStore('documents');
  const verStore = tx.objectStore('versions');

  await Promise.all([
    ...guestDocs.map(doc => docStore.put({ ...doc, guestId: userId })),
    ...versionsToMigrate.map(ver => verStore.put({ ...ver, guestId: userId })),
    tx.done,
  ]);

  return guestDocs.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const GUEST_ID = 'guest_test123';
const USER_ID  = 'user_firebase123';

async function resetIdb(): Promise<void> {
  // 1. Reset the module-level singleton so next getLocalDb() call opens fresh
  resetDbInstance();

  // 2. Delete the physical database so the schema is rebuilt from scratch
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('justwriting-local');
    req.onsuccess = () => resolve();
    req.onerror   = () => resolve();
    req.onblocked = () => resolve();
  });
}

interface SeedDoc {
  title: string;
  tags?: string[];
  versions: Array<{ content: string; wordCount: number }>;
}

async function seedGuestData(docs: SeedDoc[]): Promise<{ docIds: string[] }> {
  const docIds: string[] = [];

  for (const docSpec of docs) {
    const docId = await LocalDocumentService.createDocument(GUEST_ID, {
      title: docSpec.title,
      tags: docSpec.tags ?? [],
    });
    docIds.push(docId);

    for (let i = 0; i < docSpec.versions.length; i++) {
      const ver = docSpec.versions[i];
      if (!ver) continue;
      await LocalVersionService.addVersion(GUEST_ID, docId, {
        content: ver.content,
        previousContent: i === 0 ? '' : (docSpec.versions[i - 1]?.content ?? ''),
        wordCount: ver.wordCount,
        duration: 60,
        wpm: ver.wordCount,
        versionNumber: i + 1,
        sessionStartedAt: new Date(Date.now() - (docSpec.versions.length - i) * 1000),
      });
    }

    if (docSpec.versions.length > 0) {
      const lastVer = docSpec.versions[docSpec.versions.length - 1];
      if (lastVer) {
        await LocalDocumentService.updateAfterSession(docId, {
          totalWords: lastVer.wordCount,
          totalDuration: 60 * docSpec.versions.length,
          currentVersion: docSpec.versions.length,
        });
      }
    }
  }

  return { docIds };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reset state between every test
// ─────────────────────────────────────────────────────────────────────────────
beforeEach(async () => {
  await resetIdb();
  cloudDocs.clear();
  cloudVersions.clear();
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  // Reset the _syncInProgress guard in SyncService (private module-level Map).
  // We do this by casting through unknown.
  const syncModule = SyncService as unknown as { _syncInProgress?: Map<string, boolean> };
  if (syncModule._syncInProgress) {
    syncModule._syncInProgress.clear();
  }
});

afterEach(() => {
  resetDbInstance();
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP A — Base data states
// ─────────────────────────────────────────────────────────────────────────────
describe('GROUP A — Base data states', () => {
  it('A01: empty archive — migration succeeds, returns 0', async () => {
    const count = await migrateDocuments(GUEST_ID, USER_ID);
    expect(count).toBe(0);
  });

  it('A02: single doc, single version — guestId re-keyed to userId', async () => {
    await seedGuestData([
      { title: 'My First Doc', versions: [{ content: 'Hello world', wordCount: 2 }] },
    ]);

    const count = await migrateDocuments(GUEST_ID, USER_ID);
    expect(count).toBe(1);

    const userDocs = await LocalDocumentService.getGuestDocuments(USER_ID);
    expect(userDocs).toHaveLength(1);
    expect(userDocs[0]?.title).toBe('My First Doc');
    expect(userDocs[0]?.guestId).toBe(USER_ID);

    const db = await getLocalDb();
    const versions = await db.getAll('versions');
    expect(versions).toHaveLength(1);
    expect(versions[0]?.guestId).toBe(USER_ID);
  });

  it('A03: 5 docs with varying version counts — all re-keyed', async () => {
    await seedGuestData([
      { title: 'Doc 1', versions: [{ content: 'a', wordCount: 1 }] },
      { title: 'Doc 2', versions: [{ content: 'a', wordCount: 1 }, { content: 'b', wordCount: 2 }] },
      {
        title: 'Doc 3',
        versions: [
          { content: 'a', wordCount: 1 },
          { content: 'b', wordCount: 2 },
          { content: 'c', wordCount: 3 },
        ],
      },
      {
        title: 'Doc 4',
        versions: [
          { content: 'a', wordCount: 1 },
          { content: 'b', wordCount: 2 },
          { content: 'c', wordCount: 3 },
          { content: 'd', wordCount: 4 },
        ],
      },
      {
        title: 'Doc 5',
        versions: [
          { content: 'a', wordCount: 1 },
          { content: 'b', wordCount: 2 },
          { content: 'c', wordCount: 3 },
          { content: 'd', wordCount: 4 },
          { content: 'e', wordCount: 5 },
        ],
      },
    ]);

    const count = await migrateDocuments(GUEST_ID, USER_ID);
    expect(count).toBe(5);

    const userDocs = await LocalDocumentService.getGuestDocuments(USER_ID);
    expect(userDocs).toHaveLength(5);

    const db = await getLocalDb();
    const allVersions = await db.getAll('versions');
    // Total versions: 1+2+3+4+5 = 15
    expect(allVersions).toHaveLength(15);
    for (const ver of allVersions) {
      expect(ver.guestId).toBe(USER_ID);
    }

    // Old guest id should be gone
    const guestDocs = await LocalDocumentService.getGuestDocuments(GUEST_ID);
    expect(guestDocs).toHaveLength(0);
  });

  it('A04: docs with tags — tags preserved after migration', async () => {
    await seedGuestData([
      { title: 'Tagged Doc', tags: ['tag1', 'tag2'], versions: [{ content: 'content', wordCount: 1 }] },
    ]);

    await migrateDocuments(GUEST_ID, USER_ID);

    const userDocs = await LocalDocumentService.getGuestDocuments(USER_ID);
    expect(userDocs[0]?.tags).toEqual(['tag1', 'tag2']);
  });

  it('A05: doc with empty title and no tags — empty strings/arrays handled', async () => {
    await seedGuestData([
      { title: '', tags: [], versions: [{ content: '', wordCount: 0 }] },
    ]);

    const count = await migrateDocuments(GUEST_ID, USER_ID);
    expect(count).toBe(1);

    const userDocs = await LocalDocumentService.getGuestDocuments(USER_ID);
    expect(userDocs[0]?.title).toBe('');
    expect(userDocs[0]?.tags).toEqual([]);
  });

  it('A06: doc with very large content (100KB) — transaction handles it', async () => {
    const largeContent = 'a '.repeat(50_000); // ~100KB
    await seedGuestData([
      { title: 'Large Doc', versions: [{ content: largeContent, wordCount: 50_000 }] },
    ]);

    const count = await migrateDocuments(GUEST_ID, USER_ID);
    expect(count).toBe(1);

    const db = await getLocalDb();
    const versions = await db.getAll('versions');
    expect(versions[0]?.content).toBe(largeContent);
    expect(versions[0]?.guestId).toBe(USER_ID);
  });

  it('A07: doc with 20+ versions — all versions re-keyed', async () => {
    const versionCount = 22;
    const versions = Array.from({ length: versionCount }, (_, i) => ({
      content: `Version ${i + 1} content`,
      wordCount: i + 1,
    }));

    await seedGuestData([{ title: 'Many Versions', versions }]);

    const count = await migrateDocuments(GUEST_ID, USER_ID);
    expect(count).toBe(1);

    const db = await getLocalDb();
    const allVersions = await db.getAll('versions');
    expect(allVersions).toHaveLength(versionCount);
    for (const ver of allVersions) {
      expect(ver.guestId).toBe(USER_ID);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP B — Error / interruption scenarios
// ─────────────────────────────────────────────────────────────────────────────
describe('GROUP B — Error/interruption scenarios', () => {
  it('B01: Firestore unavailable — IDB re-keying done, cloud sync fails gracefully', async () => {
    await seedGuestData([
      { title: 'Doc A', versions: [{ content: 'hello', wordCount: 1 }] },
      { title: 'Doc B', versions: [{ content: 'world', wordCount: 1 }] },
    ]);

    // Migrate IDB first
    const migratedCount = await migrateDocuments(GUEST_ID, USER_ID);
    expect(migratedCount).toBe(2);

    // Firestore is down
    MockDocumentService.createDocument.mockRejectedValue(new Error('Firestore unavailable'));

    const result = await SyncService.syncAllUnlinked(USER_ID);

    expect(result.synced).toBe(0);
    expect(result.failed).toBe(2);

    // IDB should still have user docs (IDB migration was not rolled back)
    const userDocs = await LocalDocumentService.getGuestDocuments(USER_ID);
    expect(userDocs).toHaveLength(2);
  });

  it('B02: one of N docs fails cloud sync — others succeed (Promise.allSettled)', async () => {
    await seedGuestData([
      { title: 'Success Doc', versions: [{ content: 'hello', wordCount: 1 }] },
      { title: 'Fail Doc', versions: [{ content: 'world', wordCount: 1 }] },
      { title: 'Success Doc 2', versions: [{ content: 'foo', wordCount: 1 }] },
    ]);

    await migrateDocuments(GUEST_ID, USER_ID);

    let callCount = 0;
    MockDocumentService.createDocument.mockImplementation(async (_uid: string, data: Record<string, unknown>) => {
      callCount++;
      // Make the second doc fail
      if (callCount === 2) throw new Error('Firestore write failed');
      const id = `cloud_${Math.random().toString(36).slice(2)}`;
      cloudDocs.set(id, { id, ...data, totalWords: 0, totalDuration: 0, currentVersion: 0 });
      return id;
    });

    const result = await SyncService.syncAllUnlinked(USER_ID);

    expect(result.synced).toBe(2);
    expect(result.failed).toBe(1);
  });

  it('B03: addCloudCopy called twice for same doc — second call returns early via lock', async () => {
    const { docIds } = await seedGuestData([
      { title: 'Lockable Doc', versions: [{ content: 'test', wordCount: 1 }] },
    ]);
    await migrateDocuments(GUEST_ID, USER_ID);
    const docId = docIds[0];
    if (!docId) throw new Error('Seeding failed');

    // Simulate a lock already in syncQueue for this doc
    const db = await getLocalDb();
    await db.put('syncQueue', {
      id: `lock_cloud_${docId}`,
      documentId: docId,
      type: 'document' as const,
      createdAt: Date.now(),
    });

    const cloudId = await StorageService.addCloudCopy(USER_ID, docId);

    // Should return '' because lock was already present
    expect(cloudId).toBe('');
    expect(MockDocumentService.createDocument).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP C — Concurrent scenarios
// ─────────────────────────────────────────────────────────────────────────────
describe('GROUP C — Concurrent scenarios', () => {
  it('C01: syncAllUnlinked called twice simultaneously — second call bails early', async () => {
    await seedGuestData([
      { title: 'Doc', versions: [{ content: 'content', wordCount: 1 }] },
    ]);
    await migrateDocuments(GUEST_ID, USER_ID);

    // Make the first call artificially slow so the second overlaps
    let resolveSlow!: () => void;
    const slowPromise = new Promise<void>(resolve => { resolveSlow = resolve; });

    MockDocumentService.createDocument.mockImplementationOnce(async () => {
      await slowPromise;
      const id = `cloud_slow_${Math.random().toString(36).slice(2)}`;
      cloudDocs.set(id, { id, totalWords: 0, totalDuration: 0, currentVersion: 0, title: 'Doc', tags: [] });
      return id;
    });

    // Launch first (will hang until we resolve the promise)
    const first = SyncService.syncAllUnlinked(USER_ID);
    // Launch second immediately — should detect _syncInProgress = true
    const second = SyncService.syncAllUnlinked(USER_ID);

    // Second should resolve immediately with zeros
    const secondResult = await second;
    expect(secondResult).toEqual({ synced: 0, failed: 0 });

    // Unblock first
    resolveSlow();
    const firstResult = await first;
    expect(firstResult.synced + firstResult.failed).toBeGreaterThan(0);
  });

  it('C02: doc with linkedCloudId already set — skipped in syncAllUnlinked', async () => {
    const { docIds } = await seedGuestData([
      { title: 'Already Linked', versions: [{ content: 'hi', wordCount: 1 }] },
    ]);
    await migrateDocuments(GUEST_ID, USER_ID);
    const docId = docIds[0];
    if (!docId) throw new Error('Seeding failed');

    // Pre-set linked cloud ID
    await LocalDocumentService.updateLinkedCloudId(docId, 'cloud_already_linked_xyz');

    const result = await SyncService.syncAllUnlinked(USER_ID);

    // No unlinked docs → nothing synced
    expect(result.synced).toBe(0);
    expect(result.failed).toBe(0);
    expect(MockDocumentService.createDocument).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP D — Idempotency
// ─────────────────────────────────────────────────────────────────────────────
describe('GROUP D — Idempotency', () => {
  it('D01: migrateDocuments called twice — idempotent, no crash', async () => {
    await seedGuestData([
      { title: 'Idempotent Doc', versions: [{ content: 'text', wordCount: 1 }] },
    ]);

    // First migration: guestId → userId
    const count1 = await migrateDocuments(GUEST_ID, USER_ID);
    expect(count1).toBe(1);

    // Second migration: userId docs re-keyed to userId again (no-op effectively)
    // migrateDocuments looks for docs with guestId=GUEST_ID; after first run
    // there are none, so it should return 0 without crashing.
    const count2 = await migrateDocuments(GUEST_ID, USER_ID);
    expect(count2).toBe(0);

    // Data should still be intact
    const userDocs = await LocalDocumentService.getGuestDocuments(USER_ID);
    expect(userDocs).toHaveLength(1);
  });

  it('D02: cloud doc already exists when addCloudCopy runs — returns existing cloudId', async () => {
    const { docIds } = await seedGuestData([
      { title: 'Pre-linked', versions: [{ content: 'content', wordCount: 1 }] },
    ]);
    await migrateDocuments(GUEST_ID, USER_ID);
    const docId = docIds[0];
    if (!docId) throw new Error('Seeding failed');

    const existingCloudId = 'cloud_pre_existing_123';
    cloudDocs.set(existingCloudId, {
      id: existingCloudId,
      title: 'Pre-linked',
      tags: [],
      totalWords: 1,
      totalDuration: 60,
      currentVersion: 1,
    });

    // Set linked cloud id on local doc
    await LocalDocumentService.updateLinkedCloudId(docId, existingCloudId);

    // MockDocumentService.getDocument returns the pre-existing doc
    MockDocumentService.getDocument.mockResolvedValueOnce(cloudDocs.get(existingCloudId) ?? null);

    const returnedId = await StorageService.addCloudCopy(USER_ID, docId);

    expect(returnedId).toBe(existingCloudId);
    // createDocument should NOT have been called (returned the existing one)
    expect(MockDocumentService.createDocument).not.toHaveBeenCalled();
  });

  it('D03: doc with invalid sessionStartedAt (NaN) — reveals silent bug: NaN is falsy so fallback date used instead of throwing', async () => {
    // BUG FOUND: In StorageService.addCloudCopy the check is:
    //   const startedAt = ver.sessionStartedAt ? new Date(ver.sessionStartedAt) : new Date(ver.savedAt || Date.now());
    // NaN is falsy in JavaScript, so a NaN sessionStartedAt silently falls
    // through to the fallback (savedAt / Date.now()) instead of triggering
    // the isNaN guard.  Both docs therefore "succeed" — the bad timestamp
    // is swallowed rather than rejected.  This test documents the actual behavior.
    const { docIds: badDocIds } = await seedGuestData([
      { title: 'Bad Date Doc', versions: [{ content: 'text', wordCount: 1 }] },
    ]);
    const { docIds: goodDocIds } = await seedGuestData([
      { title: 'Good Date Doc', versions: [{ content: 'text', wordCount: 1 }] },
    ]);
    const badDocId = badDocIds[0];
    const goodDocId = goodDocIds[0];
    if (!badDocId || !goodDocId) throw new Error('Seeding failed');

    await migrateDocuments(GUEST_ID, USER_ID);

    // Corrupt the sessionStartedAt field of the bad doc's version
    const db = await getLocalDb();
    const allVersions = await db.getAll('versions');
    const badVersions = allVersions.filter(v => v.documentId === badDocId);
    for (const ver of badVersions) {
      await db.put('versions', { ...ver, sessionStartedAt: NaN });
    }

    // NaN sessionStartedAt now correctly triggers the isNaN guard and throws,
    // instead of silently falling back to savedAt (the old buggy behavior).
    const results = await Promise.allSettled([
      StorageService.addCloudCopy(USER_ID, badDocId),
      StorageService.addCloudCopy(USER_ID, goodDocId),
    ]);

    const statuses = results.map(r => r.status);
    expect(statuses).toEqual(['rejected', 'fulfilled']);

    // Bad doc: createDocument called then rolled back via deleteDocument.
    // Good doc: createDocument called and succeeds.
    expect(MockDocumentService.createDocument).toHaveBeenCalledTimes(2);
    expect(MockDocumentService.deleteDocument).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP E — Post-migration state verification
// ─────────────────────────────────────────────────────────────────────────────
describe('GROUP E — Post-migration state', () => {
  it('E01: after migrateDocuments, getGuestDocuments(userId) finds all docs', async () => {
    const docCount = 4;
    await seedGuestData(
      Array.from({ length: docCount }, (_, i) => ({
        title: `Doc ${i + 1}`,
        versions: [{ content: `Content ${i}`, wordCount: i + 1 }],
      }))
    );

    await migrateDocuments(GUEST_ID, USER_ID);

    const userDocs = await LocalDocumentService.getGuestDocuments(USER_ID);
    expect(userDocs).toHaveLength(docCount);
  });

  it('E02: after migrateDocuments, getGuestDocuments(guestId) returns empty', async () => {
    await seedGuestData([
      { title: 'Doc', versions: [{ content: 'text', wordCount: 1 }] },
    ]);

    await migrateDocuments(GUEST_ID, USER_ID);

    const guestDocs = await LocalDocumentService.getGuestDocuments(GUEST_ID);
    expect(guestDocs).toHaveLength(0);
  });

  it('E03: after full migration (IDB + cloud), linkedCloudId is set on local docs', async () => {
    await seedGuestData([
      { title: 'Sync Me', versions: [{ content: 'sync content', wordCount: 2 }] },
    ]);

    await migrateDocuments(GUEST_ID, USER_ID);

    const { synced, failed } = await SyncService.syncAllUnlinked(USER_ID);
    expect(synced).toBeGreaterThan(0);
    expect(failed).toBe(0);

    const userDocs = await LocalDocumentService.getGuestDocuments(USER_ID);
    for (const doc of userDocs) {
      expect(doc.linkedCloudId).toBeTruthy();
      expect(typeof doc.linkedCloudId).toBe('string');
    }
  });

  it('E04: version content preserved exactly after IDB re-keying', async () => {
    const uniqueContent = 'The quick brown fox jumps over the lazy dog — version content integrity test 12345.';
    await seedGuestData([
      { title: 'Content Check', versions: [{ content: uniqueContent, wordCount: 15 }] },
    ]);

    await migrateDocuments(GUEST_ID, USER_ID);

    const userDocs = await LocalDocumentService.getGuestDocuments(USER_ID);
    expect(userDocs).toHaveLength(1);

    const firstUserDoc = userDocs[0];
    if (!firstUserDoc) throw new Error('No user docs found');

    const db = await getLocalDb();
    const versions = await db.getAllFromIndex('versions', 'by-document', firstUserDoc.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.content).toBe(uniqueContent);
  });
});
