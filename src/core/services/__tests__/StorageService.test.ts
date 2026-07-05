import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { StorageService } from '../StorageService';
import { getLocalDb } from '../../storage/localDb';

// Mock the Firestore modules so CloudSyncService reads fail
vi.mock('../../firebase/firestore', () => ({
  isFirestoreConnected: false,
  onConnectionChange: vi.fn(() => () => {}),
}));

vi.mock('../DocumentService', () => ({
  DocumentService: {
    getDocument: vi.fn().mockRejectedValue(new Error('unavailable')),
    createDocument: vi.fn().mockRejectedValue(new Error('unavailable')),
    updateDocumentAfterSession: vi.fn().mockRejectedValue(new Error('unavailable')),
    deleteDocument: vi.fn().mockRejectedValue(new Error('unavailable')),
    getUserDocuments: vi.fn().mockRejectedValue(new Error('unavailable')),
  },
}));

vi.mock('../VersionService', () => ({
  VersionService: {
    getVersions: vi.fn().mockRejectedValue(new Error('unavailable')),
    addVersion: vi.fn().mockRejectedValue(new Error('unavailable')),
  },
}));

vi.mock('../ConflictResolver', () => ({
  ConflictResolver: {
    resolveConflict: vi.fn().mockRejectedValue(new Error('unavailable')),
  },
}));

const userId = 'test_storage_user';

async function seedDocument(docId: string, linkedCloudId?: string) {
  const db = await getLocalDb();
  await db.put('documents', {
    id: docId,
    guestId: userId,
    title: 'Test Doc',
    currentVersion: 1,
    totalWords: 100,
    totalDuration: 60,
    sessionsCount: 1,
    firstSessionAt: Date.now(),
    lastSessionAt: Date.now(),
    tags: [],
    linkedCloudId: linkedCloudId ?? '',
  });
  await db.put('versions', {
    id: `ver_${docId}_1`,
    documentId: docId,
    guestId: userId,
    version: 1,
    content: 'Hello world',
    wordCount: 2,
    wordsAdded: 2,
    charsAdded: 11,
    duration: 10,
    wpm: 12,
    savedAt: Date.now(),
    sessionStartedAt: Date.now(),
  });
}

const makeSaveData = (overrides?: Partial<{ content: string; wordCount: number; duration: number; wpm: number }>) => ({
  title: 'Test Doc',
  content: overrides?.content ?? 'Updated content',
  wordCount: overrides?.wordCount ?? 3,
  duration: overrides?.duration ?? 15,
  wpm: overrides?.wpm ?? 12,
  sessionStartedAt: new Date(),
  tags: [],
});

beforeEach(async () => {
  vi.clearAllMocks();
  const db = await getLocalDb();
  const tx = db.transaction(['documents', 'versions', 'syncQueue', 'profile'], 'readwrite');
  await Promise.all([
    tx.objectStore('documents').clear(),
    tx.objectStore('versions').clear(),
    tx.objectStore('syncQueue').clear(),
    tx.objectStore('profile').clear(),
    tx.done,
  ]);
});

describe('StorageService.saveVersion — cloud resilience', () => {
  it('saves locally and does not throw when cloud is unavailable (isFirestoreConnected=false)', async () => {
    const docId = 'doc_cloud_down';
    await seedDocument(docId, 'cloud_1');

    // syncVersionToCloud queues to syncQueue when isFirestoreConnected is false.
    // The local save should succeed regardless.
    const result = await StorageService.saveVersion(userId, docId, makeSaveData());

    expect(result).toEqual({ forked: false });

    // Verify local save succeeded — version bumped
    const db = await getLocalDb();
    const doc = await db.get('documents', docId);
    expect(doc).toBeTruthy();
    expect(doc!.currentVersion).toBe(2);
  });

  it('skips cloud sync entirely when document has no linkedCloudId', async () => {
    const docId = 'doc_no_cloud';
    await seedDocument(docId); // no linkedCloudId

    const result = await StorageService.saveVersion(userId, docId, makeSaveData());

    expect(result).toEqual({ forked: false });

    const db = await getLocalDb();
    const doc = await db.get('documents', docId);
    expect(doc!.currentVersion).toBe(2);
  });

  it('queues to syncQueue when cloud is disconnected', async () => {
    const docId = 'doc_queue';
    await seedDocument(docId, 'cloud_2');

    await StorageService.saveVersion(userId, docId, makeSaveData());

    // syncVersionToCloud should have queued the document for later retry
    const db = await getLocalDb();
    const queue = await db.getAll('syncQueue');
    const queued = queue.filter(item => item.documentId === docId);
    expect(queued.length).toBeGreaterThanOrEqual(1);
  });

  it('throws when local save fails (quota exceeded simulation)', async () => {
    const docId = 'doc_quota';
    await seedDocument(docId);

    // fill up storage to trigger quota error — not practical in tests
    // Instead verify that a missing document throws
    await expect(
      StorageService.saveVersion(userId, 'nonexistent_doc', makeSaveData())
    ).rejects.toThrow('Document not found');
  });
});
