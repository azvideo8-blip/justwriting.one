import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { LocalVersionService } from '../LocalVersionService';
import { LocalDocumentService } from '../LocalDocumentService';
import { CloudSyncService } from '../CloudSyncService';
import { getLocalDb } from '../../storage/localDb';
import { DataProvider } from '../../data';
import { setProfileLoaded, setEncryptionEnabled } from '../../crypto/cryptoHelpers';

const USER = 'user_collapse_test';

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER, isAnonymous: false }),
  getCurrentUserId: () => USER,
}));

vi.mock('../../sync/cloudSyncEnabled', () => ({
  cloudSyncEnabled: () => true,
}));

describe('DEEP-6: version collapse in diagnostics persists across sync', () => {
  // In-memory cloud storage mock for versions and documents
  let cloudVersions: Array<{
    id: string;
    documentId: string;
    version: number;
    content: string;
    wordCount: number;
    duration: number;
    wpm: number;
    savedAt: Date;
    sessionStartedAt: Date;
  }> = [];
  let cloudDocs = new Map<string, any>();

  beforeEach(async () => {
    vi.clearAllMocks();
    setProfileLoaded(USER, true);
    setEncryptionEnabled(USER, false);
    cloudVersions = [];
    cloudDocs.clear();

    const db = await getLocalDb();
    await db.clear('documents');
    await db.clear('versions');
    await db.clear('syncQueue');

    // Wire DataProvider mock
    vi.spyOn(DataProvider, 'getDocument').mockImplementation(async (_uid, cloudDocId) => {
      return cloudDocs.get(cloudDocId) ?? null;
    });

    vi.spyOn(DataProvider, 'getDocumentWithDeleted').mockImplementation(async (_uid, cloudDocId) => {
      return cloudDocs.get(cloudDocId) ?? null;
    });

    vi.spyOn(DataProvider, 'createDocument').mockImplementation(async (_uid, data) => {
      const id = 'cloud_doc_uuid_1';
      cloudDocs.set(id, { ...data, id, uuid: id });
      return id;
    });

    vi.spyOn(DataProvider, 'updateDocument').mockImplementation(async (_uid, cloudDocId, data) => {
      const existing = cloudDocs.get(cloudDocId) ?? {};
      cloudDocs.set(cloudDocId, { ...existing, ...data });
    });

    vi.spyOn(DataProvider, 'updateDocumentSessionStats').mockImplementation(async (_uid, cloudDocId, data) => {
      const existing = cloudDocs.get(cloudDocId) ?? {};
      cloudDocs.set(cloudDocId, { ...existing, ...data });
    });

    vi.spyOn(DataProvider, 'getVersions').mockImplementation(async () => {
      return [...cloudVersions];
    });

    vi.spyOn(DataProvider, 'addVersion').mockImplementation(async (_uid, _docId, versionDocId, data: any) => {
      cloudVersions.push({
        id: versionDocId,
        documentId: data.documentId,
        version: data.version,
        content: data.content,
        wordCount: data.wordCount,
        duration: data.duration,
        wpm: data.wpm,
        savedAt: new Date(data.savedAt),
        sessionStartedAt: new Date(data.sessionStartedAt),
      });
    });

    vi.spyOn(DataProvider, 'deleteVersionsBatch').mockImplementation(async (_uid, _docId, versionIds) => {
      const numIds = new Set(versionIds.map(v => parseInt(v.replace(/^v/i, ''), 10)));
      cloudVersions = cloudVersions.filter(v => !numIds.has(v.version));
    });
  });

  it('collapsing versions deletes intermediate versions locally and in the cloud, not restored by next sync', async () => {
    // 1. Create a local document with 3 versions
    const docId = await LocalDocumentService.createDocument(USER, {
      title: 'Collapsible note',
      tags: [],
    });

    const now = new Date();
    await LocalVersionService.addVersion(USER, docId, {
      content: 'Version 1 content',
      previousContent: '',
      wordCount: 3,
      duration: 30,
      wpm: 6,
      versionNumber: 1,
      sessionStartedAt: new Date(now.getTime() - 20000),
      savedAt: new Date(now.getTime() - 20000),
    });

    await LocalVersionService.addVersion(USER, docId, {
      content: 'Version 1 content and Version 2 content',
      previousContent: 'Version 1 content',
      wordCount: 7,
      duration: 30,
      wpm: 8,
      versionNumber: 2,
      sessionStartedAt: new Date(now.getTime() - 10000),
      savedAt: new Date(now.getTime() - 10000),
    });

    await LocalVersionService.addVersion(USER, docId, {
      content: 'Version 1 content and Version 2 content and Version 3 content',
      previousContent: 'Version 1 content and Version 2 content',
      wordCount: 11,
      duration: 30,
      wpm: 8,
      versionNumber: 3,
      sessionStartedAt: now,
      savedAt: now,
    });

    // 2. Perform initial sync to cloud
    const cloudId = await CloudSyncService.addCloudCopy(USER, docId);
    expect(cloudId).toBeTruthy();

    // Verify initial state: 3 versions locally, 3 in cloud
    const localBefore = await LocalVersionService.getVersions(docId);
    expect(localBefore.length).toBe(3);
    expect(cloudVersions.length).toBe(3);

    // 3. Perform version collapse (as triggered in diagnostics)
    const result = await LocalVersionService.collapseToLatest(docId, USER);
    expect(result.removedCount).toBe(2);
    expect(result.deletedVersionNumbers).toEqual([1, 2]);

    // Verify local and cloud state immediately after collapse: only 1 version remaining
    const localAfterCollapse = await LocalVersionService.getVersions(docId);
    expect(localAfterCollapse.length).toBe(1);
    expect(localAfterCollapse[0]!.version).toBe(3);
    expect(cloudVersions.length).toBe(1);
    expect(cloudVersions[0]!.version).toBe(3);

    // 4. Run a full sync pass
    await CloudSyncService.addCloudCopy(USER, docId);

    // 5. Verify that sync DID NOT restore the deleted versions
    const localAfterSync = await LocalVersionService.getVersions(docId);
    expect(localAfterSync.length).toBe(1);
    expect(localAfterSync[0]!.version).toBe(3);
    expect(cloudVersions.length).toBe(1);
    expect(cloudVersions[0]!.version).toBe(3);
  });

  it('countCollapsibleVersions correctly counts older versions to be removed across documents', async () => {
    const doc1 = await LocalDocumentService.createDocument(USER, { title: 'Doc 1', tags: [] });
    const doc2 = await LocalDocumentService.createDocument(USER, { title: 'Doc 2', tags: [] });
    const doc3 = await LocalDocumentService.createDocument(USER, { title: 'Doc 3', tags: [] });

    // doc1: 3 versions -> 2 collapsible
    for (let i = 1; i <= 3; i++) {
      await LocalVersionService.addVersion(USER, doc1, {
        content: `Doc 1 v${i}`,
        previousContent: '',
        wordCount: i,
        duration: 10,
        wpm: 5,
        versionNumber: i,
        sessionStartedAt: new Date(),
      });
    }

    // doc2: 1 version -> 0 collapsible
    await LocalVersionService.addVersion(USER, doc2, {
      content: 'Doc 2 v1',
      previousContent: '',
      wordCount: 1,
      duration: 10,
      wpm: 5,
      versionNumber: 1,
      sessionStartedAt: new Date(),
    });

    // doc3: 2 versions -> 1 collapsible
    for (let i = 1; i <= 2; i++) {
      await LocalVersionService.addVersion(USER, doc3, {
        content: `Doc 3 v${i}`,
        previousContent: '',
        wordCount: i,
        duration: 10,
        wpm: 5,
        versionNumber: i,
        sessionStartedAt: new Date(),
      });
    }

    const count = await LocalVersionService.countCollapsibleVersions([doc1, doc2, doc3]);
    expect(count).toBe(3); // 2 from doc1 + 0 from doc2 + 1 from doc3
  });

  // EA-13: при сбое облака устройство не трогаем — иначе следующая загрузка
  // скачала бы «удалённые» версии обратно.
  it('collapseToLatest leaves local versions alone and returns cloudError when cloud delete rejects', async () => {
    const docId = await LocalDocumentService.createDocument(USER, { title: 'Fail cloud doc', tags: [] });
    for (let i = 1; i <= 2; i++) {
      await LocalVersionService.addVersion(USER, docId, {
        content: `Content v${i}`,
        previousContent: '',
        wordCount: i,
        duration: 10,
        wpm: 5,
        versionNumber: i,
        sessionStartedAt: new Date(),
      });
    }

    // Link to cloud
    await CloudSyncService.addCloudCopy(USER, docId);

    // Mock deleteVersionsBatch rejection
    const error = new Error('Network timeout during cloud version delete');
    vi.spyOn(DataProvider, 'deleteVersionsBatch').mockRejectedValueOnce(error);

    const result = await LocalVersionService.collapseToLatest(docId, USER);
    expect(result.removedCount).toBe(0);
    expect(result.cloudError).toBe(error);

    // Both versions are still on the device
    const local = await LocalVersionService.getVersions(docId);
    expect(local.map(v => v.version).sort()).toEqual([1, 2]);
  });
});
