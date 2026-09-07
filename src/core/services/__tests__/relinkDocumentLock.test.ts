import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const updateLinkedCloudId = vi.fn(async () => undefined);
const getDocumentsByOwner = vi.fn(async () => [] as unknown[]);
const getUserDocuments = vi.fn(async () => [] as unknown[]);

vi.mock('../LocalStorageService', () => ({
  LocalStorageService: { updateLinkedCloudId, getDocumentsByOwner },
}));
vi.mock('../DocumentService', () => ({ DocumentService: { getUserDocuments } }));
vi.mock('../../../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: { getState: () => ({ addActivity: vi.fn() }) },
}));

const { __testing } = await import('../CloudSyncService');
const { getLocalDb } = await import('../../storage/localDb');

const UUID = '11111111-2222-4333-8444-555555555555';

function local(over: Record<string, unknown> = {}) {
  return {
    id: 'local_locked_1', uuid: UUID, guestId: 'u1', title: 'Locked Note',
    currentVersion: 1, totalWords: 100, totalDuration: 0, sessionsCount: 1,
    firstSessionAt: 1_700_000_000_000, lastSessionAt: 1_700_000_000_000, tags: [],
    ...over,
  } as any;
}

function cloud(over: Record<string, unknown> = {}) {
  return {
    id: 'cloud_1', uuid: UUID, title: 'Locked Note',
    firstSessionAt: new Date(1_700_000_000_000),
    lastSessionAt: new Date(1_700_000_000_000),
    currentVersion: 0, totalWords: 0,
    ...over,
  } as any;
}

describe('FU-3: relinkOrphaned respects withDocumentLock', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await getLocalDb();
    await db.clear('syncQueue');
    await db.clear('documents');
  });

  it('skips UUID-based relinking when document lock is held', async () => {
    const db = await getLocalDb();
    // Simulate active editor or another sync thread holding the lock
    await db.put('syncQueue', {
      id: 'lock_cloud_local_locked_1',
      documentId: 'local_locked_1',
      type: 'document' as const,
      createdAt: Date.now(),
      ownerToken: 'other_writer_token',
    });

    const doc = local();
    const { relinked, skippedIds } = await __testing.relinkOrphaned([doc], [cloud()]);

    // Should safely yield without mutating
    expect(relinked).toBe(0);
    expect(skippedIds).toEqual(['local_locked_1']);
    expect(updateLinkedCloudId).not.toHaveBeenCalled();
    expect(doc.linkedCloudId).toBeUndefined();

    // No sync task should have been queued
    const syncTask = await db.get('syncQueue', 'sync_local_locked_1');
    expect(syncTask).toBeUndefined();
  });

  it('relinks successfully when document lock is free and cleans up lock afterwards', async () => {
    const doc = local();
    const { relinked, skippedIds } = await __testing.relinkOrphaned([doc], [cloud()]);

    expect(relinked).toBe(1);
    expect(skippedIds).toEqual([]);
    expect(updateLinkedCloudId).toHaveBeenCalledWith('local_locked_1', 'cloud_1');
    expect(doc.linkedCloudId).toBe('cloud_1');

    // The lock was acquired and released
    const db = await getLocalDb();
    const lock = await db.get('syncQueue', 'lock_cloud_local_locked_1');
    expect(lock).toBeUndefined();
  });

  it('skips timestamp-based relinking when document lock is held', async () => {
    const db = await getLocalDb();
    await db.put('syncQueue', {
      id: 'lock_cloud_local_locked_2',
      documentId: 'local_locked_2',
      type: 'document' as const,
      createdAt: Date.now(),
      ownerToken: 'other_writer_token',
    });

    // Doc without UUID matching cloud Doc (so it falls back to timestamp-based relink)
    const docWithoutUuid = local({ id: 'local_locked_2', uuid: 'different-uuid-1' });
    const cloudDocWithoutUuid = cloud({ id: 'cloud_2', uuid: 'different-uuid-2' });

    const { relinked, skippedIds } = await __testing.relinkOrphaned([docWithoutUuid], [cloudDocWithoutUuid]);

    expect(relinked).toBe(0);
    expect(skippedIds).toEqual(['local_locked_2']);
    expect(updateLinkedCloudId).not.toHaveBeenCalled();
    expect(docWithoutUuid.linkedCloudId).toBeUndefined();
  });

  it('L-2: when lock is held for note A, syncAllUnlinked does NOT upload A as duplicate cloud note', async () => {
    const { SyncService } = await import('../SyncService');
    const { StorageService } = await import('../StorageService');
    const { LocalDocumentService } = await import('../LocalDocumentService');
    const { CloudSyncService } = await import('../CloudSyncService');

    const addCloudCopyMock = vi.spyOn(StorageService, 'addCloudCopy').mockResolvedValue('new_cloud_id');
    vi.spyOn(CloudSyncService, 'relinkOrphanedDocuments').mockResolvedValue({
      relinked: 0,
      skippedIds: ['local_locked_A'],
    });
    vi.spyOn(SyncService, 'getUnsyncedSummary').mockResolvedValue({} as any);
    vi.spyOn(LocalDocumentService, 'getDocumentsByOwner').mockResolvedValue([
      {
        id: 'local_locked_A',
        guestId: 'u1',
        title: 'Locked Note A',
        currentVersion: 1,
        lastSyncedCloudVersion: 0,
      } as any,
    ]);

    const res = await SyncService.syncAllUnlinked('u1');

    // Note A was skipped during relink because lock was held;
    // syncAllUnlinked must NOT upload it on this pass!
    expect(addCloudCopyMock).not.toHaveBeenCalled();
    expect(res.synced).toBe(0);
  });
});

