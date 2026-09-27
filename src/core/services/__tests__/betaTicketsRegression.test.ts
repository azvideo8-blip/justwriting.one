import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { StorageService } from '../StorageService';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { VersionService } from '../VersionService';
import { ConflictResolver } from '../ConflictResolver';
import { getLocalDb } from '../../storage/localDb';
import { useEncryptionStore } from '../../crypto/useEncryptionStore';

vi.mock('../../data', () => ({
  DataProvider: {
    deleteSummary: vi.fn().mockResolvedValue(undefined),
    deleteEmbedding: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../DocumentService', () => ({
  DocumentService: {
    getDocument: vi.fn(),
    getDocumentWithDeleted: vi.fn(),
    createDocument: vi.fn(),
    updateDocumentAfterSession: vi.fn(),
    deleteDocument: vi.fn(),
    getUserDocuments: vi.fn(),
    findByUuid: vi.fn(),
  },
}));

vi.mock('../VersionService', () => ({
  VersionService: {
    getVersions: vi.fn(),
    addVersion: vi.fn().mockResolvedValue('ver_123'),
  },
}));

vi.mock('../ConflictResolver', () => ({
  ConflictResolver: {
    resolveConflict: vi.fn(),
  },
}));

const USER = 'beta_test_user';

beforeEach(async () => {
  vi.clearAllMocks();
  useEncryptionStore.getState().setProfileLoaded(USER, true);
  useEncryptionStore.getState().setEncryptionEnabled(USER, false);
  const db = await getLocalDb(USER);
  const stores = ['documents', 'versions', 'syncQueue', 'profile'] as const;
  for (const store of stores) {
    const tx = db.transaction(store, 'readwrite');
    await tx.objectStore(store).clear();
    await tx.done;
  }
});

describe('BETA-2: Honest deletion feedback and queue tracking (LIFE-9)', () => {
  it('returns cloudSynced: false when cloud deletion fails, and queues delete task', async () => {
    const localId = 'local_del_1';
    const cloudId = 'cloud_del_1';

    const db = await getLocalDb(USER);
    await db.put('documents', {
      id: localId,
      uuid: 'uuid_del_1',
      guestId: USER,
      title: 'Note to delete',
      currentVersion: 1,
      linkedCloudId: cloudId,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
    } as never);

    // Mock cloud delete failure
    vi.mocked(DocumentService.deleteDocument).mockRejectedValueOnce(new Error('Network error'));

    const result = await StorageService.deleteDocument(USER, localId, cloudId);

    // 1. Returns false, not claiming completed deletion
    expect(result).toEqual({ cloudSynced: false, derivativesOk: true });

    // 2. Local note is deleted
    const localDoc = await db.get('documents', localId);
    expect(localDoc).toBeUndefined();

    // 3. Delete task queued in syncQueue keyed by cloudId
    const queue = await db.getAll('syncQueue');
    const deleteTasks = queue.filter(t => t.type === 'delete' && t.documentId === cloudId);
    expect(deleteTasks).toHaveLength(1);
  });

  it('returns cloudSynced: true when cloud deletion succeeds immediately', async () => {
    const localId = 'local_del_2';
    const cloudId = 'cloud_del_2';

    const db = await getLocalDb(USER);
    await db.put('documents', {
      id: localId,
      uuid: 'uuid_del_2',
      guestId: USER,
      title: 'Note to delete',
      currentVersion: 1,
      linkedCloudId: cloudId,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
    } as never);

    vi.mocked(DocumentService.deleteDocument).mockResolvedValueOnce(undefined);

    const result = await StorageService.deleteDocument(USER, localId, cloudId);
    expect(result).toEqual({ cloudSynced: true, derivativesOk: true });

    const localDoc = await db.get('documents', localId);
    expect(localDoc).toBeUndefined();
  });
});

describe('BETA-3: Version deltas on upload (AG-CORRUPT-1)', () => {
  it('preserves plaintext wordsAdded and charsAdded and does not recompute over ciphertext', async () => {
    const docId = 'doc_delta_test';
    const cloudId = 'cloud_delta_test';

    const db = await getLocalDb(USER);
    await db.put('documents', {
      id: docId,
      guestId: USER,
      title: 'Delta test',
      currentVersion: 1,
      linkedCloudId: cloudId,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
    } as never);
    await db.put('versions', {
      id: `ver_${docId}_1`,
      documentId: docId,
      guestId: USER,
      version: 1,
      content: 'hello world',
      wordCount: 2,
      wordsAdded: 2,
      charsAdded: 11,
      duration: 10,
      wpm: 12,
      savedAt: 1000,
      sessionStartedAt: 1000,
    } as never);

    vi.mocked(DocumentService.getDocumentWithDeleted).mockResolvedValue({
      id: cloudId,
      userId: USER,
      currentVersion: 1,
      title: 'Delta test',
      totalWords: 2,
      totalDuration: 10,
      sessionsCount: 1,
      firstSessionAt: new Date(1000),
      lastSessionAt: new Date(1000),
      tags: [],
    });
    vi.mocked(VersionService.getVersions).mockResolvedValue([
      { version: 1, content: 'hello world' } as never,
    ]);

    const res = await CloudSyncService.syncVersionToCloud(
      USER,
      docId,
      cloudId,
      {
        title: 'Delta test',
        content: 'hello world updated',
        wordCount: 3,
        duration: 15,
        wpm: 12,
        sessionStartedAt: new Date(),
        tags: [],
      },
      2,
      'hello world'
    );

    expect(res.cloudSynced).toBe(true);
    expect(VersionService.addVersion).toHaveBeenCalledTimes(1);
    const addedVersionData = vi.mocked(VersionService.addVersion).mock.calls[0]![2];

    // 'hello world updated' vs 'hello world' has delta: wordsAdded: 1, charsAdded: 8
    expect(addedVersionData.wordsAdded).toBe(1);
    expect(addedVersionData.charsAdded).toBe(8);
  });
});

describe('BETA-4: Reconciliation between ciphertext and plaintext (AG-CORRUPT-2)', () => {
  it('refuses to fork and returns reason: unknown when cloudHead has _decryptionError', async () => {
    const docId = 'doc_corrupt_1';
    const cloudId = 'cloud_corrupt_1';

    const db = await getLocalDb(USER);
    await db.put('documents', {
      id: docId,
      guestId: USER,
      title: 'Plaintext Title',
      currentVersion: 1,
      linkedCloudId: cloudId,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
    } as never);

    // Cloud document reports version 2 (higher than or equal to newVersion 2)
    vi.mocked(DocumentService.getDocumentWithDeleted).mockResolvedValue({
      id: cloudId,
      userId: USER,
      currentVersion: 2,
      title: 'Encrypted Title',
      totalWords: 10,
      totalDuration: 60,
      sessionsCount: 2,
      firstSessionAt: new Date(1000),
      lastSessionAt: new Date(2000),
      tags: [],
    });

    // Cloud version 2 has decryption error
    vi.mocked(VersionService.getVersions).mockResolvedValue([
      { version: 1, content: 'Base v1' } as never,
      { version: 2, content: 'ciphertext_base64_xyz', _encrypted: true, _decryptionError: true } as never,
    ]);

    const key = await window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    const { setSessionKey } = await import('../../crypto/encrypt');
    setSessionKey(key);

    const res = await CloudSyncService.syncVersionToCloud(
      USER,
      docId,
      cloudId,
      {
        title: 'Local Edit',
        content: 'Local Edit v2',
        wordCount: 3,
        duration: 20,
        wpm: 10,
        sessionStartedAt: new Date(),
        tags: [],
      },
      2,
      'Base v1'
    );

    // Must NOT declare diverged and must NOT create a conflict fork!
    expect(ConflictResolver.resolveConflict).not.toHaveBeenCalled();
    expect(res).toEqual({ forked: false, cloudSynced: false, reason: 'unknown' });

    // Enqueued for retry in syncQueue
    const queue = await db.getAll('syncQueue');
    const queued = queue.find(q => q.documentId === docId);
    expect(queued).toBeDefined();
  });

  it('refuses to fork and returns reason: unknown when cloudHead is degraded', async () => {
    const docId = 'doc_corrupt_2';
    const cloudId = 'cloud_corrupt_2';

    const db = await getLocalDb(USER);
    await db.put('documents', {
      id: docId,
      guestId: USER,
      title: 'Plaintext Title',
      currentVersion: 1,
      linkedCloudId: cloudId,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
    } as never);

    vi.mocked(DocumentService.getDocumentWithDeleted).mockResolvedValue({
      id: cloudId,
      userId: USER,
      currentVersion: 2,
      title: 'Title',
      totalWords: 10,
      totalDuration: 60,
      sessionsCount: 2,
      firstSessionAt: new Date(1000),
      lastSessionAt: new Date(2000),
      tags: [],
    });

    vi.mocked(VersionService.getVersions).mockResolvedValue([
      { version: 1, content: 'Base v1' } as never,
      { version: 2, content: '', _degraded: true } as never,
    ]);

    const res = await CloudSyncService.syncVersionToCloud(
      USER,
      docId,
      cloudId,
      {
        title: 'Local Edit',
        content: 'Local Edit v2',
        wordCount: 3,
        duration: 20,
        wpm: 10,
        sessionStartedAt: new Date(),
        tags: [],
      },
      2,
      'Base v1'
    );

    expect(ConflictResolver.resolveConflict).not.toHaveBeenCalled();
    expect(res).toEqual({ forked: false, cloudSynced: false, reason: 'unknown' });
  });
});

describe('BETA-5: Invariant current_version = max(version) (SYNC-10)', () => {
  it('passes localDoc.currentVersion to DocumentService.createDocument on initial upload', async () => {
    const docId = 'doc_cv_test';

    const db = await getLocalDb(USER);
    await db.put('documents', {
      id: docId,
      guestId: USER,
      title: 'CV test',
      currentVersion: 3,
      firstSessionAt: 1000,
      lastSessionAt: 3000,
      tags: [],
    } as never);
    await db.put('versions', {
      id: `ver_${docId}_1`,
      documentId: docId,
      guestId: USER,
      version: 1,
      content: 'v1',
      wordCount: 1,
      savedAt: 1000,
      sessionStartedAt: 1000,
    } as never);
    await db.put('versions', {
      id: `ver_${docId}_2`,
      documentId: docId,
      guestId: USER,
      version: 2,
      content: 'v2',
      wordCount: 1,
      savedAt: 2000,
      sessionStartedAt: 2000,
    } as never);
    await db.put('versions', {
      id: `ver_${docId}_3`,
      documentId: docId,
      guestId: USER,
      version: 3,
      content: 'v3',
      wordCount: 1,
      savedAt: 3000,
      sessionStartedAt: 3000,
    } as never);

    vi.mocked(DocumentService.findByUuid).mockResolvedValue(null);
    vi.mocked(DocumentService.createDocument).mockResolvedValue('cloud_cv_123');

    await StorageService.addCloudCopy(USER, docId);

    expect(DocumentService.createDocument).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(DocumentService.createDocument).mock.calls[0]![1];
    expect(payload.currentVersion).toBe(3);
  });
});
