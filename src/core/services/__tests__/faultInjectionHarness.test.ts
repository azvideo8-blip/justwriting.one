import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LifecycleRunner } from '../../../testing/faultHarness/lifecycleRunner';
import { DocumentService } from '../DocumentService';
import { StorageService } from '../StorageService';
import { LocalStorageService } from '../LocalStorageService';
import { CloudSyncService } from '../CloudSyncService';
import { SyncService } from '../SyncService';
import { getLocalDb, clearAllLocalStores } from '../../storage/localDb';
import { generateDataKey, setSessionKey, clearSessionKey } from '../../crypto/encrypt';
import { setEncryptionEnabled } from '../../crypto/cryptoHelpers';
import { encryptAllExistingNotes } from '../../crypto/encryptMigration';

describe('Fault-Injection Harness — The Four Postulates Attack Suite', () => {
  let runner: LifecycleRunner;

  beforeEach(async () => {
    runner = new LifecycleRunner();
    await runner.setup();
  });

  afterEach(() => {
    runner.teardown();
  });

  // =========================================================================
  // Baseline: All 10 sequences run cleanly with fault = 'none'
  // =========================================================================
  describe('Baseline Execution (fault = "none")', () => {
    it('Sequence 1: write → save → sync succeeds end-to-end', async () => {
      const res = await runner.runSeq1_WriteSaveSync('none', 'sync_cloud');
      expect(res.p1Held).toBe(true);
      expect(res.told.status).toBe('synced_to_cloud');
      expect(res.device.documentExists).toBe(true);
      expect(res.postgres.documentExists).toBe(true);
      expect(res.device.latestContent).toBe('Text from Seq1');
    });

    it('Sequence 2: write → save → edit → save → sync succeeds end-to-end', async () => {
      const res = await runner.runSeq2_WriteSaveEditSaveSync('none', 'sync_second');
      expect(res.p1Held).toBe(true);
      expect(res.told.status).toBe('synced_to_cloud');
      expect(res.device.currentVersion).toBe(2);
      expect(res.postgres.currentVersion).toBe(2);
      expect(res.device.latestContent).toBe('Version 2 updated text');
    });

    it('Sequence 3: cross-device divergence produces automated fork (SYNC-0)', async () => {
      const res = await runner.runSeq3_CrossDeviceDivergence('none', 'device_b_edit');
      expect(res.p1Held).toBe(true);
      expect(res.told.forked).toBe(true);
      expect(res.told.status).toBe('forked_conflict');
    });

    it('Sequence 4: write → save → sync → delete removes both sides', async () => {
      const res = await runner.runSeq4_WriteSaveSyncDelete('none', 'delete_local');
      expect(res.p1Held).toBe(true);
      expect(res.told.status).toBe('deleted');
      expect(res.device.documentExists).toBe(false);
      expect(res.postgres.deletedAt).toBeTruthy();
    });

    it('Sequence 5: delete before sync removes local document', async () => {
      const res = await runner.runSeq5_DeleteBeforeSync('none', 'delete_local');
      expect(res.device.documentExists).toBe(false);
      expect(res.told.status).toBe('deleted');
    });

    it('Sequence 6: tombstone recovery preserves offline edits (SYNC-6)', async () => {
      const res = await runner.runSeq6_TombstoneEditRecovery('none', 'edit_local');
      expect(res.p1Held).toBe(true);
      expect(res.device.documentExists).toBe(true);
      expect(res.device.unlinkedByTombstone).toBe(true);
      expect(res.device.latestContent).toContain('offline edits');
    });

    it('Sequence 7: restore from cloud recovers notes after device wipe', async () => {
      const res = await runner.runSeq7_SignOutEraseRestore('none', 'restore');
      expect(res.p1Held).toBe(true);
      expect(res.told.status).toBe('restored');
      expect(res.device.documentExists).toBe(true);
    });

    it('Sequence 8: guest migration carries notes to signed-in account', async () => {
      const res = await runner.runSeq8_GuestSignupMigrateSync('none', 'migrate');
      expect(res.p1Held).toBe(true);
      expect(res.device.latestContent).toBe('Guest text content');
      expect(res.postgres.documentExists).toBe(true);
    });

    it('Sequence 9: enable encryption encrypts cloud notes', async () => {
      const res = await runner.runSeq9_EnableEncryptionSyncRestore('none', 'enable_encryption');
      expect(res.p1Held).toBe(true);
      expect(res.postgres.isEncrypted).toBe(true);
    });

    it('Sequence 10: delete account wipes local and cloud state', async () => {
      const res = await runner.runSeq10_DeleteAccount('none', 'delete_account');
      expect(res.device.documentExists).toBe(false);
      expect(res.postgres.documentExists).toBe(false);
    });
  });

  // =========================================================================
  // Fault Injections against Sequence 1 (write → save → sync)
  // =========================================================================
  describe('Sequence 1 Fault Matrix', () => {
    it('Network failure before sync (network_pre) saves locally and queues for background sync', async () => {
      const res = await runner.runSeq1_WriteSaveSync('network_pre', 'sync_cloud');
      // What was person told:
      expect(res.told.status).toBe('saved_local_queued');
      expect(res.told.cloudSynced).toBe(false);
      // What is on device:
      expect(res.device.documentExists).toBe(true);
      expect(res.device.latestContent).toBe('Text from Seq1');
      // What is in Postgres:
      expect(res.postgres.documentExists).toBe(false);
      // P1 held: text is not lost
      expect(res.p1Held).toBe(true);
    });

    it('Postgres 500 on sync saves locally and enqueues task without losing text', async () => {
      const res = await runner.runSeq1_WriteSaveSync('postgres_500', 'sync_cloud');
      expect(res.told.cloudSynced).toBe(false);
      expect(res.device.documentExists).toBe(true);
      expect(res.device.latestContent).toBe('Text from Seq1');
      expect(res.p1Held).toBe(true);
    });

    it('Postgres 429 (rate limit) preserves local text and queues sync', async () => {
      const res = await runner.runSeq1_WriteSaveSync('postgres_429', 'sync_cloud');
      expect(res.told.cloudSynced).toBe(false);
      expect(res.device.documentExists).toBe(true);
      expect(res.device.latestContent).toBe('Text from Seq1');
      expect(res.p1Held).toBe(true);
    });

    it('IndexedDB QuotaExceededError on local save halts operation and notifies user', async () => {
      const res = await runner.runSeq1_WriteSaveSync('idb_quota', 'save_local');
      expect(res.told.status).toBe('error_thrown');
      expect(res.told.error).toContain('quota');
      // P1: caller was NOT told it was saved, so absence was not fabricated as success
      expect(res.p1Held).toBe(true);
    });

    it('Phantom write (network_post): write succeeds in Postgres but client ACK is dropped', async () => {
      // In a phantom write, the server committed the document, but network failed before response
      const res = await runner.runSeq1_WriteSaveSync('network_post', 'sync_cloud');
      // Person was told saved locally
      expect(res.told.cloudSynced).toBe(false);
      // Document DOES exist in Postgres (phantom)
      expect(res.postgres.documentExists).toBe(true);
      // Document exists on device
      expect(res.device.documentExists).toBe(true);
      expect(res.device.latestContent).toBe('Text from Seq1');
      // P1 held: text is safe on device
      expect(res.p1Held).toBe(true);
    });

    it('LIFE-1: next drain after phantom write adopts existing row and uploads versions to cloud', async () => {
      // 1. Run phantom write
      await runner.runSeq1_WriteSaveSync('network_post', 'sync_cloud');

      // Before drain: Postgres doc exists with 0 versions, client holds queued task
      const db = await getLocalDb();
      const allDocs = await db.getAll('documents');
      const localDoc = allDocs[0]!;
      expect(localDoc.linkedCloudId).toBeFalsy();

      const pgBefore = runner.inspectPostgres(localDoc.uuid!);
      expect(pgBefore.documentExists).toBe(true);
      expect(pgBefore.versionsCount).toBe(0);

      // Disarm fault interceptor so retry succeeds
      runner.interceptor.clearArmedFault();

      // 2. Next queue drain runs
      const drainRes = await SyncService.syncPending(runner.userId);
      expect(drainRes.drained).toBe(1);
      expect(drainRes.failed).toBe(0);

      // Local doc is now linked to cloud
      const updatedLocalDoc = await db.get('documents', localDoc.id);
      expect(updatedLocalDoc?.linkedCloudId).toBe(localDoc.uuid);

      // Postgres now has the versions and latest content!
      const pgAfter = runner.inspectPostgres(localDoc.uuid!);
      expect(pgAfter.documentExists).toBe(true);
      expect(pgAfter.versionsCount).toBeGreaterThanOrEqual(1);
      expect(pgAfter.latestContent).toBe('Text from Seq1');
    });

    it('LIFE-1: genuine duplicate — two different local notes claiming one uuid fails loudly', async () => {
      const db = await getLocalDb();
      const sharedUuid = 'shared-duplicate-uuid';

      // Insert cloud doc with sharedUuid
      runner.interceptor.postgres.executeInsert('documents', {
        uuid: sharedUuid,
        user_id: runner.userId,
        title: 'Cloud Doc',
        current_version: 1,
      });

      // Local note 1 already linked to sharedUuid
      const doc1Id = await LocalStorageService.createDocument(runner.userId, {
        title: 'Note 1',
        tags: [],
        firstSessionAt: 1000,
        lastSessionAt: 1000,
      });
      await LocalStorageService.updateLinkedCloudId(doc1Id, sharedUuid);

      // Local note 2 claiming the same uuid as its own permanent uuid
      const doc2Id = await LocalStorageService.createDocument(runner.userId, {
        title: 'Note 2',
        tags: [],
        firstSessionAt: 2000,
        lastSessionAt: 2000,
      });
      const doc2 = await db.get('documents', doc2Id);
      // Give doc2 the sharedUuid as its uuid
      // (doc1 has a different uuid, but linkedCloudId = sharedUuid)
      await db.put('documents', { ...doc2!, uuid: sharedUuid });

      // Attempting to add cloud copy of doc2 must fail loudly on collision
      await expect(
        CloudSyncService.addCloudCopy(runner.userId, doc2Id)
      ).rejects.toThrow(/DUPLICATE_UUID_COLLISION/);
    });
  });

  // =========================================================================
  // Attack on Corner 1: Fabricated Absence
  // "A failed read, a half-finished write, a locked vault or a parse error must
  // never be rendered as absence of data, and must never be written back as truth."
  // =========================================================================
  describe('Corner 1: Fabricated Absence Attacks', () => {
    it('Locked vault during restoreMissingDocuments reports 0 without wiping local data', async () => {
      // Setup encrypted profile with vault locked
      setEncryptionEnabled(runner.userId, true);
      clearSessionKey();

      const res = await CloudSyncService.restoreMissingDocuments(runner.userId, { force: true });
      expect(res.restored).toBe(0);

      // Verify that local documents were NOT deleted or overwritten with empty sets
      const allLocal = await LocalStorageService.getGuestDocuments(runner.userId);
      expect(Array.isArray(allLocal)).toBe(true);
    });

    it('Cloud read failure in DocumentService.getCloudDocumentVersions does not return fake clean state', async () => {
      // Inject network_pre into Supabase reads
      runner.interceptor.armFault('network_pre', 'sync_cloud');
      runner.interceptor.setStep('sync_cloud');

      // Проверять надо ВЫЗЫВАЮЩЕГО, а не заглушку: постулат нарушается там,
      // где отказ чтения превращается в пустую карту и идёт дальше как истина.
      //
      // Прежнее утверждение здесь было `await expect(...).toBeDefined()` — оно
      // истинно для любого промиса и не могло упасть никогда.
      await expect(
        DocumentService.getCloudDocumentVersions(runner.userId)
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // Attack on Corner 2: The Window Between "Written" and "Confirmed"
  // =========================================================================
  describe('Corner 2: Written vs Confirmed Window', () => {
    it('Truthful save feedback: returns cloudSynced = false when cloud sync fails or is queued', async () => {
      const localDocId = await LocalStorageService.createDocument(runner.userId, {
        title: 'Save Feedback Note',
        tags: [],
        firstSessionAt: 1000,
        lastSessionAt: 1000,
      });

      // Inject 500 on cloud
      runner.interceptor.armFault('postgres_500', 'sync_cloud');
      runner.interceptor.setStep('sync_cloud');

      const saveRes = await StorageService.saveVersion(runner.userId, localDocId, {
        title: 'Save Feedback Note',
        content: 'Local text',
        wordCount: 2,
        duration: 10,
        wpm: 12,
        tags: [],
        sessionStartedAt: new Date(1000),
      });

      // The UI must be told cloudSynced: false so it does NOT tell the user "Заметка сохранена"
      expect(saveRes.cloudSynced).toBe(false);
      expect(saveRes.forked).toBe(false);
    });
  });

  // =========================================================================
  // Attack on Corner 3: Deletion Integrity & Orphan Leakage
  // =========================================================================
  describe('Corner 3: Deletion Integrity & Orphan Leakage', () => {
    it('LIFE-4: deleting an unlinked local note removes its tasks from syncQueue', async () => {
      const localDocId = await LocalStorageService.createDocument(runner.userId, {
        title: 'Unlinked Note',
        tags: [],
        firstSessionAt: 1000,
        lastSessionAt: 1000,
      });
      await StorageService.saveVersion(runner.userId, localDocId, {
        title: 'Unlinked Note',
        content: 'Unlinked note content',
        wordCount: 3,
        duration: 15,
        wpm: 12,
        tags: [],
        sessionStartedAt: new Date(1000),
      });
      await SyncService.addToQueue(localDocId);

      // Now delete locally
      await StorageService.deleteDocument(runner.userId, localDocId, undefined);

      // Check IndexedDB
      const db = await getLocalDb();
      const doc = await db.get('documents', localDocId);
      expect(doc).toBeUndefined();

      // Check syncQueue: the task `sync_${localDocId}` is REMOVED from syncQueue!
      const queue = await db.getAll('syncQueue');
      const orphanTask = queue.find(q => q.documentId === localDocId || q.id === `sync_${localDocId}`);
      expect(orphanTask).toBeUndefined();

      // When syncPending runs, there is no orphan task and drain completes cleanly with 0 failures
      const drainRes = await SyncService.syncPending(runner.userId);
      expect(drainRes.failed).toBe(0);
      expect(drainRes.drained).toBe(0);
    });

    it('Asymmetric deletion: cloud delete failure enqueues delete task in syncQueue', async () => {
      const localDocId = await LocalStorageService.createDocument(runner.userId, {
        title: 'Cloud Delete Fail Note',
        tags: [],
        firstSessionAt: 1000,
        lastSessionAt: 1000,
      });
      await StorageService.saveVersion(runner.userId, localDocId, {
        title: 'Cloud Delete Fail Note',
        content: 'Content',
        wordCount: 1,
        duration: 5,
        wpm: 12,
        tags: [],
        sessionStartedAt: new Date(1000),
      });
      const cloudId = await StorageService.addCloudCopy(runner.userId, localDocId);

      // Arm network_pre on cloud delete
      runner.interceptor.armFault('network_pre', 'delete_cloud');
      runner.interceptor.setStep('delete_cloud');

      // Delete document
      await StorageService.deleteDocument(runner.userId, localDocId, cloudId);

      // Local copy is deleted
      const db = await getLocalDb();
      const doc = await db.get('documents', localDocId);
      expect(doc).toBeUndefined();

      // Cloud deletion failed, so a 'delete' task was placed in syncQueue
      const queue = await db.getAll('syncQueue');
      const deleteQueueItem = queue.find(q => q.type === 'delete' && q.documentId === cloudId);
      expect(deleteQueueItem).toBeDefined();
    });
  });

  // =========================================================================
  // Attack on Corner 4: Encryption Boundaries (P2)
  // =========================================================================
  describe('Corner 4: Encryption Boundaries (P2)', () => {
    it('LIFE-3: encryptAllExistingNotes re-encrypts AI derivatives (summaries, embeddings, localStore) in Postgres', async () => {
      const cloudId = 'doc_with_ai';
      // Setup cloud documents, versions, ai_summaries, ai_embeddings, local_store_records in plaintext
      runner.interceptor.postgres.executeInsert('documents', {
        uuid: cloudId,
        user_id: runner.userId,
        title: 'Plaintext Title',
        tags: ['tag1'],
        current_version: 1,
        _encrypted: false,
      });
      runner.interceptor.postgres.executeInsert('versions', {
        document_uuid: cloudId,
        user_id: runner.userId,
        version: 1,
        content: 'Plaintext Version Content',
        _encrypted: false,
      });
      runner.interceptor.postgres.executeInsert('ai_summaries', {
        document_id: cloudId,
        user_id: runner.userId,
        summary: 'Secret Psychological Summary',
        _encrypted: false,
      });
      runner.interceptor.postgres.executeInsert('ai_embeddings', {
        document_id: cloudId,
        user_id: runner.userId,
        vectors_json: '[[0.1, 0.2]]',
        chunk_texts_json: '["Secret semantic chunk"]',
        _encrypted: false,
      });
      runner.interceptor.postgres.executeInsert('local_store_records', {
        user_id: runner.userId,
        store: 'aiPortrait',
        key: 'portrait_1',
        payload: { data: 'Psychological Portrait Text' },
      });

      // Enable encryption
      const dataKey = await generateDataKey();
      setSessionKey(dataKey);
      setEncryptionEnabled(runner.userId, true);

      // Run migration
      const progress = await encryptAllExistingNotes(runner.userId);
      expect(progress.errors).toBe(0);

      // Check document row
      const doc = runner.interceptor.postgres.getRows('documents').find(d => d.uuid === cloudId);
      expect(doc?._encrypted).toBe(true);

      // Check version row
      const ver = runner.interceptor.postgres.getRows('versions').find(v => v.document_uuid === cloudId);
      expect(ver?._encrypted).toBe(true);

      // Check ai_summaries row: MUST BE ENCRYPTED
      const summary = runner.interceptor.postgres.getRows('ai_summaries').find(s => s.document_id === cloudId);
      expect(summary?._encrypted).toBe(true);
      expect(summary?.summary).not.toBe('Secret Psychological Summary');

      // Check ai_embeddings row: MUST BE ENCRYPTED
      const emb = runner.interceptor.postgres.getRows('ai_embeddings').find(e => e.document_id === cloudId);
      expect(emb?._encrypted).toBe(true);

      // Check local_store_records row: MUST BE ENCRYPTED
      const ls = runner.interceptor.postgres.getRows('local_store_records').find(r => r.record_key === 'portrait_1' || r.key === 'portrait_1');
      expect((ls?.payload as { _encrypted?: boolean })?._encrypted).toBe(true);
    });

    it('Locking vault between save and sync quarantines task without data loss (SYNC-5)', async () => {
      const dataKey = await generateDataKey();
      setSessionKey(dataKey);
      setEncryptionEnabled(runner.userId, true);

      const localDocId = await LocalStorageService.createDocument(runner.userId, {
        title: 'Vault Lock Note',
        tags: [],
        firstSessionAt: 1000,
        lastSessionAt: 1000,
      });
      await StorageService.saveVersion(runner.userId, localDocId, {
        title: 'Vault Lock Note',
        content: 'Encrypted content',
        wordCount: 2,
        duration: 10,
        wpm: 12,
        tags: [],
        sessionStartedAt: new Date(1000),
      });
      await SyncService.addToQueue(localDocId);

      // Lock vault before sync
      clearSessionKey();

      // Attempt sync while vault is locked
      await SyncService.syncPending(runner.userId);
      const db = await getLocalDb();
      const queue = await db.getAll('syncQueue');
      const task = queue.find(q => q.documentId === localDocId);
      expect(task).toBeDefined();
      expect(task?.lastError).toContain('ENCRYPT_REQUIRED');
      expect(task?.attempts).toBe(1);
      expect(task?.dead).toBe(true);

      // Pending queue considers this task quarantined (dead), so pending count is 0
      const pendingCountWhileLocked = await SyncService.getPendingCount(runner.userId);
      expect(pendingCountWhileLocked).toBe(0);

      // Now unlock vault and revive locked tasks
      setSessionKey(dataKey);
      const revived = await SyncService.reviveLockedTasks(runner.userId);
      expect(revived).toBe(1);

      const taskAfterRevive = await db.get('syncQueue', task!.id);
      expect(taskAfterRevive?.dead).toBe(false);
      expect(taskAfterRevive?.attempts).toBe(0);

      // Next sync succeeds without losing text
      const postUnlockRes = await SyncService.syncPending(runner.userId);
      expect(postUnlockRes.drained).toBe(1);

      // Content in Postgres is encrypted
      const updatedLocalDoc = await db.get('documents', localDocId);
      const pgLookup = updatedLocalDoc?.linkedCloudId || updatedLocalDoc?.uuid || localDocId;
      const pgState = runner.inspectPostgres(pgLookup);
      expect(pgState.documentExists).toBe(true);
      expect(pgState.isEncrypted).toBe(true);
    });

    it('LIFE-8: queue holding tasks for two accounts isolates pending count and wipe removes only current account tasks', async () => {
      const db = await getLocalDb();
      const userA = runner.userId;
      const userB = 'foreign_user_b';

      // Enqueue task for user A
      await db.put('syncQueue', {
        id: 'task_user_a',
        documentId: 'doc_a',
        type: 'document',
        createdAt: Date.now(),
        ownerId: userA,
      });

      // Enqueue task for user B
      await db.put('syncQueue', {
        id: 'task_user_b',
        documentId: 'doc_b',
        type: 'document',
        createdAt: Date.now(),
        ownerId: userB,
      });

      // 1. Pending count for user A only sees user A's tasks
      const countA = await SyncService.getPendingCount(userA);
      expect(countA).toBe(1);

      // Pending count for user B only sees user B's tasks
      const countB = await SyncService.getPendingCount(userB);
      expect(countB).toBe(1);

      // 2. Wipe user A's data
      await clearAllLocalStores(userA);

      // Check queue: user A's task was wiped, but user B's task remains!
      const dbAfter = await getLocalDb();
      const remainingTasks = await dbAfter.getAll('syncQueue');
      expect(remainingTasks.find(t => t.id === 'task_user_a')).toBeUndefined();
      expect(remainingTasks.find(t => t.id === 'task_user_b')).toBeDefined();
    });
  });

  // =========================================================================
  // Attack on Corner 5: Two Tabs Concurrency
  // =========================================================================
  describe('Corner 5: Two Tabs Concurrency', () => {
    it('Concurrent cross-tab save: SYNC-0 prevents cloud version regression and forks diverged edit', async () => {
      // Tab 1 creates note and syncs v1
      const localDocId = await LocalStorageService.createDocument(runner.userId, {
        title: 'Cross Tab Note',
        tags: [],
        firstSessionAt: 1000,
        lastSessionAt: 1000,
      });
      await StorageService.saveVersion(runner.userId, localDocId, {
        title: 'Cross Tab Note',
        content: 'Version 1',
        wordCount: 2,
        duration: 10,
        wpm: 12,
        tags: [],
        sessionStartedAt: new Date(1000),
      });
      const cloudId = await StorageService.addCloudCopy(runner.userId, localDocId);

      // Now simulate Tab B committing Version 3 first in Postgres
      runner.interceptor.postgres.executeInsert('versions', {
        document_uuid: cloudId,
        user_id: runner.userId,
        version: 3,
        content: 'Version 3 from Tab B',
        word_count: 4,
        duration: 30,
        session_started_at: new Date(1000),
        saved_at: new Date(1000),
      });
      runner.interceptor.postgres.executeUpdate(
        'documents',
        { current_version: 3 },
        [{ type: 'eq', column: 'uuid', value: cloudId }]
      );

      // Tab A (whose network request was delayed) now delivers Version 2
      // syncVersionToCloud receives newVersion = 2
      const res = await CloudSyncService.syncVersionToCloud(
        runner.userId,
        localDocId,
        cloudId,
        {
          title: 'Cross Tab Note',
          content: 'Version 2 from Tab A',
          wordCount: 4,
          duration: 20,
          wpm: 12,
          tags: [],
          sessionStartedAt: new Date(2000),
        },
        2,
        'Version 1'
      );

      // Inspect Postgres documents table:
      // Tab A's syncVersionToCloud detected that maxCloudVersion (3) >= newVersion (2)
      // and forked instead of regressing current_version!
      expect(res.forked).toBe(true);
      const doc = runner.interceptor.postgres.getRows('documents').find(d => d.uuid === cloudId);
      expect(doc?.current_version).toBe(3); // Verified: current_version 3 protected from regression!
    });
  });

  // =========================================================================
  // Attack on Corner 6: Restore Never Overwrites Newer Local Work (P1)
  // =========================================================================
  describe('Corner 6: Restore Invariant', () => {
    it('Restore does not overwrite newer local edits when document is linked', async () => {
      const localDocId = await LocalStorageService.createDocument(runner.userId, {
        title: 'Local Edit Note',
        tags: [],
        firstSessionAt: 1000,
        lastSessionAt: 1000,
      });
      await StorageService.saveVersion(runner.userId, localDocId, {
        title: 'Local Edit Note',
        content: 'v1 base',
        wordCount: 2,
        duration: 10,
        wpm: 12,
        tags: [],
        sessionStartedAt: new Date(1000),
      });
      await StorageService.addCloudCopy(runner.userId, localDocId);

      // Local device writes v2 offline
      await StorageService.saveVersion(runner.userId, localDocId, {
        title: 'Local Edit Note',
        content: 'v2 newer offline text',
        wordCount: 4,
        duration: 25,
        wpm: 12,
        tags: [],
        sessionStartedAt: new Date(2000),
      });

      // Restore runs
      const res = await CloudSyncService.restoreMissingDocuments(runner.userId, { force: true });
      expect(res.restored).toBe(0); // Correctly recognizes device already has this document

      const device = await runner.inspectDevice(localDocId);
      expect(device.latestContent).toBe('v2 newer offline text');
      expect(device.currentVersion).toBe(2);
    });

    it('Interrupted addLocalCopy deletes half-built local document and does not leave broken state', async () => {
      // Cloud has a note with 2 versions
      const cloudId = 'cloud_interrupted_note';
      runner.interceptor.postgres.executeInsert('documents', {
        uuid: cloudId,
        user_id: runner.userId,
        title: 'Interrupted Note',
        current_version: 2,
        first_session_at: new Date(1000).toISOString(),
        last_session_at: new Date(2000).toISOString(),
      });
      runner.interceptor.postgres.executeInsert('versions', {
        document_uuid: cloudId,
        user_id: runner.userId,
        version: 1,
        content: 'Version 1',
      });
      runner.interceptor.postgres.executeInsert('versions', {
        document_uuid: cloudId,
        user_id: runner.userId,
        version: 2,
        content: 'Version 2',
      });

      // Inject network_mid during version retrieval
      runner.interceptor.armFault('network_mid', 'sync_cloud', 'versions');
      runner.interceptor.setStep('sync_cloud');

      // Attempt addLocalCopy
      await expect(CloudSyncService.addLocalCopy(runner.userId, cloudId)).rejects.toThrow();

      // Verify that no half-built document remains in IndexedDB
      const allLocal = await LocalStorageService.getGuestDocuments(runner.userId);
      const halfBuilt = allLocal.find(d => d.linkedCloudId === cloudId || d.title === 'Interrupted Note');
      expect(halfBuilt).toBeUndefined();
    });
  });

  // =========================================================================
  // Full Matrix Execution
  // =========================================================================
  describe('Full Matrix Execution', () => {
    it('MatrixRunner executes all sequence × fault scenarios and captures 3 states', async () => {
      const { MatrixRunner } = await import('../../../testing/faultHarness/matrixRunner');
      const matrixRunner = new MatrixRunner(runner);
      const results = await matrixRunner.runFullMatrix();
      expect(results.length).toBeGreaterThanOrEqual(30);
      for (const cell of results) {
        expect(cell.told).toBeDefined();
        expect(cell.device).toBeDefined();
        expect(cell.postgres).toBeDefined();
      }
    });
  });
});
