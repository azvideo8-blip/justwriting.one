import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { LocalStorageService } from '../LocalStorageService';
import { LocalVersionService } from '../LocalVersionService';
import { VersionService } from '../VersionService';
import { ConflictResolver } from '../ConflictResolver';
import { getLocalDb } from '../../storage/localDb';
import { setEncryptionEnabled, setProfileLoaded, DecryptionError } from '../../crypto/cryptoHelpers';
import * as CryptoHelpers from '../../crypto/cryptoHelpers';

describe('AG-CORRUPT-3: addCloudCopy ciphertext comparison guard', () => {
  const userId = 'user_corrupt_3';

  beforeEach(async () => {
    vi.resetAllMocks();
    localStorage.clear();
    setProfileLoaded(userId, true);
    setEncryptionEnabled(userId, false);
    const db = await getLocalDb();
    const tx = db.transaction(['documents', 'versions', 'syncQueue'], 'readwrite');
    await Promise.all([
      tx.objectStore('documents').clear(),
      tx.objectStore('versions').clear(),
      tx.objectStore('syncQueue').clear(),
      tx.done,
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Cloud version at same version number is undecryptable ciphertext, local is readable: creates no conflict copy and leaves sync task queued', async () => {
    const docId = await LocalStorageService.createDocument(userId, {
      title: 'Local Note',
      tags: [],
    });
    await LocalStorageService.updateLinkedCloudId(docId, 'cloud_corrupt_1');

    await LocalVersionService.addVersion(userId, docId, {
      content: 'Readable local prose',
      previousContent: '',
      wordCount: 3,
      duration: 10,
      wpm: 18,
      versionNumber: 1,
      sessionStartedAt: new Date(),
    });

    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue({
      id: 'cloud_corrupt_1',
      title: 'Local Note',
      currentVersion: 1,
      totalWords: 3,
      totalDuration: 10,
      sessionsCount: 1,
      firstSessionAt: null,
      lastSessionAt: null,
      _encrypted: false,
    } as any);

    vi.spyOn(CryptoHelpers, 'maybeDecrypt').mockRejectedValue(new DecryptionError('content'));

    // Cloud holds version 1 with undecryptable ciphertext
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([
      {
        id: 'ver_cloud_1',
        documentId: 'cloud_corrupt_1',
        version: 1,
        content: 'enc:AES256GCM:ciphertext_payload',
        wordCount: 3,
        duration: 10,
        wpm: 18,
        _encrypted: true,
      } as any,
    ]);

    const resolveConflictSpy = vi.spyOn(ConflictResolver, 'resolveConflict');

    await expect(CloudSyncService.addCloudCopy(userId, docId)).rejects.toThrow('SYNC_UNRESOLVED');

    // Assert NO conflict fork was created
    expect(resolveConflictSpy).not.toHaveBeenCalled();

    // Assert document was queued for retry in syncQueue
    const db = await getLocalDb();
    const queued = await db.get('syncQueue', `sync_${docId}`);
    expect(queued).toBeDefined();
    expect(queued?.documentId).toBe(docId);
  });

  it('Cloud readable, local locked/ciphertext: same outcome (no conflict copy created)', async () => {
    const docId = await LocalStorageService.createDocument(userId, {
      title: 'Local Locked Note',
      tags: [],
    });
    await LocalStorageService.updateLinkedCloudId(docId, 'cloud_corrupt_2');

    await LocalVersionService.addVersion(userId, docId, {
      content: 'enc:local_cipher',
      previousContent: '',
      wordCount: 3,
      duration: 10,
      wpm: 18,
      versionNumber: 1,
      sessionStartedAt: new Date(),
    });

    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue({
      id: 'cloud_corrupt_2',
      title: 'Local Locked Note',
      currentVersion: 1,
      totalWords: 3,
      totalDuration: 10,
      sessionsCount: 1,
      firstSessionAt: null,
      lastSessionAt: null,
      _encrypted: false,
    } as any);

    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([
      {
        id: 'ver_cloud_2',
        documentId: 'cloud_corrupt_2',
        version: 1,
        content: 'Plaintext cloud content',
        wordCount: 3,
        duration: 10,
        wpm: 18,
        _encrypted: false,
      } as any,
    ]);

    const resolveConflictSpy = vi.spyOn(ConflictResolver, 'resolveConflict');

    await expect(CloudSyncService.addCloudCopy(userId, docId)).rejects.toThrow('SYNC_UNRESOLVED');

    expect(resolveConflictSpy).not.toHaveBeenCalled();
    const db = await getLocalDb();
    const queued = await db.get('syncQueue', `sync_${docId}`);
    expect(queued).toBeDefined();
  });

  it('Genuine divergence (both sides readable, different text): forks exactly once per document (AUDIT-MH5 invariant)', async () => {
    const docId = await LocalStorageService.createDocument(userId, {
      title: 'Diverged Note',
      tags: [],
    });
    await LocalStorageService.updateLinkedCloudId(docId, 'cloud_diverged_1');

    await LocalVersionService.addVersion(userId, docId, {
      content: 'Local text variant A',
      previousContent: '',
      wordCount: 4,
      duration: 10,
      wpm: 24,
      versionNumber: 1,
      sessionStartedAt: new Date(),
    });

    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue({
      id: 'cloud_diverged_1',
      title: 'Diverged Note',
      currentVersion: 1,
      totalWords: 4,
      totalDuration: 10,
      sessionsCount: 1,
      firstSessionAt: null,
      lastSessionAt: null,
      _encrypted: false,
    } as any);

    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([
      {
        id: 'ver_cloud_diverged_1',
        documentId: 'cloud_diverged_1',
        version: 1,
        content: 'Cloud text variant B',
        wordCount: 4,
        duration: 10,
        wpm: 24,
        _encrypted: false,
      } as any,
    ]);

    const resolveConflictSpy = vi.spyOn(ConflictResolver, 'resolveConflict').mockResolvedValue({} as any);

    await CloudSyncService.addCloudCopy(userId, docId);

    expect(resolveConflictSpy).toHaveBeenCalledTimes(1);
  });
});
