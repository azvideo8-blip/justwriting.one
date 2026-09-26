import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { SyncService } from '../SyncService';
import { StorageService } from '../StorageService';
import * as cloudSyncModule from '../../sync/cloudSyncEnabled';

const USER = 'user_sweep_test';

async function clearDb() {
  const db = await getLocalDb(USER);
  for (const rec of await db.getAll('documents')) await db.delete('documents', (rec as { id: string }).id);
  for (const rec of await db.getAll('syncQueue')) await db.delete('syncQueue', (rec as { id: string }).id);
}

describe('SyncService.sweepOrphanedDocuments', () => {
  beforeEach(async () => {
    await clearDb();
    vi.restoreAllMocks();
    vi.spyOn(cloudSyncModule, 'cloudSyncEnabled').mockReturnValue(true);
  });

  it('enqueues unlinked-new document older than olderThanMs', async () => {
    const db = await getLocalDb(USER);
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    await db.put('documents', {
      id: 'local_orphan_1',
      guestId: USER,
      title: 'Случайная заметка',
      currentVersion: 1,
      totalWords: 50,
      totalDuration: 0,
      sessionsCount: 1,
      firstSessionAt: tenMinutesAgo,
      lastSessionAt: tenMinutesAgo,
      tags: ['ИИ'],
      linkedCloudId: '',
    } as never);

    const res = await SyncService.sweepOrphanedDocuments(USER, 5 * 60 * 1000);
    expect(res.enqueued).toBe(1);

    const queue = await db.getAll('syncQueue');
    const item = queue.find(q => q.documentId === 'local_orphan_1');
    expect(item).toBeDefined();
    expect(item?.ownerId).toBe(USER);
  });

  it('skips fresh documents created recently (< olderThanMs)', async () => {
    const db = await getLocalDb(USER);
    const oneMinuteAgo = Date.now() - 1 * 60 * 1000;
    await db.put('documents', {
      id: 'local_fresh_1',
      guestId: USER,
      title: 'Свежая заметка',
      currentVersion: 1,
      totalWords: 50,
      totalDuration: 0,
      sessionsCount: 1,
      firstSessionAt: oneMinuteAgo,
      lastSessionAt: oneMinuteAgo,
      tags: [],
      linkedCloudId: '',
    } as never);

    const res = await SyncService.sweepOrphanedDocuments(USER, 5 * 60 * 1000);
    expect(res.enqueued).toBe(0);

    const queue = await db.getAll('syncQueue');
    expect(queue.filter(q => q.documentId === 'local_fresh_1')).toHaveLength(0);
  });

  it('skips documents that are already present in syncQueue', async () => {
    const db = await getLocalDb(USER);
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    await db.put('documents', {
      id: 'local_already_queued',
      guestId: USER,
      title: 'Уже в очереди',
      currentVersion: 1,
      totalWords: 50,
      totalDuration: 0,
      sessionsCount: 1,
      firstSessionAt: tenMinutesAgo,
      lastSessionAt: tenMinutesAgo,
      tags: [],
      linkedCloudId: '',
    } as never);

    await db.put('syncQueue', {
      id: 'sync_local_already_queued',
      documentId: 'local_already_queued',
      type: 'document',
      createdAt: Date.now() - 30_000,
      ownerId: USER,
    });

    const res = await SyncService.sweepOrphanedDocuments(USER, 5 * 60 * 1000);
    expect(res.enqueued).toBe(0);
  });

  it('skips localOnly, unlinkedByTombstone, and locked documents', async () => {
    const db = await getLocalDb(USER);
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    await db.put('documents', {
      id: 'local_only_doc',
      guestId: USER,
      title: 'Только на устройстве',
      currentVersion: 1,
      totalWords: 50,
      totalDuration: 0,
      sessionsCount: 1,
      firstSessionAt: tenMinutesAgo,
      lastSessionAt: tenMinutesAgo,
      tags: [],
      localOnly: true,
    } as never);

    await db.put('documents', {
      id: 'tombstone_doc',
      guestId: USER,
      title: 'Удалено в облаке',
      currentVersion: 1,
      totalWords: 50,
      totalDuration: 0,
      sessionsCount: 1,
      firstSessionAt: tenMinutesAgo,
      lastSessionAt: tenMinutesAgo,
      tags: [],
      unlinkedByTombstone: true,
    } as never);

    await db.put('documents', {
      id: 'locked_doc',
      guestId: USER,
      title: 'Запертый сейф',
      currentVersion: 1,
      totalWords: 50,
      totalDuration: 0,
      sessionsCount: 1,
      firstSessionAt: tenMinutesAgo,
      lastSessionAt: tenMinutesAgo,
      tags: [],
      _locked: true,
    } as never);

    const res = await SyncService.sweepOrphanedDocuments(USER, 5 * 60 * 1000);
    expect(res.enqueued).toBe(0);
  });

  it('returns 0 when cloudSyncEnabled is false', async () => {
    vi.spyOn(cloudSyncModule, 'cloudSyncEnabled').mockReturnValue(false);

    const db = await getLocalDb(USER);
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    await db.put('documents', {
      id: 'local_orphan_no_consent',
      guestId: USER,
      title: 'Без согласия',
      currentVersion: 1,
      totalWords: 50,
      totalDuration: 0,
      sessionsCount: 1,
      firstSessionAt: tenMinutesAgo,
      lastSessionAt: tenMinutesAgo,
      tags: [],
      linkedCloudId: '',
    } as never);

    const res = await SyncService.sweepOrphanedDocuments(USER, 5 * 60 * 1000);
    expect(res.enqueued).toBe(0);
  });

  it('returns 0 when userId is guest', async () => {
    const res = await SyncService.sweepOrphanedDocuments('guest_xyz', 5 * 60 * 1000);
    expect(res.enqueued).toBe(0);
  });

  it('enqueues linked document that is behind cloud version', async () => {
    const db = await getLocalDb(USER);
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    await db.put('documents', {
      id: 'local_behind_doc',
      guestId: USER,
      title: 'Отставшая заметка',
      currentVersion: 3,
      lastSyncedCloudVersion: 2,
      totalWords: 150,
      totalDuration: 0,
      sessionsCount: 3,
      firstSessionAt: tenMinutesAgo,
      lastSessionAt: tenMinutesAgo,
      tags: [],
      linkedCloudId: 'cloud_behind_1',
    } as never);

    const res = await SyncService.sweepOrphanedDocuments(USER, 5 * 60 * 1000);
    expect(res.enqueued).toBe(1);

    const queue = await db.getAll('syncQueue');
    const item = queue.find(q => q.documentId === 'local_behind_doc');
    expect(item).toBeDefined();
  });
});

describe('SyncService.syncOne cleans up queue task upon success', () => {
  beforeEach(async () => {
    await clearDb();
    vi.restoreAllMocks();
  });

  it('removes queue task for document when syncOne succeeds', async () => {
    const db = await getLocalDb(USER);
    await db.put('documents', {
      id: 'local_to_sync',
      guestId: USER,
      title: 'Заметка для синхронизации',
      currentVersion: 1,
      totalWords: 50,
      totalDuration: 0,
      sessionsCount: 1,
      firstSessionAt: Date.now(),
      lastSessionAt: Date.now(),
      tags: [],
      linkedCloudId: '',
    } as never);

    await db.put('syncQueue', {
      id: 'sync_local_to_sync',
      documentId: 'local_to_sync',
      type: 'document',
      createdAt: Date.now(),
      ownerId: USER,
    });

    vi.spyOn(StorageService, 'addCloudCopy').mockResolvedValue('cloud_synced_999');

    localStorage.setItem(`auto_sync_enabled_${USER}`, 'true'); // D-22: syncOne отправляет только при включённой синхронизации
    const cloudId = await SyncService.syncOne(USER, 'local_to_sync');
    expect(cloudId).toBe('cloud_synced_999');

    const queue = await db.getAll('syncQueue');
    expect(queue.filter(q => q.documentId === 'local_to_sync')).toHaveLength(0);
  });
});
