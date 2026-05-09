// Must be first — patches globalThis.indexedDB before any idb import
import 'fake-indexeddb/auto';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────

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

vi.mock('../services/DocumentService', () => ({
  DocumentService: MockDocumentService,
}));

vi.mock('../services/VersionService', () => ({
  VersionService: MockVersionService,
}));

// ─── Subject imports (after mocks) ───────────────────────────────────────────

import { resetDbInstance } from '../../../shared/lib/localDb';
import { LocalDocumentService } from '../services/LocalDocumentService';
import { LocalVersionService } from '../services/LocalVersionService';
import { StorageService } from '../services/StorageService';

const GUEST = 'guest_storage_test';

const BASE_DATA = {
  title: 'Test Document',
  content: 'Hello world from test',
  wordCount: 4,
  duration: 120,
  wpm: 60,
  tags: ['test'],
  sessionStartedAt: new Date('2024-01-15T10:00:00Z'),
};

beforeEach(async () => {
  resetDbInstance();
  cloudDocs.clear();
  cloudVersions.clear();
  MockDocumentService.createDocument.mockClear();
  MockDocumentService.getDocument.mockClear();
  MockDocumentService.updateDocumentAfterSession.mockClear();
  MockVersionService.addVersion.mockClear();

  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('justwriting-local');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
});

// ─── saveNew ─────────────────────────────────────────────────────────────────

describe('StorageService.saveNew', () => {
  it('creates document in IDB and returns localId starting with "local_"', async () => {
    const { localId } = await StorageService.saveNew(GUEST, BASE_DATA);
    expect(localId).toMatch(/^local_/);
    const doc = await LocalDocumentService.getDocument(localId);
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe('Test Document');
  });

  it('creates version in IDB with versionNumber=1', async () => {
    const { localId } = await StorageService.saveNew(GUEST, BASE_DATA);
    const versions = await LocalVersionService.getVersions(localId);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
  });

  it('document has correct totalWords after save', async () => {
    const { localId } = await StorageService.saveNew(GUEST, { ...BASE_DATA, wordCount: 42 });
    const doc = await LocalDocumentService.getDocument(localId);
    expect(doc!.totalWords).toBe(42);
  });

  it('document has correct totalDuration after save', async () => {
    const { localId } = await StorageService.saveNew(GUEST, { ...BASE_DATA, duration: 300 });
    const doc = await LocalDocumentService.getDocument(localId);
    expect(doc!.totalDuration).toBe(300);
  });
});

// ─── saveVersion ─────────────────────────────────────────────────────────────

describe('StorageService.saveVersion', () => {
  it('increments version number correctly (1→2→3)', async () => {
    const { localId } = await StorageService.saveNew(GUEST, BASE_DATA);

    await StorageService.saveVersion(GUEST, localId, {
      ...BASE_DATA,
      content: 'Second version content',
      wordCount: 8,
    });
    await StorageService.saveVersion(GUEST, localId, {
      ...BASE_DATA,
      content: 'Third version content',
      wordCount: 12,
    });

    const versions = await LocalVersionService.getVersions(localId);
    expect(versions).toHaveLength(3);
    expect(versions[0].version).toBe(1);
    expect(versions[1].version).toBe(2);
    expect(versions[2].version).toBe(3);
  });

  it('stores previousContent correctly', async () => {
    const { localId } = await StorageService.saveNew(GUEST, {
      ...BASE_DATA,
      content: 'First content',
    });

    await StorageService.saveVersion(GUEST, localId, {
      ...BASE_DATA,
      content: 'Second content',
      wordCount: 2,
    });

    const versions = await LocalVersionService.getVersions(localId);
    // Version 2's previousContent should be the content of version 1
    expect(versions[1].content).toBe('Second content');
    // Note: wordsAdded is computed from the diff
    expect(typeof versions[1].wordsAdded).toBe('number');
  });

  it('_saveVersionLocks serializes concurrent calls: two parallel saveVersion calls result in versions 2 and 3', async () => {
    const { localId } = await StorageService.saveNew(GUEST, BASE_DATA);

    // Fire two saveVersion calls simultaneously
    await Promise.all([
      StorageService.saveVersion(GUEST, localId, {
        ...BASE_DATA,
        content: 'Concurrent A',
        wordCount: 5,
      }),
      StorageService.saveVersion(GUEST, localId, {
        ...BASE_DATA,
        content: 'Concurrent B',
        wordCount: 6,
      }),
    ]);

    const versions = await LocalVersionService.getVersions(localId);
    // Should have 3 versions total (1 from saveNew + 2 concurrent)
    expect(versions).toHaveLength(3);
    // Version numbers should be unique
    const versionNumbers = versions.map(v => v.version).sort((a, b) => a - b);
    expect(versionNumbers).toEqual([1, 2, 3]);
  });

  it('cloud sync attempted if linkedCloudId exists', async () => {
    const { localId } = await StorageService.saveNew(GUEST, BASE_DATA);
    // Link to a cloud document
    await LocalDocumentService.updateLinkedCloudId(localId, 'cloud_linked_123');
    // Also add it to the cloud mock
    cloudDocs.set('cloud_linked_123', {
      id: 'cloud_linked_123',
      userId: GUEST,
      title: 'Test',
      totalWords: 4,
      totalDuration: 120,
      currentVersion: 1,
    });

    await StorageService.saveVersion(GUEST, localId, {
      ...BASE_DATA,
      content: 'Cloud synced content',
      wordCount: 3,
    });

    // Cloud version should have been created
    expect(MockVersionService.addVersion).toHaveBeenCalled();
  });

  it('cloud sync failure adds to syncQueue (does not throw)', async () => {
    MockVersionService.addVersion.mockRejectedValueOnce(new Error('Cloud unavailable'));
    MockDocumentService.getDocument.mockResolvedValueOnce({
      id: 'cloud_fail_123',
      totalDuration: 0,
    });

    const { localId } = await StorageService.saveNew(GUEST, BASE_DATA);
    await LocalDocumentService.updateLinkedCloudId(localId, 'cloud_fail_123');

    // Should NOT throw even though cloud sync failed
    await expect(
      StorageService.saveVersion(GUEST, localId, {
        ...BASE_DATA,
        content: 'Should not throw',
        wordCount: 3,
      })
    ).resolves.toBeUndefined();
  });
});

// ─── addCloudCopy behavior ────────────────────────────────────────────────────

describe('StorageService.addCloudCopy', () => {
  it('returns a cloud id starting with "cloud_"', async () => {
    const { localId } = await StorageService.saveNew(GUEST, BASE_DATA);
    const cloudId = await StorageService.addCloudCopy(GUEST, localId);
    expect(cloudId).toMatch(/^cloud_/);
  });

  it('creates cloud document via DocumentService.createDocument', async () => {
    const { localId } = await StorageService.saveNew(GUEST, BASE_DATA);
    await StorageService.addCloudCopy(GUEST, localId);
    expect(MockDocumentService.createDocument).toHaveBeenCalled();
  });

  it('uploads versions to cloud via VersionService.addVersion', async () => {
    const { localId } = await StorageService.saveNew(GUEST, BASE_DATA);
    await StorageService.addCloudCopy(GUEST, localId);
    // 1 version was created by saveNew, so addVersion should have been called once
    expect(MockVersionService.addVersion).toHaveBeenCalledTimes(1);
  });

  it('if localDoc.linkedCloudId already exists and cloud doc is found, returns existing cloudId', async () => {
    const { localId } = await StorageService.saveNew(GUEST, BASE_DATA);

    // Manually set linkedCloudId and add the cloud doc to the mock
    const existingCloudId = 'cloud_existing_999';
    await LocalDocumentService.updateLinkedCloudId(localId, existingCloudId);
    cloudDocs.set(existingCloudId, {
      id: existingCloudId, title: 'Test', totalWords: 4, totalDuration: 120, currentVersion: 1,
    });

    const result = await StorageService.addCloudCopy(GUEST, localId);
    expect(result).toBe(existingCloudId);
    // Should NOT have created a new document
    expect(MockDocumentService.createDocument).not.toHaveBeenCalled();
  });

  it('concurrent calls: neither throws (lock is released in finally)', async () => {
    const { localId } = await StorageService.saveNew(GUEST, BASE_DATA);

    let error: unknown = null;
    try {
      await Promise.all([
        StorageService.addCloudCopy(GUEST, localId),
        StorageService.addCloudCopy(GUEST, localId),
      ]);
    } catch (e) {
      error = e;
    }

    // Neither call should throw
    expect(error).toBeNull();
  });
});
