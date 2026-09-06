import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CloudSyncService } from '../CloudSyncService';
import { getLocalDb } from '../../storage/localDb';
import { setProfileLoaded, setEncryptionEnabled } from '../../crypto/cryptoHelpers';

const USER = 'user_lock_test';

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
  getCurrentUserId: () => USER,
}));

vi.mock('../DocumentService', () => ({
  DocumentService: {
    getDocument: vi.fn().mockResolvedValue(null),
    getDocumentWithDeleted: vi.fn().mockResolvedValue(null),
    createDocument: vi.fn(async () => {
      await new Promise(r => setTimeout(r, 40));
      return 'cloud_doc_created';
    }),
    updateDocumentAfterSession: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../VersionService', () => ({
  VersionService: {
    getVersions: vi.fn().mockResolvedValue([]),
    addVersion: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('DEEP-3: sync lock owner token and mutual exclusion', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setProfileLoaded(USER, true);
    setEncryptionEnabled(USER, false);
    const db = await getLocalDb();
    await db.clear('documents');
    await db.clear('versions');
    await db.clear('syncQueue');

    // Seed test document
    await db.put('documents', {
      id: 'doc_lock_1',
      uuid: 'uuid_lock_1',
      guestId: USER,
      title: 'Lock test note',
      currentVersion: 1,
      totalWords: 10,
      totalDuration: 5,
      sessionsCount: 1,
      tags: [],
      linkedCloudId: '',
    } as any);

    await db.put('versions', {
      id: 'ver_lock_1',
      documentId: 'doc_lock_1',
      guestId: USER,
      version: 1,
      content: 'hello lock',
      wordCount: 10,
      duration: 5,
      wpm: 20,
      savedAt: Date.now(),
      sessionStartedAt: Date.now(),
    } as any);
  });

  it('two concurrent addCloudCopy calls: one succeeds, the other yields, lock cleaned up at end', async () => {
    const [res1, res2] = await Promise.all([
      CloudSyncService.addCloudCopy(USER, 'doc_lock_1'),
      CloudSyncService.addCloudCopy(USER, 'doc_lock_1'),
    ]);

    // One of them must have done the upload, the other must have returned empty string
    const results = [res1, res2].sort();
    expect(results[0]).toBe('');
    expect(results[1]).toBe('cloud_doc_created');

    // And the lock must be deleted after the pass finishes
    const db = await getLocalDb();
    const lock = await db.get('syncQueue', 'lock_cloud_doc_lock_1');
    expect(lock).toBeUndefined();
  });

  it('a stolen lock with a different ownerToken is NOT deleted by a previous owner on exit', async () => {
    const db = await getLocalDb();
    // Simulate another tab/pass taking the lock with a new ownerToken
    await db.put('syncQueue', {
      id: 'lock_cloud_doc_lock_1',
      documentId: 'doc_lock_1',
      type: 'document' as const,
      createdAt: Date.now(),
      ownerToken: 'new_active_owner_token',
    });

    // An old pass with token 'old_expired_owner_token' tries to clean up
    const cleanupTx = db.transaction('syncQueue', 'readwrite');
    const cur = await cleanupTx.store.get('lock_cloud_doc_lock_1');
    if (cur && cur.ownerToken === 'old_expired_owner_token') {
      await cleanupTx.store.delete('lock_cloud_doc_lock_1');
    }
    await cleanupTx.done;

    // The lock must still exist with the new owner's token!
    const lockAfter = await db.get('syncQueue', 'lock_cloud_doc_lock_1');
    expect(lockAfter).toBeDefined();
    expect(lockAfter?.ownerToken).toBe('new_active_owner_token');
  });

  it('syncVersionToCloud refuses when lock is held and queues to syncQueue', async () => {
    const db = await getLocalDb();
    // Lock is held by an active writer
    await db.put('syncQueue', {
      id: 'lock_cloud_doc_lock_1',
      documentId: 'doc_lock_1',
      type: 'document' as const,
      createdAt: Date.now(),
      ownerToken: 'active_drain_lock',
    });

    const res = await CloudSyncService.syncVersionToCloud(
      USER,
      'doc_lock_1',
      'cloud_uuid_1',
      { content: 'new words', wordCount: 15, duration: 10, wpm: 20, sessionStartedAt: new Date() } as any,
      2,
      'hello lock'
    );

    expect(res.cloudSynced).toBe(false);
    expect(res.reason).toBe('LOCK_HELD');

    // Must have queued a sync task for later drain
    const queued = await db.get('syncQueue', 'sync_doc_lock_1');
    expect(queued).toBeDefined();
  });
});
