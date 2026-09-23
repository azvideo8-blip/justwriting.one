import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { SyncService } from '../SyncService';
import { StorageService } from '../StorageService';
import { CloudSyncService } from '../CloudSyncService';
import { WritingDraftService } from '../../../features/writing/services/WritingDraftService';
import { LocalDocumentService } from '../LocalDocumentService';
import { DataProvider } from '../../data';
import { getLocalDb } from '../../storage/localDb';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

const USER_NO_SYNC = 'user_no_sync_d22';
const USER_WITH_SYNC = 'user_with_sync_d22';

describe('D-22: Strict Auto-Sync Off Guarantee', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(USER_NO_SYNC), 'false');
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED(USER_WITH_SYNC), 'true');

    const db = await getLocalDb();
    const allDocs = await db.getAll('documents');
    for (const d of allDocs) await db.delete('documents', d.id);
    const allQueue = await db.getAll('syncQueue');
    for (const q of allQueue) await db.delete('syncQueue', q.id);
  });

  describe('SyncService.syncOne', () => {
    it('does not send to cloud when auto-sync is off and leaves task in queue', async () => {
      const addCloudCopySpy = vi.spyOn(StorageService, 'addCloudCopy');
      const removeQueueSpy = vi.spyOn(SyncService, 'removeQueueTasksForDocument');

      const result = await SyncService.syncOne(USER_NO_SYNC, 'local_doc_1');

      expect(result).toBe('');
      expect(addCloudCopySpy).not.toHaveBeenCalled();
      expect(removeQueueSpy).not.toHaveBeenCalled();
    });

    it('sends to cloud when auto-sync is enabled', async () => {
      const addCloudCopySpy = vi.spyOn(StorageService, 'addCloudCopy').mockResolvedValueOnce('cloud_id_999');
      const removeQueueSpy = vi.spyOn(SyncService, 'removeQueueTasksForDocument').mockResolvedValueOnce();

      const result = await SyncService.syncOne(USER_WITH_SYNC, 'local_doc_2');

      expect(result).toBe('cloud_id_999');
      expect(addCloudCopySpy).toHaveBeenCalledWith(USER_WITH_SYNC, 'local_doc_2');
      expect(removeQueueSpy).toHaveBeenCalledWith('local_doc_2');
    });
  });

  describe('StorageService continuation save', () => {
    it('enqueues task and skips cloud sync when auto-sync is off', async () => {
      const syncCloudSpy = vi.spyOn(CloudSyncService, 'syncVersionToCloud');

      // Seed local doc with linkedCloudId
      const localDoc = {
        id: 'doc_existing_1',
        title: 'Original Title',
        content: 'Original Content',
        ownerId: USER_NO_SYNC,
        linkedCloudId: 'cloud_existing_1',
        currentVersion: 1,
        versions: [{ id: 'v1', version: 1, content: 'Original Content', title: 'Original Title', createdAt: 1000 }],
        lastSyncedCloudVersion: 1,
        totalDuration: 60,
      };
      const db = await getLocalDb();
      await db.put('documents', localDoc as never);

      const res = await StorageService.saveVersion(USER_NO_SYNC, 'doc_existing_1', {
        title: 'Updated Title',
        content: 'Updated Content',
        duration: 30,
        wordCount: 2,
        wpm: 0,
        tags: [],
        sessionStartedAt: new Date(),
      });

      expect(res.cloudSynced).toBe(false);
      expect(syncCloudSpy).not.toHaveBeenCalled();
      // Правка осталась в очереди: включат синхронизацию — уйдёт.
      expect(await db.get('syncQueue', 'sync_doc_existing_1')).toBeDefined();
    });

    it('calls syncVersionToCloud when auto-sync is enabled', async () => {
      const syncCloudSpy = vi.spyOn(CloudSyncService, 'syncVersionToCloud').mockResolvedValueOnce({
        cloudSynced: true,
        forked: false,
      });

      const localDoc = {
        id: 'doc_existing_2',
        title: 'Original Title 2',
        content: 'Original Content 2',
        ownerId: USER_WITH_SYNC,
        linkedCloudId: 'cloud_existing_2',
        currentVersion: 1,
        versions: [{ id: 'v1', version: 1, content: 'Original Content 2', title: 'Original Title 2', createdAt: 1000 }],
        lastSyncedCloudVersion: 1,
        totalDuration: 60,
      };
      const db = await getLocalDb();
      await db.put('documents', localDoc as never);

      const res = await StorageService.saveVersion(USER_WITH_SYNC, 'doc_existing_2', {
        title: 'Updated Title 2',
        content: 'Updated Content 2',
        duration: 30,
        wordCount: 3,
        wpm: 0,
        tags: [],
        sessionStartedAt: new Date(),
      });

      expect(res.cloudSynced).toBe(true);
      expect(syncCloudSpy).toHaveBeenCalled();
    });
  });

  describe('WritingDraftService.saveDraftToCloud', () => {
    it('returns false and does not call DataProvider when auto-sync is off', async () => {
      const saveDraftSpy = vi.spyOn(DataProvider, 'saveDraft');

      const draft = {
        userId: USER_NO_SYNC,
        content: 'Unsaved draft text',
        title: 'Draft',
        updatedAt: Date.now(),
      };

      const ok = await WritingDraftService.saveDraftToCloud(draft as never);

      expect(ok).toBe(false);
      expect(saveDraftSpy).not.toHaveBeenCalled();
    });
  });

  describe('SyncService.syncPending toggle behavior', () => {
    it('skips sync without force when auto-sync is disabled', async () => {
      const res = await SyncService.syncPending(USER_NO_SYNC);
      expect(res.skippedReason).toBe('sync_disabled');
      expect(res.drained).toBe(0);
    });

    it('allows explicit user manual sync with force: true even when auto-sync is disabled', async () => {
      const db = await getLocalDb();
      await db.put('syncQueue', {
        id: 'sync_local_doc_force',
        documentId: 'local_doc_force',
        ownerId: USER_NO_SYNC,
        type: 'document',
        createdAt: Date.now(),
        attempts: 0,
      } as never);

      vi.spyOn(LocalDocumentService, 'getDocument').mockResolvedValueOnce({
        id: 'local_doc_force',
        ownerId: USER_NO_SYNC,
        title: 'Forced doc',
        content: 'Hello',
      } as never);
      vi.spyOn(StorageService, 'addCloudCopy').mockResolvedValueOnce('cloud_forced_1');

      const res = await SyncService.syncPending(USER_NO_SYNC, { force: true });
      expect(res.skippedReason).toBeUndefined();
      expect(res.drained).toBe(1);
    });
  });
});
