import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { SyncService } from '../SyncService';
import { StorageService } from '../StorageService';
import { CloudSyncService } from '../CloudSyncService';
import { LocalDocumentService } from '../LocalDocumentService';
import { LocalVersionService } from '../LocalVersionService';
import { DocumentService } from '../DocumentService';
import { VersionService } from '../VersionService';

const USER = 'guest_phase3_test';

describe('Phase 3 Fix Tickets: SYNC-3, SYNC-5, SYNC-6, SYNC-7, SYNC-8', () => {
  beforeEach(async () => {
    const db = await getLocalDb();
    for (const rec of await db.getAll('documents')) await db.delete('documents', (rec as { id: string }).id);
    for (const rec of await db.getAll('versions')) await db.delete('versions', (rec as { id: string }).id);
    for (const rec of await db.getAll('syncQueue')) await db.delete('syncQueue', (rec as { id: string }).id);
    vi.restoreAllMocks();
  });

  describe('SYNC-3: "Upload all notes" drains queue AFTER task producers', () => {
    it('uploads versions for note linked to an empty cloud row (current_version: 0)', async () => {
      const docId = await LocalDocumentService.createDocument(USER, {
        title: 'Note with empty cloud row',
        tags: [],
      });
      await LocalVersionService.addVersion(USER, docId, {
        content: 'Version 1 content',
        previousContent: '',
        wordCount: 3,
        wpm: 20,
        duration: 30,
        versionNumber: 1,
        sessionStartedAt: new Date(),
      });
      await LocalDocumentService.updateLinkedCloudId(docId, 'cloud_empty_row');
      await LocalDocumentService.updateDocument(docId, { currentVersion: 1, lastSyncedCloudVersion: 0 });

      const addCloudCopySpy = vi.spyOn(StorageService, 'addCloudCopy').mockResolvedValue('cloud_empty_row');
      vi.spyOn(CloudSyncService, 'relinkOrphanedDocuments').mockResolvedValue(undefined as never);

      const res = await SyncService.syncAllUnlinked(USER);

      expect(res.synced).toBe(1);
      expect(addCloudCopySpy).toHaveBeenCalledWith(USER, docId);
    });

    it('relink then upload in one press: re-linked note is uploaded and queue is drained', async () => {
      const docId = await LocalDocumentService.createDocument(USER, {
        title: 'Orphan note',
        tags: [],
      });
      await LocalVersionService.addVersion(USER, docId, {
        content: 'Orphan version 1',
        previousContent: '',
        wordCount: 3,
        wpm: 20,
        duration: 30,
        versionNumber: 1,
        sessionStartedAt: new Date(),
      });

      // relink reconnects the note and queues a task
      vi.spyOn(CloudSyncService, 'relinkOrphanedDocuments').mockImplementation(async () => {
        // Настоящая перелинковка работает только пока ссылка потеряна. Её зовут
        // дважды за нажатие — раз syncAllUnlinked, потом дренаж; второй раз
        // заметка уже связана, и новую задачу она не рождает. Прежняя заглушка
        // ставила задачу при каждом вызове, и после SB-1 (правка в полёте
        // остаётся в очереди по свежему `updatedAt`) эта лишняя постановка
        // начала держать очередь незакрытой.
        const current = await LocalDocumentService.getDocument(docId);
        if (current?.linkedCloudId) return { relinked: 0, skippedIds: [] };
        await LocalDocumentService.updateLinkedCloudId(docId, 'cloud_relinked_id');
        await LocalDocumentService.updateDocument(docId, { currentVersion: 1, lastSyncedCloudVersion: 0 });
        await SyncService.addToQueue(docId);
        return { relinked: 1, skippedIds: [] };
      });

      vi.spyOn(StorageService, 'addCloudCopy').mockResolvedValue('cloud_relinked_id');

      const res = await SyncService.syncAllUnlinked(USER);

      expect(res.synced).toBe(1);
      // Queue was drained after relink and upload
      const pending = await SyncService.getPendingCount();
      expect(pending).toBe(0);
    });
  });

  describe('SYNC-5: Exclude dead tasks from pending count; un-dead on vault unlock', () => {
    it('quarantined dead task is excluded from getPendingCount and included in getDeadCount', async () => {
      const db = await getLocalDb();
      await db.put('syncQueue', {
        id: 'sync_normal_1',
        documentId: 'doc_1',
        type: 'document',
        createdAt: Date.now(),
        attempts: 1,
        dead: false,
      });
      await db.put('syncQueue', {
        id: 'sync_dead_1',
        documentId: 'doc_2',
        type: 'document',
        createdAt: Date.now(),
        attempts: 10,
        dead: true,
        lastError: 'Error: LOCKED: vault is locked',
      });

      expect(await SyncService.getPendingCount()).toBe(1);
      expect(await SyncService.getDeadCount()).toBe(1);
    });

    it('reviveLockedTasks revives tasks that failed on LOCKED and clears dead flag', async () => {
      const db = await getLocalDb();
      await db.put('syncQueue', {
        id: 'sync_locked_task',
        documentId: 'doc_locked',
        type: 'document',
        createdAt: Date.now(),
        attempts: 1,
        dead: true,
        lastError: 'LOCKED: cannot sync to locked cloud document',
        ownerId: USER,
      });
      await db.put('syncQueue', {
        id: 'sync_other_dead',
        documentId: 'doc_other',
        type: 'document',
        createdAt: Date.now(),
        attempts: 10,
        dead: true,
        lastError: 'DECRYPTION_ERROR: fatal corrupted bytes',
        ownerId: USER,
      });

      const revived = await SyncService.reviveLockedTasks(USER);
      expect(revived).toBe(1);

      const task = await db.get('syncQueue', 'sync_locked_task');
      expect(task?.dead).toBe(false);
      expect(task?.attempts).toBe(0);

      const otherTask = await db.get('syncQueue', 'sync_other_dead');
      expect(otherTask?.dead).toBe(true);
    });
  });

  describe('SYNC-8: Unified queue ID and documentId cleanup', () => {
    it('addToQueue generates deterministic sync_${documentId} id', async () => {
      await SyncService.addToQueue('doc_abc');
      const db = await getLocalDb();
      const task = await db.get('syncQueue', 'sync_doc_abc');
      expect(task).toBeDefined();
      expect(task?.documentId).toBe('doc_abc');
    });

    it('removeQueueTasksForDocument removes tasks matching documentId even if timestamped', async () => {
      const db = await getLocalDb();
      await db.put('syncQueue', {
        id: 'sync_doc_xyz_123456789',
        documentId: 'doc_xyz',
        type: 'document',
        createdAt: Date.now(),
      });
      await db.put('syncQueue', {
        id: 'sync_doc_xyz',
        documentId: 'doc_xyz',
        type: 'document',
        createdAt: Date.now(),
      });
      await db.put('syncQueue', {
        id: 'sync_doc_other',
        documentId: 'doc_other',
        type: 'document',
        createdAt: Date.now(),
      });

      await SyncService.removeQueueTasksForDocument('doc_xyz');

      const remaining = await db.getAll('syncQueue');
      expect(remaining.map(r => r.id)).toEqual(['sync_doc_other']);
    });
  });

  describe('SYNC-6: Recover stranded work across tombstones preserving UUID', () => {
    it('unlinkFromCloud with tombstone sets unlinkedByTombstone: true', async () => {
      const docId = await LocalDocumentService.createDocument(USER, {
        title: 'Tombstoned note',
        tags: [],
      });
      await LocalDocumentService.updateLinkedCloudId(docId, 'cloud_tombstone');

      await LocalDocumentService.unlinkFromCloud(docId, 'tombstone');

      const doc = await LocalDocumentService.getDocument(docId);
      expect(doc?.localOnly).toBe(true);
      expect(doc?.unlinkedByTombstone).toBe(true);
      expect(doc?.linkedCloudId).toBe('');
    });

    it('addCloudCopy allows upload of note with unlinkedByTombstone: true', async () => {
      const docId = await LocalDocumentService.createDocument(USER, {
        title: 'Recovered note',
        tags: [],
      });
      await LocalDocumentService.unlinkFromCloud(docId, 'tombstone');

      vi.spyOn(DocumentService, 'createDocument').mockResolvedValue('new_cloud_id');
      // S0-4: после выгрузки отметка «до какой облачной версии» берется с сервера.
      vi.spyOn(DocumentService, 'getDocument').mockResolvedValue({
        id: 'new_cloud_id', uuid: 'new_cloud_id', currentVersion: 1,
        updatedAt: new Date().toISOString(),
      } as never);
      vi.spyOn(VersionService, 'addVersion').mockResolvedValue('v1_id');
      vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockResolvedValue(undefined as never);

      const cloudId = await CloudSyncService.addCloudCopy(USER, docId);
      expect(cloudId).toBe('new_cloud_id');

      const doc = await LocalDocumentService.getDocument(docId);
      expect(doc?.linkedCloudId).toBe('new_cloud_id');
      expect(doc?.localOnly).toBeUndefined();
      expect(doc?.unlinkedByTombstone).toBeUndefined();
    });
  });

  describe('SYNC-7: Catch-up uses pure set difference and sequential upload', () => {
    it('uploads missing middle version (cloud has 1, 3, 4; local has 1, 2, 3, 4)', async () => {
      const docId = await LocalDocumentService.createDocument(USER, {
        title: 'History gap note',
        tags: [],
      });
      // Add local versions 1..4
      for (let v = 1; v <= 4; v++) {
        await LocalVersionService.addVersion(USER, docId, {
          content: `Content version ${v}`,
          previousContent: v > 1 ? `Content version ${v - 1}` : '',
          wordCount: 3,
          wpm: 20,
          duration: 30,
          versionNumber: v,
          sessionStartedAt: new Date(1000 * v),
        });
      }
      await LocalDocumentService.updateLinkedCloudId(docId, 'cloud_doc_gap');

      // Mock cloud having versions 1, 3, 4 (missing 2)
      const mockDoc = {
        id: 'cloud_doc_gap',
        currentVersion: 4,
        totalWords: 3,
        totalDuration: 120,
        sessionsCount: 4,
      };
      vi.spyOn(DocumentService, 'getDocument').mockResolvedValue(mockDoc as never);
      vi.spyOn(DocumentService, 'getDocumentWithDeleted').mockResolvedValue(mockDoc as never);

      vi.spyOn(VersionService, 'getVersions').mockResolvedValue([
        { version: 1, content: 'Content version 1', wordCount: 3, duration: 30, wpm: 20 },
        { version: 3, content: 'Content version 3', wordCount: 3, duration: 30, wpm: 20 },
        { version: 4, content: 'Content version 4', wordCount: 3, duration: 30, wpm: 20 },
      ] as never);

      const uploadedVersions: number[] = [];
      vi.spyOn(VersionService, 'addVersion').mockImplementation(async (_u, _c, data) => {
        uploadedVersions.push((data as { versionNumber: number }).versionNumber);
        return 'new_v';
      });
      vi.spyOn(DocumentService, 'updateDocumentAfterSession').mockResolvedValue(undefined as never);

      await CloudSyncService.addCloudCopy(USER, docId);

      // Exactly version 2 was uploaded
      expect(uploadedVersions).toEqual([2]);
    });
  });
});
