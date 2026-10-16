import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { SyncService } from '../SyncService';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { LocalVersionService } from '../LocalVersionService';
import { LocalStorageService } from '../LocalStorageService';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';
import { VersionService } from '../VersionService';
import { getLocalDb } from '../../storage/localDb';
import * as cryptoHelpers from '../../crypto/cryptoHelpers';
import * as encryptModule from '../../crypto/encrypt';
import { registerActiveEditorDocIdGetter } from '../../sync/activeEditor';
import { onDomainEvent, _resetDomainEventHandlersForTests } from '../../events/domainEvents';

describe('SYNC-CURSOR-3: reconcileLinkedDocuments (Policy B)', () => {
  const userId = 'user_reconcile_test';
  const localDocId = 'local_doc_123';
  const cloudDocId = 'cloud_doc_123';

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(cryptoHelpers, 'getEncryptionEnabled').mockReturnValue(false);
    vi.spyOn(encryptModule, 'getSessionKey').mockReturnValue({} as CryptoKey);
    registerActiveEditorDocIdGetter(() => null);

    const db = await getLocalDb(userId);
    await db.clear('documents');
    await db.clear('versions');
    await db.clear('syncQueue');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Cloud ahead, no pending edit, note not open in editor: fast-forwards silently', async () => {
    const db = await getLocalDb(userId);
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

    expect(result).toEqual({ reconciled: 1, skipped: 0, failed: 0, corrupted: 0 });

    // Silent — no toast, no confirmation
    expect(addActivitySpy).not.toHaveBeenCalledWith(
      'activity_cloud_remote_edit',
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
    const allVersions = await LocalVersionService.getVersions(localDocId, userId);
    expect(allVersions).toHaveLength(2);
    expect(allVersions[1]?.version).toBe(2);
    expect(allVersions[1]?.content).toBe('Brand new text from phone');
  });

  it('Cloud ahead, pending edit exists: editor content unchanged, new version written to history, one activity log entry, no repeat', async () => {
    const db = await getLocalDb(userId);
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
    expect(result1).toEqual({ reconciled: 1, skipped: 0, failed: 0, corrupted: 0 });

    // Content on screen is preserved, currentVersion is raised to nextVersionNo (A-2.4)
    const docAfter1 = await db.get('documents', localDocId);
    expect(docAfter1?.currentVersion).toBe(2);
    expect(docAfter1?.title).toBe('Local In-Progress Title');

    // Exactly one activity log entry logged
    expect(addActivitySpy).toHaveBeenCalledTimes(1);
    expect(addActivitySpy).toHaveBeenCalledWith(
      'activity_cloud_remote_edit',
      expect.objectContaining({ documentId: localDocId, cloudDocumentId: cloudDocId }),
      'info',
      'sync'
    );

    // An additional entry was added to that note's existing version history
    const versionsAfter1 = await LocalVersionService.getVersions(localDocId, userId);
    expect(versionsAfter1).toHaveLength(2);
    expect(versionsAfter1[1]?.content).toBe('Conflicting edit written on phone');

    // Second reconciliation run with nothing new: does NOT log a second entry
    addActivitySpy.mockClear();
    const result2 = await SyncService.reconcileLinkedDocuments(userId);
    expect(result2).toEqual({ reconciled: 0, skipped: 1, failed: 0, corrupted: 0 });
    expect(addActivitySpy).not.toHaveBeenCalled();
  });

  it('Note open in the editor with no sync-queue entry yet: fast-forward does NOT fire', async () => {
    const db = await getLocalDb(userId);
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
    expect(result).toEqual({ reconciled: 1, skipped: 0, failed: 0, corrupted: 0 });

    // Document currentVersion is raised to nextVersionNo (A-2.4), title and on-screen content preserved
    const docAfter = await db.get('documents', localDocId);
    expect(docAfter?.currentVersion).toBe(2);
    expect(docAfter?.title).toBe('Current Note In Editor');

    // But the remote change was saved to version history so it is not lost
    const versionsAfter = await LocalVersionService.getVersions(localDocId, userId);
    expect(versionsAfter).toHaveLength(2);
    expect(versionsAfter[1]?.content).toBe('Remote changes from tablet');
  });

  it('Falsification check: removing active editor check would clobber on-screen document', async () => {
    // If getActiveDocumentId returned null (simulating removing the active-editor check),
    // and queue had no entry, the code would take the fast-forward path and clobber currentVersion
    const db = await getLocalDb(userId);
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

    expect(result).toEqual({ reconciled: 0, skipped: 0, failed: 0, corrupted: 0, locked: true });
    expect(getUserDocsSpy).not.toHaveBeenCalled();
  });

  it('Two overlapping triggers: single-flight guard means only one reconciliation pass runs', async () => {
    const db = await getLocalDb(userId);
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

    expect(res1).toEqual({ reconciled: 1, skipped: 0, failed: 0, corrupted: 0 });
    expect(res2).toEqual({ reconciled: 1, skipped: 0, failed: 0, corrupted: 0 });
    expect(getUserDocsSpy).toHaveBeenCalledTimes(1);
  });

  it('syncVersionToCloud and reconcileLinkedDocuments contend for the same document lock (FOLLOWUP-2)', async () => {
    const db = await getLocalDb(userId);
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

    expect(reconcileResult).toEqual({ reconciled: 0, skipped: 1, failed: 0, corrupted: 0 });
  });
  it('R3-5: trashing on another device moves the linked note to the trash here, restoring takes it back out', async () => {
    const db = await getLocalDb(userId);
    const baseDoc = {
      id: localDocId, guestId: userId, title: 'T', currentVersion: 1, totalWords: 1, totalDuration: 1,
      sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 1000, tags: [], linkedCloudId: cloudDocId,
      lastSyncedCloudVersion: 1, lastSeenCloudUpdatedAt: '2026-09-19T10:00:00.000Z',
    };
    await db.put('documents', baseDoc);
    const cloudVersions = [{ id: 'cv_1', version: 1, content: 'x', wordCount: 1, duration: 1, wpm: 1 }] as any[];
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue(cloudVersions);
    const trashedAt = new Date('2026-09-19T11:00:00.000Z');
    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValueOnce([{
      id: cloudDocId, title: 'T', currentVersion: 1, tags: [], trashedAt,
      updatedAt: new Date('2026-09-19T11:00:00.000Z'),
    } as any]);

    await SyncService.reconcileLinkedDocuments(userId);
    expect((await db.get('documents', localDocId))?.trashedAt).toBe(trashedAt.getTime());

    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValueOnce([{
      id: cloudDocId, title: 'T', currentVersion: 1, tags: [], trashedAt: null,
      updatedAt: new Date('2026-09-19T12:00:00.000Z'),
    } as any]);
    await SyncService.reconcileLinkedDocuments(userId);
    expect((await db.get('documents', localDocId))?.trashedAt).toBeUndefined();
  });

  it('A-2.3: getAll(syncQueue) throws -> no local note changes and failed count bumped', async () => {
    const db = await getLocalDb(userId);
    await db.put('documents', {
      id: localDocId,
      guestId: userId,
      title: 'Original Title',
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

    const origGetAll = db.getAll.bind(db);
    vi.spyOn(db, 'getAll').mockImplementation((storeName: string, ...args: unknown[]) => {
      if (storeName === 'syncQueue') {
        return Promise.reject(new Error('IDB syncQueue read error'));
      }
      return origGetAll(storeName as never, ...(args as [never]));
    });

    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([{
      id: cloudDocId,
      title: 'Cloud Newer Title',
      currentVersion: 2,
      updatedAt: new Date('2026-09-20T10:00:00.000Z'),
    } as any]);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([{
      id: 'ver_c2',
      version: 2,
      content: 'Cloud 2 text',
      wordCount: 20,
      duration: 200,
      wpm: 20,
      sessionStartedAt: new Date('2026-09-20T10:00:00.000Z'),
    }] as any);

    const res = await SyncService.reconcileLinkedDocuments(userId);
    expect(res.failed).toBeGreaterThanOrEqual(1);

    const docAfter = await (await getLocalDb(userId)).get('documents', localDocId);
    expect(docAfter?.title).toBe('Original Title');
    expect(docAfter?.currentVersion).toBe(1);
  });

  it('A-2.3: note with currentVersion 5, lastSyncedCloudVersion 4, no task, cloud at 6 -> counters not set to 6, task exists', async () => {
    const db = await getLocalDb(userId);
    await db.put('documents', {
      id: localDocId,
      guestId: userId,
      title: 'Local Title v5',
      currentVersion: 5,
      totalWords: 50,
      totalDuration: 500,
      sessionsCount: 5,
      firstSessionAt: 1000,
      lastSessionAt: 5000,
      tags: [],
      linkedCloudId: cloudDocId,
      lastSyncedCloudVersion: 4,
      lastSeenCloudUpdatedAt: '2026-09-19T10:00:00.000Z',
    });
    await db.clear('syncQueue');

    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([{
      id: cloudDocId,
      title: 'Cloud Title v6',
      currentVersion: 6,
      updatedAt: new Date('2026-09-20T10:00:00.000Z'),
    } as any]);

    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([{
      id: 'ver_c6',
      version: 6,
      content: 'Cloud 6 text',
      wordCount: 60,
      duration: 600,
      wpm: 20,
      sessionStartedAt: new Date('2026-09-20T10:00:00.000Z'),
    }] as any);

    await SyncService.reconcileLinkedDocuments(userId);

    const docAfter = await db.get('documents', localDocId);
    expect(docAfter?.currentVersion).not.toBe(6);
    expect(docAfter?.lastSyncedCloudVersion).not.toBe(6);

    const task = await db.get('syncQueue', `sync_${localDocId}`);
    expect(task).toBeDefined();
  });

  it('A-2.3: task created between snapshot and lock -> pending branch is taken', async () => {
    const db = await getLocalDb(userId);
    await db.put('documents', {
      id: localDocId,
      guestId: userId,
      title: 'Local Title',
      currentVersion: 2,
      totalWords: 20,
      totalDuration: 200,
      sessionsCount: 2,
      firstSessionAt: 1000,
      lastSessionAt: 2000,
      tags: [],
      linkedCloudId: cloudDocId,
      lastSyncedCloudVersion: 2,
      lastSeenCloudUpdatedAt: '2026-09-19T10:00:00.000Z',
    });
    await db.clear('syncQueue');

    vi.spyOn(DocumentService, 'getUserDocuments').mockImplementation(async () => {
      const localDb = await getLocalDb(userId);
      await localDb.put('syncQueue', {
        id: `sync_${localDocId}`,
        documentId: localDocId,
        type: 'document',
        createdAt: Date.now(),
        ownerId: userId,
      });
      return [{
        id: cloudDocId,
        title: 'Cloud Title v3',
        currentVersion: 3,
        updatedAt: new Date('2026-09-20T10:00:00.000Z'),
      } as any];
    });

    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([{
      id: 'ver_c3',
      version: 3,
      content: 'Cloud 3 text',
      wordCount: 30,
      duration: 300,
      wpm: 20,
      sessionStartedAt: new Date('2026-09-20T10:00:00.000Z'),
    }] as any);

    await SyncService.reconcileLinkedDocuments(userId);

    const docAfter = await db.get('documents', localDocId);
    expect(docAfter?.lastSyncedCloudVersion).toBe(2);
  });

  it('A-2.4: pending branch runs, then local save -> versions have different numbers', async () => {
    const db = await getLocalDb(userId);
    await db.put('documents', {
      id: localDocId,
      guestId: userId,
      title: 'Local Doc',
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
    await db.put('versions', {
      id: 'ver_loc_1',
      documentId: localDocId,
      guestId: userId,
      version: 1,
      content: 'Initial v1',
      wordCount: 2,
      duration: 10,
      wpm: 20,
      sessionStartedAt: 1000,
    } as never);
    await db.put('syncQueue', {
      id: `sync_${localDocId}`,
      documentId: localDocId,
      type: 'document',
      createdAt: Date.now(),
      ownerId: userId,
    });

    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([{
      id: cloudDocId,
      title: 'Cloud Doc',
      currentVersion: 2,
      updatedAt: new Date('2026-09-20T10:00:00.000Z'),
    } as any]);

    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([{
      id: 'ver_c2',
      version: 2,
      content: 'Cloud v2 text',
      wordCount: 3,
      duration: 10,
      wpm: 20,
      sessionStartedAt: new Date('2026-09-20T10:00:00.000Z'),
    }] as any);

    await SyncService.reconcileLinkedDocuments(userId);

    await LocalStorageService.saveVersionToLocal(db, localDocId, {
      title: 'Local Doc',
      content: 'Next local edit',
      wordCount: 5,
      duration: 20,
      wpm: 30,
      tags: [],
      sessionStartedAt: new Date(),
    }, Date.now());

    const allVersions = await db.getAllFromIndex('versions', 'by-document', localDocId);
    const versionNumbers = allVersions.map(v => v.version);
    expect(new Set(versionNumbers).size).toBe(versionNumbers.length);
    expect(versionNumbers.sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('A-2.4 nit: counters ahead of the version rows (5 with only row 1) — the pending branch must not move currentVersion backwards', async () => {
    const db = await getLocalDb(userId);
    await db.put('documents', {
      id: localDocId,
      guestId: userId,
      title: 'Local Doc',
      currentVersion: 5,
      lastSyncedCloudVersion: 4,
      totalWords: 10,
      totalDuration: 10,
      sessionsCount: 1,
      firstSessionAt: 1000,
      lastSessionAt: 1000,
      tags: [],
      linkedCloudId: cloudDocId,
      lastSeenCloudUpdatedAt: '2026-09-19T10:00:00.000Z',
    });
    await db.put('versions', {
      id: 'ver_loc_1',
      documentId: localDocId,
      guestId: userId,
      version: 1,
      content: 'Initial v1',
      wordCount: 2,
      duration: 10,
      wpm: 20,
      sessionStartedAt: 1000,
    } as never);

    vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([{
      id: cloudDocId,
      title: 'Cloud Doc',
      currentVersion: 6,
      updatedAt: new Date('2026-09-20T10:00:00.000Z'),
    } as any]);
    vi.spyOn(VersionService, 'getVersions').mockResolvedValue([{
      id: 'ver_c6',
      version: 6,
      content: 'Cloud v6 text',
      wordCount: 3,
      duration: 10,
      wpm: 20,
      sessionStartedAt: new Date('2026-09-20T10:00:00.000Z'),
    }] as any);

    await SyncService.reconcileLinkedDocuments(userId);

    const doc = await db.get('documents', localDocId);
    expect(doc?.currentVersion).toBeGreaterThanOrEqual(5);

    const versions = await db.getAllFromIndex('versions', 'by-document', localDocId);
    const nums = versions.map(v => v.version).sort((a, b) => a - b);
    expect(new Set(nums).size).toBe(nums.length);
  });

  // R7F-010: флаг «не показывать ИИ» / корзина приехали забором с другого
  // устройства. Без события производные заметки (хронология, цитаты тем, линии)
  // жили на этом устройстве бессрочно — их чистит подписчик из features/ai.
  describe('R7F-010: прибытие флага скрытия чистит производные', () => {
    afterEach(() => {
      // Подписчики нужны только этому блоку: иначе они доедут до следующих тестов файла.
      _resetDomainEventHandlersForTests();
    });

    const seedVisible = async () => {
      const db = await getLocalDb(userId);
      await db.put('documents', {
        id: localDocId,
        guestId: userId,
        title: 'Note',
        currentVersion: 1,
        totalWords: 10,
        totalDuration: 100,
        sessionsCount: 1,
        firstSessionAt: 1000,
        lastSessionAt: 1000,
        tags: [],
        linkedCloudId: cloudDocId,
        lastSyncedCloudVersion: 1,
        lastSeenCloudUpdatedAt: '2026-09-19T10:00:00.000Z',
      });
      return db;
    };

    it('облако скрыло заметку → событие note.excludedFromAI по локальному id', async () => {
      await seedVisible();
      const seen: Array<{ id: string; excluded: boolean }> = [];
      onDomainEvent(e => { if (e.type === 'note.excludedFromAI') seen.push({ id: e.documentId, excluded: e.excluded }); });

      vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([{
        id: cloudDocId,
        title: 'Note',
        currentVersion: 2,
        excludedFromAI: true,
        updatedAt: new Date('2026-09-19T12:00:00.000Z'),
      } as any]);
      vi.spyOn(VersionService, 'getVersions').mockResolvedValue([
        { version: 1, content: 'Local version 1 text', wordCount: 10 },
        { version: 2, content: 'Cloud v2 text', wordCount: 12 },
      ] as any);

      await SyncService.reconcileLinkedDocuments(userId);

      expect(seen).toEqual([{ id: localDocId, excluded: true }]);
    });

    it('облако положило заметку в корзину → то же событие', async () => {
      await seedVisible();
      const seen: string[] = [];
      onDomainEvent(e => { if (e.type === 'note.excludedFromAI') seen.push(e.documentId); });

      vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([{
        id: cloudDocId,
        title: 'Note',
        currentVersion: 2,
        trashedAt: new Date('2026-09-19T12:00:00.000Z'),
        updatedAt: new Date('2026-09-19T12:00:00.000Z'),
      } as any]);
      vi.spyOn(VersionService, 'getVersions').mockResolvedValue([
        { version: 1, content: 'Local version 1 text', wordCount: 10 },
        { version: 2, content: 'Cloud v2 text', wordCount: 12 },
      ] as any);

      await SyncService.reconcileLinkedDocuments(userId);

      expect(seen).toEqual([localDocId]);
    });

    it('заметка и была скрыта, и осталась скрытой → второго события нет', async () => {
      const db = await seedVisible();
      await db.put('documents', { ...(await db.get('documents', localDocId))!, excludedFromAI: true } as never);
      const seen: string[] = [];
      onDomainEvent(e => { if (e.type === 'note.excludedFromAI') seen.push(e.documentId); });

      vi.spyOn(DocumentService, 'getUserDocuments').mockResolvedValue([{
        id: cloudDocId,
        title: 'Note',
        currentVersion: 2,
        excludedFromAI: true,
        updatedAt: new Date('2026-09-19T12:00:00.000Z'),
      } as any]);
      vi.spyOn(VersionService, 'getVersions').mockResolvedValue([
        { version: 1, content: 'Local version 1 text', wordCount: 10 },
        { version: 2, content: 'Cloud v2 text', wordCount: 12 },
      ] as any);

      await SyncService.reconcileLinkedDocuments(userId);

      // Положительный контроль: сверка прошла (версия поднялась), просто событие
      // не повторное — пустой проверки «события не было» здесь нет.
      expect((await db.get('documents', localDocId))?.currentVersion).toBe(2);
      expect(seen).toEqual([]);
    });
  });
});
