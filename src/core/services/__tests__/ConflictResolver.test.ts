import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictResolver } from '../ConflictResolver';
import { LocalStorageService } from '../LocalStorageService';
import { LocalVersionService } from '../LocalVersionService';
import { getLocalDb } from '../../storage/localDb';
import { reportError } from '../../../core/errors/reportError';

vi.mock('../LocalStorageService', () => ({
  LocalStorageService: {
    createDocument: vi.fn().mockResolvedValue('forked_doc_123'),
    updateAfterSession: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../LocalVersionService', () => ({
  LocalVersionService: {
    addVersion: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../storage/localDb', () => ({
  getLocalDb: vi.fn(),
}));

vi.mock('../../../core/errors/reportError', () => ({
  reportError: vi.fn(),
}));

function mockDb(overrides: Partial<Awaited<ReturnType<typeof getLocalDb>>> = {}) {
  const db = {
    put: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof getLocalDb>>;
  vi.mocked(getLocalDb).mockResolvedValue(db);
  return db;
}

describe('ConflictResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const dummyData = {
    title: 'My Story',
    content: 'Once upon a time...',
    tags: ['fiction'],
    labelId: 'label1',
    wordCount: 100,
    duration: 300,
    wpm: 20,
    sessionStartedAt: new Date(1700000000000),
    mood: 'focused',
  };

  it('creates a forked document and version', async () => {
    mockDb();
    const result = await ConflictResolver.resolveConflict(
      'user1',
      'doc_local',
      'doc_cloud',
      dummyData,
      5,
      { currentVersion: 3 }
    );
    expect(result).toEqual({ forked: true });
    expect(LocalStorageService.createDocument).toHaveBeenCalledWith('user1', expect.objectContaining({
      title: expect.stringContaining('Conflict'),
      tags: ['fiction'],
      labelId: 'label1',
    }));
    expect(LocalVersionService.addVersion).toHaveBeenCalledWith('user1', 'forked_doc_123', expect.objectContaining({
      content: 'Once upon a time...',
      wordCount: 100,
      versionNumber: 1,
    }));
    expect(LocalStorageService.updateAfterSession).toHaveBeenCalledWith('forked_doc_123', expect.objectContaining({
      totalWords: 100,
      totalDuration: 300,
      currentVersion: 1,
    }));
  });

  it('reports a warning about the conflict', async () => {
    mockDb();
    await ConflictResolver.resolveConflict('user1', 'doc_local', 'doc_cloud', dummyData, 5, { currentVersion: 3 });
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Sync conflict: document forked' }),
      expect.objectContaining({
        action: 'syncVersionToCloud_conflict',
        documentId: 'doc_local',
        linkedCloudId: 'doc_cloud',
      }),
      'warning'
    );
  });

  it('adds a syncQueue entry for the forked document', async () => {
    const db = mockDb();
    await ConflictResolver.resolveConflict('user1', 'doc_local', 'doc_cloud', dummyData, 5, { currentVersion: 3 });
    expect(db.put).toHaveBeenCalledWith(
      'syncQueue',
      expect.objectContaining({
        documentId: 'forked_doc_123',
        type: 'document',
      })
    );
  });
});
