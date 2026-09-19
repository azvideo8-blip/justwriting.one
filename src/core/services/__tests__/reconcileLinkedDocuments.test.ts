import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { SyncService } from '../SyncService';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { LocalVersionService } from '../LocalVersionService';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';
import { VersionService } from '../VersionService';
import { getLocalDb } from '../../storage/localDb';
import * as cryptoHelpers from '../../crypto/cryptoHelpers';
import * as encryptModule from '../../crypto/encrypt';
import { registerActiveEditorDocIdGetter } from '../../sync/activeEditor';

describe('SYNC-CURSOR-3: reconcileLinkedDocuments (Policy B)', () => {
  const userId = 'user_reconcile_test';
  const localDocId = 'local_doc_123';
  const cloudDocId = 'cloud_doc_123';

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(cryptoHelpers, 'getEncryptionEnabled').mockReturnValue(false);
    vi.spyOn(encryptModule, 'getSessionKey').mockReturnValue({} as CryptoKey);
    registerActiveEditorDocIdGetter(() => null);

    const db = await getLocalDb();
    await db.clear('documents');
    await db.clear('versions');
    await db.clear('syncQueue');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Cloud ahead, no pending edit, note not open in editor: fast-forwards silently', async () => {
    const db = await getLocalDb();
    await db.put('documents', {
      id: localDocId,
      guestId: userId,
      title: 'Old Local Title',
      currentVersion: 1,
      totalWords: 10,
      totalDuration: 100,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: ['draft'],
      linkedCloudId: cloudDocId,
      lastSyncedCloudVersion: 1,
      lastSeenCloudUpdatedAt: '2026-09-19T10:00:00.000Z',
    });

    await db.put('versions', {
      id: 'ver_loc_1',
      documentId: localDocId,
      guestId: userId,
      version: 1,
      content: 'Local version 1 text',
      wordCount: 10,
      wordsAdded: 10,
      charsAdded: 50,
      duration: 100,
      wpm: 20,
      savedAt: 1000,
      sessionStartedAt: 1000,
    });

    const cloudDoc = {
      id: cloudDocId,
      title: 'Updated Cloud Title',
      currentVersion: 2,
      totalWords: 25,
      totalDuration: 250,
      sessionsCount: 2,
      tags: ['published'],
      updatedAt: new Date('2026-09-19T12:00:00.000Z'),
      createdAt: new Date('2026-09-19T09:00:00.000Z'),
    } as any;

    const cloudVersions = [
      {
        id: 'cv_1',
        version: 1,
        content: 'Local version 1 text',
        wordCount: 10,
        duration: 100,
        wpm: 20,
      },
      {
        id: 'cv_2',
        version: 2,
        content: 'Brand new text from phone',
        wordCount: 25,
        duration: 150,
        wpm: 30,
        sessionStartedAt: new Date('2026-09-19T12:00:00.000Z'),
        savedAt: new Date('2026-09-19T12:00:00.000Z'),
      },
    ] as any[];

    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([cloudDoc]);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue(cloudVersions);
    const addActivitySpy = vi.spyOn(useActivityLogStore.getState(), 'addActivity');

    const result = await SyncService.reconcileLinkedDocuments(userId);

    expect(result).toEqual({ reconciled: 1, skipped: 0, failed: 0 });

    // Silent — no toast, no confirmation
    expect(addActivitySpy).not.toHaveBeenCalledWith(
      'заметка изменилась на другом устройстве',
      expect.anything(),
      expect.anything(),
      expect.anything()
    );

    // Assert local document was fast-forwarded to cloud version 2
    const updatedDoc = await db.get('documents', localDocId);
    expect(updatedDoc?.title).toBe('Updated Cloud Title');
    expect(updatedDoc?.currentVersion).toBe(2);
    expect(updatedDoc?.lastSyncedCloudVersion).toBe(2);
    expect(updatedDoc?.tags).toEqual(['published']);
    expect(updatedDoc?.lastSeenCloudUpdatedAt).toBe('2026-09-19T12:00:00.000Z');

    // Assert version 2 was added to local version history
    const allVersions = await LocalVersionService.getVersions(localDocId);
    expect(allVersions).toHaveLength(2);
    expect(allVersions[1]?.version).toBe(2);
    expect(allVersions[1]?.content).toBe('Brand new text from phone');
  });

  it('Cloud ahead, pending edit exists: editor content unchanged, new version written to history, one activity log entry, no repeat', async () => {
    const db = await getLocalDb();
    await db.put('documents', {
      id: localDocId,
      guestId: userId,
      title: 'Local In-Progress Title',
      currentVersion: 1,
      totalWords: 15,
      totalDuration: 120,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 2000,
      tags: ['work'],
      linkedCloudId: cloudDocId,
      lastSyncedCloudVersion: 1,
      lastSeenCloudUpdatedAt: '2026-09-19T10:00:00.000Z',
    });

    await db.put('versions', {
      id: 'ver_loc_1',
      documentId: localDocId,
      guestId: userId,
      version: 1,
      content: 'Original local text',
      wordCount: 10,
      wordsAdded: 10,
      charsAdded: 50,
      duration: 100,
      wpm: 20,
      savedAt: 1000,
      sessionStartedAt: 1000,
    });

    // Mark doc as having pending unsent edit in syncQueue
    await db.put('syncQueue', {
      id: `sync_${localDocId}`,
      documentId: localDocId,
      type: 'document',
      createdAt: Date.now(),
      ownerId: userId,
    });

    const cloudDoc = {
      id: cloudDocId,
      title: 'Title From Phone',
      currentVersion: 2,
      totalWords: 40,
      totalDuration: 300,
      sessionsCount: 2,
      tags: ['remote'],
      updatedAt: new Date('2026-09-19T13:00:00.000Z'),
      createdAt: new Date('2026-09-19T09:00:00.000Z'),
    } as any;

    const cloudVersions = [
      {
        id: 'cv_1',
        version: 1,
        content: 'Original local text',
        wordCount: 10,
        duration: 100,
        wpm: 20,
      },
      {
        id: 'cv_2',
        version: 2,
        content: 'Conflicting edit written on phone',
        wordCount: 40,
        duration: 200,
        wpm: 35,
        sessionStartedAt: new Date('2026-09-19T13:00:00.000Z'),
        savedAt: new Date('2026-09-19T13:00:00.000Z'),
      },
    ] as any[];

    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([cloudDoc]);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue(cloudVersions);
    const addActivitySpy = vi.spyOn(useActivityLogStore.getState(), 'addActivity');

    // First reconciliation run
    const result1 = await SyncService.reconcileLinkedDocuments(userId);
    expect(result1).toEqual({ reconciled: 1, skipped: 0, failed: 0 });

    // Content on screen / document currentVersion is UNTOUCHED
    const docAfter1 = await db.get('documents', localDocId);
    expect(docAfter1?.currentVersion).toBe(1);
    expect(docAfter1?.title).toBe('Local In-Progress Title');

    // Exactly one activity log entry logged
    expect(addActivitySpy).toHaveBeenCalledTimes(1);
    expect(addActivitySpy).toHaveBeenCalledWith(
      'заметка изменилась на другом устройстве',
      expect.objectContaining({ documentId: localDocId, cloudDocumentId: cloudDocId }),
      'info',
      'sync'
    );

    // An additional entry was added to that note's existing version history
    const versionsAfter1 = await LocalVersionService.getVersions(localDocId);
    expect(versionsAfter1).toHaveLength(2);
    expect(versionsAfter1[1]?.content).toBe('Conflicting edit written on phone');

    // Second reconciliation run with nothing new: does NOT log a second entry
    addActivitySpy.mockClear();
    const result2 = await SyncService.reconcileLinkedDocuments(userId);
    expect(result2).toEqual({ reconciled: 0, skipped: 1, failed: 0 });
    expect(addActivitySpy).not.toHaveBeenCalled();
  });

  it('Note open in the editor with no sync-queue entry yet: fast-forward does NOT fire', async () => {
    const db = await getLocalDb();
    await db.put('documents', {
      id: localDocId,
      guestId: userId,
      title: 'Current Note In Editor',
      currentVersion: 1,
      totalWords: 10,
      totalDuration: 50,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
      linkedCloudId: cloudDocId,
      lastSyncedCloudVersion: 1,
      lastSeenCloudUpdatedAt: '2026-09-19T10:00:00.000Z',
    });

    await db.put('versions', {
      id: 'ver_loc_1',
      documentId: localDocId,
      guestId: userId,
      version: 1,
      content: 'Initial text being typed over',
      wordCount: 10,
      wordsAdded: 10,
      charsAdded: 50,
      duration: 50,
      wpm: 20,
      savedAt: 1000,
      sessionStartedAt: 1000,
    });

    // No sync queue entry yet! But note is currently open in active editor
    registerActiveEditorDocIdGetter(() => localDocId);

    const cloudDoc = {
      id: cloudDocId,
      title: 'Incoming Title From Elsewhere',
      currentVersion: 2,
      totalWords: 50,
      totalDuration: 300,
      sessionsCount: 2,
      updatedAt: new Date('2026-09-19T14:00:00.000Z'),
      createdAt: new Date('2026-09-19T09:00:00.000Z'),
    } as any;

    const cloudVersions = [
      {
        id: 'cv_1',
        version: 1,
        content: 'Initial text being typed over',
        wordCount: 10,
      },
      {
        id: 'cv_2',
        version: 2,
        content: 'Remote changes from tablet',
        wordCount: 50,
        duration: 200,
        wpm: 40,
        sessionStartedAt: new Date('2026-09-19T14:00:00.000Z'),
      },
    ] as any[];

    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([cloudDoc]);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue(cloudVersions);

    const result = await SyncService.reconcileLinkedDocuments(userId);
    expect(result).toEqual({ reconciled: 1, skipped: 0, failed: 0 });

    // Document currentVersion must NOT fast forward (it must protect what is on screen)
    const docAfter = await db.get('documents', localDocId);
    expect(docAfter?.currentVersion).toBe(1);
    expect(docAfter?.title).toBe('Current Note In Editor');

    // But the remote change was saved to version history so it is not lost
    const versionsAfter = await LocalVersionService.getVersions(localDocId);
    expect(versionsAfter).toHaveLength(2);
    expect(versionsAfter[1]?.content).toBe('Remote changes from tablet');
  });

  it('Falsification check: removing active editor check would clobber on-screen document', async () => {
    // If getActiveDocumentId returned null (simulating removing the active-editor check),
    // and queue had no entry, the code would take the fast-forward path and clobber currentVersion
    const db = await getLocalDb();
    await db.put('documents', {
      id: localDocId,
      guestId: userId,
      title: 'Current Note In Editor',
      currentVersion: 1,
      totalWords: 10,
      totalDuration: 50,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
      linkedCloudId: cloudDocId,
      lastSyncedCloudVersion: 1,
      lastSeenCloudUpdatedAt: '2026-09-19T10:00:00.000Z',
    });

    const cloudDoc = {
      id: cloudDocId,
      title: 'Incoming Title From Elsewhere',
      currentVersion: 2,
      totalWords: 50,
      totalDuration: 300,
      sessionsCount: 2,
      updatedAt: new Date('2026-09-19T14:00:00.000Z'),
    } as any;

    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([cloudDoc]);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([{ version: 2, content: 'Remote', wordCount: 50 }] as any);

    // Pass explicit getter returning null to prove what happens without the check
    await SyncService.reconcileLinkedDocuments(userId, { getActiveDocumentId: () => null });
    const docAfter = await db.get('documents', localDocId);
    // Proves that without active-editor check, document would be overwritten to v2:
    expect(docAfter?.currentVersion).toBe(2);
  });

  it('Vault locked: reconciliation is skipped entirely', async () => {
    vi.spyOn(cryptoHelpers, 'getEncryptionEnabled').mockReturnValue(true);
    vi.spyOn(encryptModule, 'getSessionKey').mockReturnValue(null);

    const getUserDocsSpy = vi.spyOn(DocumentService, 'getUserDocuments');

    const result = await SyncService.reconcileLinkedDocuments(userId);

    expect(result).toEqual({ reconciled: 0, skipped: 0, failed: 0, locked: true });
    expect(getUserDocsSpy).not.toHaveBeenCalled();
  });

  it('Two overlapping triggers: single-flight guard means only one reconciliation pass runs', async () => {
    const db = await getLocalDb();
    await db.put('documents', {
      id: localDocId,
      guestId: userId,
      title: 'Doc',
      currentVersion: 1,
      totalWords: 10,
      totalDuration: 10,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
      linkedCloudId: cloudDocId,
      lastSyncedCloudVersion: 1,
      lastSeenCloudUpdatedAt: '2026-09-19T10:00:00.000Z',
    });

    const cloudDoc = {
      id: cloudDocId,
      title: 'Doc',
      currentVersion: 2,
      updatedAt: new Date('2026-09-19T12:00:00.000Z'),
    } as any;

    const getUserDocsSpy = vi.spyOn(DocumentService, 'getUserDocuments').mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 20));
      return [cloudDoc];
    });
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([{ version: 2, content: 'Text', wordCount: 10 }] as any);

    const [res1, res2] = await Promise.all([
      SyncService.reconcileLinkedDocuments(userId),
      SyncService.reconcileLinkedDocuments(userId),
    ]);

    expect(res1).toEqual({ reconciled: 1, skipped: 0, failed: 0 });
    expect(res2).toEqual({ reconciled: 1, skipped: 0, failed: 0 });
    expect(getUserDocsSpy).toHaveBeenCalledTimes(1);
  });

  it('syncVersionToCloud and reconcileLinkedDocuments contend for the same document lock (FOLLOWUP-2)', async () => {
    const db = await getLocalDb();
    await db.put('documents', {
      id: localDocId,
      guestId: userId,
      title: 'Doc',
      currentVersion: 1,
      totalWords: 10,
      totalDuration: 10,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
      linkedCloudId: cloudDocId,
      lastSyncedCloudVersion: 1,
      lastSeenCloudUpdatedAt: '2026-09-19T10:00:00.000Z',
    });

    const cloudDoc = {
      id: cloudDocId,
      title: 'Doc',
      currentVersion: 2,
      updatedAt: new Date('2026-09-19T12:00:00.000Z'),
    } as any;

    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([cloudDoc]);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([{ version: 2, content: 'Remote', wordCount: 50 }] as any);

    // Mock DocumentService.getDocument and getDocumentWithDeleted to delay, keeping syncVersionToCloud holding the lock
    vi.spyOn(DocumentService, 'getDocument').mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 40));
      return cloudDoc;
    });
    vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 40));
      return cloudDoc;
    });
    vi.spyOn(VersionService, 'addVersion').mockResolvedValue({} as any);
    vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockResolvedValue({} as any);

    const syncPromise = CloudSyncService.syncVersionToCloud(
      userId,
      localDocId,
      cloudDocId,
      {
        title: 'Doc',
        content: 'Local edit',
        tags: [],
        wordCount: 10,
        duration: 60,
        wpm: 20,
        sessionStartedAt: new Date(),
      },
      2,
      'Old text',
    );

    // Allow syncVersionToCloud to acquire lock_cloud_<localDocId>
    await new Promise(r => setTimeout(r, 10));

    // reconcileLinkedDocuments should contend on the same lock and receive LOCK_HELD -> skipped
    const reconcileResult = await SyncService.reconcileLinkedDocuments(userId);
    await syncPromise;

    expect(reconcileResult).toEqual({ reconciled: 0, skipped: 1, failed: 0 });
  });
});
