import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteSession } from '../SessionDeleteService';
import { Session } from '../../../../types';

vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: {
    deleteDocument: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../../core/services/SessionService', () => ({
  SessionService: {
    deleteSession: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: {
    getDocument: vi.fn().mockResolvedValue(undefined),
  },
}));

import { StorageService } from '../../../../core/services/StorageService';
import { SessionService } from '../../../../core/services/SessionService';
import { LocalDocumentService } from '../../../../core/services/LocalDocumentService';

const mockStorageService = vi.mocked(StorageService);
const mockSessionService = vi.mocked(SessionService);
const mockLocalDocumentService = vi.mocked(LocalDocumentService);

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session_123',
    userId: 'user_123',
    content: 'test content',
    title: 'Test Session',
    wordCount: 10,
    charCount: 50,
    duration: 300,
    wpm: 30,
    tags: [],
    createdAt: new Date(),
    ...overrides,
  };
}

describe('SessionDeleteService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls StorageService.deleteDocument with correct args for local session', async () => {
    const session = createSession({ _isLocal: true, id: 'local_1' });
    mockLocalDocumentService.getDocument.mockResolvedValueOnce({ linkedCloudId: 'cloud_1' } as any);

    await deleteSession('user_123', session);

    expect(mockStorageService.deleteDocument).toHaveBeenCalledWith('user_123', 'local_1', 'cloud_1');
  });

  it('calls StorageService.deleteDocument with localId undefined and cloudId for cloud session', async () => {
    const session = createSession({ id: 'cloud_session_1' });

    await deleteSession('user_123', session);

    expect(mockStorageService.deleteDocument).toHaveBeenCalledWith('user_123', undefined, 'cloud_session_1');
  });

  it('calls SessionService.deleteSession for legacy session', async () => {
    const session = createSession({ id: 'legacy_1', _isLegacy: true } as any);

    await deleteSession('user_123', session);

    expect(mockSessionService.deleteSession).toHaveBeenCalledWith('legacy_1');
    expect(mockStorageService.deleteDocument).not.toHaveBeenCalled();
  });

  it('handles error gracefully and reports it', async () => {
    const session = createSession({ id: 'cloud_err' });
    const reportErrorSpy = vi.spyOn(await import('../../../../core/errors/reportError'), 'reportError').mockImplementation(() => {});
    mockStorageService.deleteDocument.mockRejectedValueOnce(new Error('Delete failed'));

    await expect(deleteSession('user_123', session)).rejects.toThrow('Delete failed');

    reportErrorSpy.mockRestore();
  });
});
