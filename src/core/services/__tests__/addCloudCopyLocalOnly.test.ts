import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { CloudSyncService } from '../CloudSyncService';
import { DocumentService } from '../DocumentService';
import { getLocalDb } from '../../storage/localDb';

const USER = 'user_local_only_test';

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
  getCurrentUserId: () => USER,
}));

vi.mock('../DocumentService', () => ({
  DocumentService: {
    getDocument: vi.fn().mockResolvedValue(null),
    getDocumentWithDeleted: vi.fn().mockResolvedValue(null),
    createDocument: vi.fn().mockResolvedValue('cloud_new_uuid'),
    updateDocumentAfterSession: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../VersionService', () => ({
  VersionService: {
    getVersions: vi.fn().mockResolvedValue([]),
    addVersion: vi.fn().mockResolvedValue(undefined),
  },
}));

import { setProfileLoaded, setEncryptionEnabled } from '../../crypto/cryptoHelpers';

describe('Area 1: addCloudCopy on localOnly note', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setProfileLoaded(USER, true);
    setEncryptionEnabled(USER, false);
    const db = await getLocalDb();
    await db.clear('documents');
    await db.clear('versions');
  });

  it('FAILING TEST: addCloudCopy must NOT upload a note marked localOnly', async () => {
    const db = await getLocalDb();
    await db.put('documents', {
      id: 'local_priv_1',
      uuid: 'uuid_priv_1',
      guestId: USER,
      title: 'Личный секретный дневник',
      currentVersion: 1,
      totalWords: 10,
      totalDuration: 5,
      sessionsCount: 1,
      tags: [],
      linkedCloudId: '',
      localOnly: true, // User intentionally marked note as localOnly!
    } as any);

    await db.put('versions', {
      id: 'ver_1',
      documentId: 'local_priv_1',
      guestId: USER,
      version: 1,
      content: 'Секретный текст',
      wordCount: 2,
      wordsAdded: 2,
      charsAdded: 14,
      duration: 5,
      wpm: 24,
      savedAt: new Date().toISOString(),
      sessionStartedAt: new Date().toISOString(),
    } as any);

    const cloudId = await CloudSyncService.addCloudCopy(USER, 'local_priv_1');

    // Expected: note is localOnly, so it must NOT be uploaded to the cloud!
    expect(DocumentService.createDocument).not.toHaveBeenCalled();
    expect(cloudId).toBe('');
  });

  it('purges syncQueue tasks for localOnly note during addCloudCopy', async () => {
    const db = await getLocalDb();
    await db.put('documents', {
      id: 'local_priv_2',
      uuid: 'uuid_priv_2',
      guestId: USER,
      title: 'Личный секретный дневник 2',
      currentVersion: 1,
      totalWords: 10,
      totalDuration: 5,
      sessionsCount: 1,
      tags: [],
      linkedCloudId: '',
      localOnly: true,
    } as any);

    await db.put('syncQueue', {
      id: 'sync_local_priv_2_12345',
      documentId: 'local_priv_2',
      type: 'document',
      createdAt: Date.now(),
      ownerId: USER,
    } as any);

    await CloudSyncService.addCloudCopy(USER, 'local_priv_2');

    const remainingTasks = await db.getAll('syncQueue');
    expect(remainingTasks).toHaveLength(0);
  });
});
