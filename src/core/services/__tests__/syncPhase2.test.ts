import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { SyncService } from '../SyncService';
import { LocalDocumentService } from '../LocalDocumentService';
import { DocumentService } from '../DocumentService';
import { StorageService } from '../StorageService';
import { CloudSyncService } from '../CloudSyncService';
import { getLocalDb } from '../../storage/localDb';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

describe('Phase 2 Sync Fix Tickets: SYNC-1, SYNC-2, SYNC-4', () => {
  const userId = 'user_phase2_test';

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(userId), 'true'); // D-22: по умолчанию тесты проверяют облачную запись
    const db = await getLocalDb(userId);
    const tx = db.transaction(['documents', 'versions', 'syncQueue', 'profile'], 'readwrite');
    await Promise.all([
      tx.objectStore('documents').clear(),
      tx.objectStore('versions').clear(),
      tx.objectStore('syncQueue').clear(),
      tx.objectStore('profile').clear(),
      tx.done,
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('SYNC-1: Replace link count with content comparison & backfill', () => {
    it('Note linked to cloud row with 0 versions is counted as unsynced (behindCount > 0)', async () => {
      // Setup: cloud has document with current_version = 0 (empty row created in cloud)
      vi.spyOn(DocumentService, 'getCloudDocumentVersions').mockResolvedValue(new Map([
        ['cloud_doc_1', 0],
      ]));

      // Local doc has 1 version, linked to cloud_doc_1, lastSyncedCloudVersion is undefined
      const docId = await LocalDocumentService.createDocument(userId, { title: 'Local Note with v1' });
      await LocalDocumentService.updateLinkedCloudId(docId, 'cloud_doc_1', userId);
      await LocalDocumentService.updateDocument(docId, { currentVersion: 1 }, userId);

      const summary = await SyncService.getUnsyncedSummary(userId);

      expect(summary.behindCount).toBe(1);
      expect(summary.unlinkedCount).toBe(0);
      expect(summary.unsyncedCount).toBe(1);
      expect(summary.hasUnknown).toBe(false);

      // Verify that the local doc was backfilled with lastSyncedCloudVersion: 0 in IndexedDB
      const updatedLocal = await LocalDocumentService.getDocument(docId, userId);
      expect(updatedLocal?.lastSyncedCloudVersion).toBe(0);
    });

    it('Resolves notes with lastSyncedCloudVersion undefined once against cloud via single query', async () => {
      // Setup: 3 notes on device.
      // doc1: local v2, cloud v2 -> synced
      // doc2: local v3, cloud v1 -> behind by 2 versions
      // doc3: unlinked -> unlinked
      const cloudMap = new Map<string, number>([
        ['cloud_1', 2],
        ['cloud_2', 1],
      ]);
      const cloudSpy = vi.spyOn(DocumentService, 'getCloudDocumentVersions').mockResolvedValue(cloudMap);

      const d1Id = await LocalDocumentService.createDocument(userId, { title: 'Doc 1' });
      await LocalDocumentService.updateLinkedCloudId(d1Id, 'cloud_1', userId);
      await LocalDocumentService.updateDocument(d1Id, { currentVersion: 2 }, userId);

      const d2Id = await LocalDocumentService.createDocument(userId, { title: 'Doc 2' });
      await LocalDocumentService.updateLinkedCloudId(d2Id, 'cloud_2', userId);
      await LocalDocumentService.updateDocument(d2Id, { currentVersion: 3 }, userId);

      await LocalDocumentService.createDocument(userId, { title: 'Doc 3' });
      // d3 has no linkedCloudId

      const summary = await SyncService.getUnsyncedSummary(userId);

      // Single cloud query called
      expect(cloudSpy).toHaveBeenCalledTimes(1);
      expect(cloudSpy).toHaveBeenCalledWith(userId);

      expect(summary.behindCount).toBe(1); // d2
      expect(summary.unlinkedCount).toBe(1); // d3
      expect(summary.unsyncedCount).toBe(2);
      expect(summary.hasUnknown).toBe(false);

      // Subsequent call does NOT query cloud again because lastSyncedCloudVersion is now populated!
      cloudSpy.mockClear();
      const secondSummary = await SyncService.getUnsyncedSummary(userId);
      expect(cloudSpy).not.toHaveBeenCalled();
      expect(secondSummary.behindCount).toBe(1);
    });

    it('When cloud read fails, sets hasUnknown = true and never reports synced', async () => {
      vi.spyOn(DocumentService, 'getCloudDocumentVersions').mockRejectedValue(new Error('Network error'));

      const d1Id = await LocalDocumentService.createDocument(userId, { title: 'Doc 1' });
      await LocalDocumentService.updateLinkedCloudId(d1Id, 'cloud_1', userId);
      await LocalDocumentService.updateDocument(d1Id, { currentVersion: 1 }, userId);
      // lastSyncedCloudVersion is undefined

      const summary = await SyncService.getUnsyncedSummary(userId);
      expect(summary.hasUnknown).toBe(true);
    });

    it('Deliberately device-only note (localOnly: true) is not counted as unsynced', async () => {
      vi.spyOn(DocumentService, 'getCloudDocumentVersions').mockResolvedValue(new Map());

      const docId = await LocalDocumentService.createDocument(userId, { title: 'Private Local Note' });
      const db = await getLocalDb(userId);
      const doc = await db.get('documents', docId);
      await db.put('documents', { ...doc!, localOnly: true });

      const summary = await SyncService.getUnsyncedSummary(userId);
      expect(summary.deviceOnlyCount).toBe(1);
      expect(summary.unsyncedCount).toBe(0);
      expect(summary.behindCount).toBe(0);
      expect(summary.unlinkedCount).toBe(0);
    });
  });

  describe('SYNC-2: Save path returns whether cloud copy succeeded', () => {
    it('saveVersion returns cloudSynced: true when cloud upload succeeds', async () => {
      const docId = await LocalDocumentService.createDocument(userId, { title: 'Note' });
      await LocalDocumentService.updateLinkedCloudId(docId, 'cloud_doc_ok', userId);

      vi.spyOn(CloudSyncService, 'syncVersionToCloud').mockResolvedValue({
        forked: false,
        cloudSynced: true,
      });

      const res = await StorageService.saveVersion(userId, docId, {
        title: 'Note',
        content: 'New content',
        wordCount: 2,
        duration: 10,
        wpm: 20,
        tags: [],
        sessionStartedAt: new Date(),
      });

      expect(res.cloudSynced).toBe(true);
      expect(res.forked).toBe(false);
    });

    it('saveVersion returns cloudSynced: false and queues sync when cloud upload fails', async () => {
      const docId = await LocalDocumentService.createDocument(userId, { title: 'Note' });
      await LocalDocumentService.updateLinkedCloudId(docId, 'cloud_doc_err', userId);

      vi.spyOn(CloudSyncService, 'syncVersionToCloud').mockResolvedValue({
        forked: false,
        cloudSynced: false,
      });

      const res = await StorageService.saveVersion(userId, docId, {
        title: 'Note',
        content: 'Offline content',
        wordCount: 2,
        duration: 10,
        wpm: 20,
        tags: [],
        sessionStartedAt: new Date(),
      });

      expect(res.cloudSynced).toBe(false);
    });

    it('saveVersion returns cloudSynced: false when document is not linked to cloud', async () => {
      const docId = await LocalDocumentService.createDocument(userId, { title: 'Unlinked Note' });

      const res = await StorageService.saveVersion(userId, docId, {
        title: 'Unlinked Note',
        content: 'Local only content',
        wordCount: 3,
        duration: 10,
        wpm: 20,
        tags: [],
        sessionStartedAt: new Date(),
      });

      expect(res.cloudSynced).toBe(false);
    });
  });

  describe('SYNC-4: Buttons report what they actually did', () => {
    it('syncPending returns skippedReason: sync_disabled when auto-sync is off', async () => {
      localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(userId), 'false');

      const result = await SyncService.syncPending(userId);

      expect(result).toEqual({
        drained: 0,
        failed: 0,
        skippedReason: 'sync_disabled',
      });
    });

    it('syncPending returns drained count when queue tasks succeed', async () => {
      localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(userId), 'true');
      const db = await getLocalDb(userId);
      await db.put('syncQueue', {
        id: 'del_1',
        documentId: 'doc_to_delete',
        type: 'delete' as const, revocable: true,
        createdAt: Date.now(),
        ownerId: userId,
      } as never);

      vi.spyOn(CloudSyncService, 'removeCloudCopy').mockResolvedValue();

      const result = await SyncService.syncPending(userId);

      expect(result).toEqual({
        drained: 1,
        failed: 0,
        skippedReason: undefined,
      });

      const remaining = await SyncService.getPendingCount();
      expect(remaining).toBe(0);
    });

    it('syncPending returns failed count when tasks fail', async () => {
      localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(userId), 'true');
      const db = await getLocalDb(userId);
      await db.put('syncQueue', {
        id: 'del_fail',
        documentId: 'doc_fail',
        type: 'delete' as const, revocable: true,
        createdAt: Date.now(),
        ownerId: userId,
      } as never);

      vi.spyOn(CloudSyncService, 'removeCloudCopy').mockRejectedValue(new Error('Cloud 500'));

      const result = await SyncService.syncPending(userId);

      expect(result.drained).toBe(0);
      expect(result.failed).toBe(1);
    });
  });
});
