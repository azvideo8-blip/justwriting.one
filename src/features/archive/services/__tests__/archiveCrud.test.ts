import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateArchiveField, deleteArchiveSession } from '../archiveCrud';
import { ArchiveSession } from '../../types';
import { User } from 'firebase/auth';

vi.mock('../../../../core/services/DocumentService', () => ({
  DocumentService: {
    updateTags: vi.fn().mockResolvedValue(undefined),
    updateTitle: vi.fn().mockResolvedValue(undefined),
    updateDate: vi.fn().mockResolvedValue(undefined),
    updateLabelId: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: {
    updateTags: vi.fn().mockResolvedValue(undefined),
    updateTitle: vi.fn().mockResolvedValue(undefined),
    updateDate: vi.fn().mockResolvedValue(undefined),
    updateLabelId: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: {
    deleteDocument: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: {
    addToQueue: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../../core/services/CloudSyncService', () => ({
  CloudSyncService: {
    addLocalCopy: vi.fn().mockResolvedValue('new_local_id'),
  },
}));

import { LocalDocumentService } from '../../../../core/services/LocalDocumentService';
import { DocumentService } from '../../../../core/services/DocumentService';
import { SyncService } from '../../../../core/services/SyncService';
import { CloudSyncService } from '../../../../core/services/CloudSyncService';

const mockUser = { uid: 'user1' } as unknown as User;

function makeSession(overrides: Partial<ArchiveSession> = {}): ArchiveSession {
  return {
    id: 's1',
    userId: 'user1',
    content: '',
    duration: 60,
    wordCount: 100,
    charCount: 0,
    wpm: 0,
    title: 'Test',
    tags: [],
    createdAt: new Date(),
    _isLegacy: false,
    _isLocal: false,
    ...overrides,
  };
}

describe('updateArchiveField — local session', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tags → LocalDocumentService.updateTags', async () => {
    await updateArchiveField(makeSession({ _isLocal: true }), 'tags', ['t1'], mockUser, 'user1');
    expect(LocalDocumentService.updateTags).toHaveBeenCalledWith('s1', ['t1']);
  });

  it('title → LocalDocumentService.updateTitle', async () => {
    await updateArchiveField(makeSession({ _isLocal: true }), 'title', 'New Title', mockUser, 'user1');
    expect(LocalDocumentService.updateTitle).toHaveBeenCalledWith('s1', 'New Title');
  });

  it('date → LocalDocumentService.updateDate with timestamp', async () => {
    const d = new Date(2024, 0, 1);
    await updateArchiveField(makeSession({ _isLocal: true }), 'date', d, mockUser, 'user1');
    expect(LocalDocumentService.updateDate).toHaveBeenCalledWith('s1', d.getTime(), d.getTime());
  });

  it('labelId → LocalDocumentService.updateLabelId', async () => {
    await updateArchiveField(makeSession({ _isLocal: true }), 'labelId', 'label1', mockUser, 'user1');
    expect(LocalDocumentService.updateLabelId).toHaveBeenCalledWith('s1', 'label1');
  });

  it('labelId undefined → LocalDocumentService.updateLabelId with undefined', async () => {
    await updateArchiveField(makeSession({ _isLocal: true }), 'labelId', undefined, mockUser, 'user1');
    expect(LocalDocumentService.updateLabelId).toHaveBeenCalledWith('s1', undefined);
  });

  it('also syncs to cloud if linkedCloudId present', async () => {
    await updateArchiveField(
      makeSession({ _isLocal: true, _linkedCloudId: 'cloud1' }),
      'tags', ['t1'], mockUser, 'user1'
    );
    expect(DocumentService.updateTags).toHaveBeenCalledWith('user1', 'cloud1', ['t1']);
  });

  it('does NOT call DocumentService if no linkedCloudId', async () => {
    await updateArchiveField(makeSession({ _isLocal: true }), 'tags', ['t1'], mockUser, 'user1');
    expect(DocumentService.updateTags).not.toHaveBeenCalled();
  });

  it('returns cloudSyncFailed=true when cloud sync rejects', async () => {
    vi.mocked(DocumentService.updateTags).mockRejectedValueOnce(new Error('network'));
    const result = await updateArchiveField(
      makeSession({ _isLocal: true, _linkedCloudId: 'cloud1' }),
      'tags', ['t1'], mockUser, 'user1'
    );
    expect(result).toEqual({ success: true, cloudSyncFailed: true });
  });

  it('enqueues the LOCAL id (session.id) — not the cloud id — when cloud sync rejects', async () => {
    // The drain (_drainPendingQueue -> StorageService.addCloudCopy) looks up a
    // local IndexedDB document by the queued id; queuing the cloud id here
    // would make the sync permanently fail to find a matching local doc.
    vi.mocked(DocumentService.updateTitle).mockRejectedValueOnce(
      Object.assign(new Error('resource-exhausted'), { code: 'resource-exhausted' })
    );
    await updateArchiveField(
      makeSession({ _isLocal: true, _linkedCloudId: 'cloud1' }),
      'title', 'New Title', mockUser, 'user1'
    );
    expect(SyncService.addToQueue).toHaveBeenCalledWith('s1');
  });
});

describe('updateArchiveField — cloud-only session', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tags → DocumentService.updateTags', async () => {
    await updateArchiveField(makeSession(), 'tags', ['t1'], mockUser, 'user1');
    expect(DocumentService.updateTags).toHaveBeenCalledWith('user1', 's1', ['t1']);
  });

  it('title → DocumentService.updateTitle', async () => {
    await updateArchiveField(makeSession(), 'title', 'Cloud Title', mockUser, 'user1');
    expect(DocumentService.updateTitle).toHaveBeenCalledWith('user1', 's1', 'Cloud Title');
  });

  it('date → DocumentService.updateDate', async () => {
    const d = new Date(2024, 0, 1);
    await updateArchiveField(makeSession(), 'date', d, mockUser, 'user1');
    expect(DocumentService.updateDate).toHaveBeenCalledWith('user1', 's1', d, d);
  });

  it('labelId → DocumentService.updateLabelId', async () => {
    await updateArchiveField(makeSession(), 'labelId', 'label2', mockUser, 'user1');
    expect(DocumentService.updateLabelId).toHaveBeenCalledWith('user1', 's1', 'label2');
  });

  it('does nothing if user is null', async () => {
    await updateArchiveField(makeSession(), 'tags', ['t1'], null, 'user1');
    expect(DocumentService.updateTags).not.toHaveBeenCalled();
  });

  it('throws if date value is not a Date', async () => {
    await expect(
      updateArchiveField(makeSession(), 'date', 'not-a-date', mockUser, 'user1')
    ).rejects.toThrow('Expected Date for date field');
  });
});

describe('updateArchiveField — cloud-only offline fallback (SYNC-1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a local shadow copy (via CloudSyncService.addLocalCopy) and applies the edit when cloud rejects', async () => {
    vi.mocked(DocumentService.updateTitle).mockRejectedValueOnce(
      Object.assign(new Error('resource-exhausted'), { code: 'resource-exhausted' })
    );

    const result = await updateArchiveField(
      makeSession({ title: 'Old Title', tags: ['t1'] }),
      'title', 'New Title', mockUser, 'user1'
    );

    expect(result).toEqual({ success: true, cloudSyncFailed: true });
    // addLocalCopy (not a hand-rolled createDocument here) pulls the real
    // content/versions from the cloud and handles create-or-reuse itself.
    expect(CloudSyncService.addLocalCopy).toHaveBeenCalledWith('user1', 's1');
    expect(LocalDocumentService.updateTitle).toHaveBeenCalledWith('new_local_id', 'New Title');
    // Must queue the NEW LOCAL id, not the cloud id ('s1') — the drain looks
    // up a local IndexedDB document by this id.
    expect(SyncService.addToQueue).toHaveBeenCalledWith('new_local_id');
  });

  it('rejects when both cloud and the local fallback (addLocalCopy) fail — must not report false success', async () => {
    vi.mocked(DocumentService.updateTitle).mockRejectedValueOnce(new Error('offline'));
    vi.mocked(CloudSyncService.addLocalCopy).mockRejectedValueOnce(new Error('cannot reach cloud to read document either'));

    await expect(
      updateArchiveField(makeSession(), 'title', 'Fail Title', mockUser, 'user1')
    ).rejects.toThrow('cannot reach cloud to read document either');
  });

  it('does nothing if user is null (no cloud, no fallback)', async () => {
    const result = await updateArchiveField(
      makeSession(),
      'tags', ['t1'], null, 'user1'
    );
    expect(result).toEqual({ success: true });
    expect(DocumentService.updateTags).not.toHaveBeenCalled();
    expect(CloudSyncService.addLocalCopy).not.toHaveBeenCalled();
  });
});

describe('deleteArchiveSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('local → StorageService.deleteDocument with localId', async () => {
    const { StorageService } = await import('../../../../core/services/StorageService');
    await deleteArchiveSession(makeSession({ _isLocal: true, _hasCloudCopy: false }), 'user1');
    expect(StorageService.deleteDocument).toHaveBeenCalledWith('user1', 's1', undefined);
  });

  it('cloud → StorageService.deleteDocument with cloudId', async () => {
    const { StorageService } = await import('../../../../core/services/StorageService');
    await deleteArchiveSession(makeSession({ _isLocal: false, _hasCloudCopy: true, _linkedCloudId: 'cloud1' }), 'user1');
    expect(StorageService.deleteDocument).toHaveBeenCalledWith('user1', undefined, 'cloud1');
  });

  it('local with cloud copy → StorageService.deleteDocument with both ids', async () => {
    const { StorageService } = await import('../../../../core/services/StorageService');
    await deleteArchiveSession(makeSession({ _isLocal: true, _hasCloudCopy: true, _linkedCloudId: 'cloud1' }), 'user1');
    expect(StorageService.deleteDocument).toHaveBeenCalledWith('user1', 's1', 'cloud1');
  });
});
