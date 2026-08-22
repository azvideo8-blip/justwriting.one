import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { LocalStorageService } from '../LocalStorageService';
import { LocalVersionService } from '../LocalVersionService';
import { VersionService } from '../VersionService';
import { ConflictResolver } from '../ConflictResolver';
import { getLocalDb } from '../../storage/localDb';

import { setEncryptionEnabled, setProfileLoaded } from '../../crypto/cryptoHelpers';

describe('AG-SYNC-5: Cloud Sync bidirectional reconciliation & tombstones', () => {
  const userId = 'user_sync_5';

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

  it('Requirement 1: handles tombstones by unlinking locally and removing from syncQueue without resurrecting', async () => {
    const docId = await LocalStorageService.createDocument(userId, {
      title: 'Note to be deleted',
      tags: [],
    });
    await LocalStorageService.updateLinkedCloudId(docId, 'cloud_tombstone_1');

    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue({
      id: 'cloud_tombstone_1',
      title: '',
      currentVersion: 0,
      totalWords: 0,
      totalDuration: 0,
      sessionsCount: 0,
      firstSessionAt: null,
      lastSessionAt: null,
      deletedAt: new Date(),
    } as any);

    const addVersionSpy = vi.spyOn(VersionService, 'addVersion');

    const result = await CloudSyncService.syncVersionToCloud(
      userId,
      docId,
      'cloud_tombstone_1',
      {
        title: 'Note',
        content: 'Should not upload',
        tags: [],
        wordCount: 3,
        duration: 10,
        wpm: 20,
        sessionStartedAt: new Date(),
      },
      1,
      ''
    );

    expect(result).toEqual({ forked: false });
    expect(addVersionSpy).not.toHaveBeenCalled();

    const localDoc = await LocalStorageService.getDocument(docId);
    expect(localDoc?.linkedCloudId).toBeFalsy();

    const db = await getLocalDb();
    const queued = await db.get('syncQueue', `sync_${docId}`);
    expect(queued).toBeUndefined();
  });

  it('Requirement 2: pull-before-push reconciles non-divergent cloud versions and advances without forking', async () => {
    const docId = await LocalStorageService.createDocument(userId, {
      title: 'Collaborative note',
      tags: [],
    });
    await LocalStorageService.updateLinkedCloudId(docId, 'cloud_collab_1');

    await LocalVersionService.addVersion(userId, docId, {
      content: 'Base version 1',
      previousContent: '',
      wordCount: 3,
      duration: 10,
      wpm: 20,
      versionNumber: 1,
      sessionStartedAt: new Date(1000),
    });

    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue({
      id: 'cloud_collab_1',
      currentVersion: 2,
    } as any);

    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([
      { id: 'v1', version: 1, content: 'Base version 1' } as any,
      { id: 'v2', version: 2, content: 'Cloud version 2 added elsewhere' } as any,
    ]);

    const addVersionSpy = vi.spyOn(VersionService, 'addVersion').mockResolvedValue('v3');
    vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockResolvedValue(undefined as any);
    const resolveConflictSpy = vi.spyOn(ConflictResolver, 'resolveConflict');

    const result = await CloudSyncService.syncVersionToCloud(
      userId,
      docId,
      'cloud_collab_1',
      {
        title: 'Collaborative note',
        content: 'Base version 1 + my offline edit',
        tags: [],
        wordCount: 8,
        duration: 15,
        wpm: 30,
        sessionStartedAt: new Date(3000),
      },
      2,
      'Base version 1'
    );

    expect(result).toEqual({ forked: false });
    expect(resolveConflictSpy).not.toHaveBeenCalled();
    expect(addVersionSpy).toHaveBeenCalledWith(
      userId,
      'cloud_collab_1',
      expect.objectContaining({
        versionNumber: 3,
      })
    );

    const localVersions = await LocalVersionService.getVersions(docId);
    expect(localVersions.some(v => v.version === 2)).toBe(true);
  });

  it('Requirement 3: conflict fork brings original local document in line with cloud versions', async () => {
    const docId = await LocalStorageService.createDocument(userId, {
      title: 'Branching note',
      tags: [],
    });
    await LocalStorageService.updateLinkedCloudId(docId, 'cloud_conflict_1');

    await LocalVersionService.addVersion(userId, docId, {
      content: 'Original base',
      previousContent: '',
      wordCount: 2,
      duration: 5,
      wpm: 20,
      versionNumber: 1,
      sessionStartedAt: new Date(1000),
    });

    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([
      { id: 'v1', version: 1, content: 'Original base' } as any,
      { id: 'v2', version: 2, content: 'Cloud edited text on v2' } as any,
    ]);

    const result = await ConflictResolver.resolveConflict(
      userId,
      docId,
      'cloud_conflict_1',
      {
        title: 'Branching note',
        content: 'Local divergent edit on v2',
        tags: [],
        wordCount: 5,
        duration: 10,
        wpm: 25,
        sessionStartedAt: new Date(2000),
      },
      2,
      { currentVersion: 2, totalWords: 10, totalDuration: 20 }
    );

    expect(result.forked).toBe(true);

    const origVersions = await LocalVersionService.getVersions(docId);
    expect(origVersions.some(v => v.version === 2 && v.content === 'Cloud edited text on v2')).toBe(true);

    const origDoc = await LocalStorageService.getDocument(docId);
    expect(origDoc?.currentVersion).toBe(2);
  });

  it('Requirement 4: addCloudCopy detects content mismatch on same version number and forks divergent content', async () => {
    const docId = await LocalStorageService.createDocument(userId, {
      title: 'Local Note',
      tags: [],
    });
    await LocalStorageService.updateLinkedCloudId(docId, 'cloud_divergent_1');

    await LocalVersionService.addVersion(userId, docId, {
      content: 'Local text at v1',
      previousContent: '',
      wordCount: 4,
      duration: 10,
      wpm: 20,
      versionNumber: 1,
      sessionStartedAt: new Date(1000),
    });

    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue({
      id: 'cloud_divergent_1',
      currentVersion: 1,
    } as any);

    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([
      { id: 'v1', version: 1, content: 'Cloud different text at v1' } as any,
    ]);

    const resolveConflictSpy = vi.spyOn(ConflictResolver, 'resolveConflict').mockResolvedValue({ forked: true });
    vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockResolvedValue(undefined as any);

    await CloudSyncService.addCloudCopy(userId, docId);

    expect(resolveConflictSpy).toHaveBeenCalled();
  });

  it('Requirement 5: recovers from split metadata / unique constraint collision by recomputing max version', async () => {
    const docId = await LocalStorageService.createDocument(userId, {
      title: 'Collision test',
      tags: [],
    });
    await LocalStorageService.updateLinkedCloudId(docId, 'cloud_collide_1');

    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue({
      id: 'cloud_collide_1',
      currentVersion: 1,
    } as any);

    let getVersionsCall = 0;
    vi.spyOn(VersionService, 'getVersions').mockImplementation(async () => {
      getVersionsCall++;
      if (getVersionsCall === 1) {
        return [{ id: 'v1', version: 1, content: 'Base' } as any];
      }
      return [
        { id: 'v1', version: 1, content: 'Base' } as any,
        { id: 'v2', version: 2, content: 'Already written in cloud' } as any,
      ];
    });

    let addVersionCall = 0;
    const addVersionSpy = vi.spyOn(VersionService, 'addVersion').mockImplementation(async (_uid, _cid, data) => {
      addVersionCall++;
      if (addVersionCall === 1) {
        throw new Error('duplicate key value violates unique constraint "versions_document_uuid_version_key"');
      }
      return `v${data.versionNumber}`;
    });

    const updateDocSpy = vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockResolvedValue(undefined as any);

    const result = await CloudSyncService.syncVersionToCloud(
      userId,
      docId,
      'cloud_collide_1',
      {
        title: 'Collision test',
        content: 'New session content',
        tags: [],
        wordCount: 5,
        duration: 10,
        wpm: 30,
        sessionStartedAt: new Date(),
      },
      2,
      'Base'
    );

    expect(result).toEqual({ forked: false });
    expect(addVersionSpy).toHaveBeenCalledTimes(2);
    expect(addVersionSpy).toHaveBeenLastCalledWith(
      userId,
      'cloud_collide_1',
      expect.objectContaining({
        versionNumber: 3,
      })
    );
    expect(updateDocSpy).toHaveBeenCalledWith(
      userId,
      'cloud_collide_1',
      expect.objectContaining({
        currentVersion: 3,
      })
    );
  });
});
