import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateArchiveField, deleteArchiveSession } from '../archiveCrud';
import { ArchiveSession } from '../../types';

vi.mock('../../../writing/services/DocumentService', () => ({
  DocumentService: {
    updateTags: vi.fn().mockResolvedValue(undefined),
    updateTitle: vi.fn().mockResolvedValue(undefined),
    updateDate: vi.fn().mockResolvedValue(undefined),
    updateLabelId: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../writing/services/LocalDocumentService', () => ({
  LocalDocumentService: {
    updateTags: vi.fn().mockResolvedValue(undefined),
    updateTitle: vi.fn().mockResolvedValue(undefined),
    updateDate: vi.fn().mockResolvedValue(undefined),
    updateLabelId: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../writing/services/SessionService', () => ({
  SessionService: {
    updateSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../writing/services/StorageService', () => ({
  StorageService: {
    deleteDocument: vi.fn().mockResolvedValue(undefined),
  },
}));

import { SessionService } from '../../../writing/services/SessionService';
import { LocalDocumentService } from '../../../writing/services/LocalDocumentService';
import { DocumentService } from '../../../writing/services/DocumentService';

const mockUser = { uid: 'user1' } as any;

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

describe('updateArchiveField — legacy session', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tags → SessionService.updateSession({ tags })', async () => {
    await updateArchiveField(makeSession({ _isLegacy: true }), 'tags', ['t1'], mockUser, 'user1');
    expect(SessionService.updateSession).toHaveBeenCalledWith('s1', { tags: ['t1'] });
  });

  it('title → SessionService.updateSession({ title })', async () => {
    await updateArchiveField(makeSession({ _isLegacy: true }), 'title', 'New Title', mockUser, 'user1');
    expect(SessionService.updateSession).toHaveBeenCalledWith('s1', { title: 'New Title' });
  });

  it('date → SessionService.updateSession({ sessionStartTime })', async () => {
    const d = new Date('2024-06-15T10:30:00');
    await updateArchiveField(makeSession({ _isLegacy: true }), 'date', d, mockUser, 'user1');
    expect(SessionService.updateSession).toHaveBeenCalledWith('s1', { sessionStartTime: d.getTime() });
  });

  it('labelId → SessionService.updateSession({ labelId })', async () => {
    await updateArchiveField(makeSession({ _isLegacy: true }), 'labelId', 'lbl1', mockUser, 'user1');
    expect(SessionService.updateSession).toHaveBeenCalledWith('s1', { labelId: 'lbl1' });
  });
});

describe('updateArchiveField — local session', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tags → LocalDocumentService.updateTags', async () => {
    await updateArchiveField(makeSession({ _isLocal: true }), 'tags', ['t1'], mockUser, 'user1');
    expect(LocalDocumentService.updateTags).toHaveBeenCalledWith('s1', ['t1']);
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
});

describe('updateArchiveField — cloud-only session', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tags → DocumentService.updateTags', async () => {
    await updateArchiveField(makeSession(), 'tags', ['t1'], mockUser, 'user1');
    expect(DocumentService.updateTags).toHaveBeenCalledWith('user1', 's1', ['t1']);
  });

  it('does nothing if user is null', async () => {
    await updateArchiveField(makeSession(), 'tags', ['t1'], null, 'user1');
    expect(DocumentService.updateTags).not.toHaveBeenCalled();
  });
});

describe('deleteArchiveSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('legacy → SessionService.deleteSession', async () => {
    await deleteArchiveSession(makeSession({ _isLegacy: true }), 'user1');
    expect(SessionService.deleteSession).toHaveBeenCalledWith('s1');
  });

  it('local → StorageService.deleteDocument with localId', async () => {
    const { StorageService } = await import('../../../writing/services/StorageService');
    await deleteArchiveSession(makeSession({ _isLocal: true, _hasCloudCopy: false }), 'user1');
    expect(StorageService.deleteDocument).toHaveBeenCalledWith('user1', 's1', undefined);
  });

  it('cloud → StorageService.deleteDocument with cloudId', async () => {
    const { StorageService } = await import('../../../writing/services/StorageService');
    await deleteArchiveSession(makeSession({ _isLocal: false, _hasCloudCopy: true, _linkedCloudId: 'cloud1' }), 'user1');
    expect(StorageService.deleteDocument).toHaveBeenCalledWith('user1', undefined, 'cloud1');
  });
});
