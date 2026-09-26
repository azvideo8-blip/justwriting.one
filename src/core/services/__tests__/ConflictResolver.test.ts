import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictResolver } from '../ConflictResolver';
import { LocalStorageService } from '../LocalStorageService';
import { LocalVersionService } from '../LocalVersionService';
import { getLocalDb } from '../../storage/localDb';
import { reportError } from '../../../shared/errors/reportError';

vi.mock('../LocalStorageService', () => ({
  LocalStorageService: {
    createDocument: vi.fn().mockResolvedValue('forked_doc_123'),
    updateAfterSession: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../LocalVersionService', () => ({
  LocalVersionService: {
    addVersion: vi.fn().mockResolvedValue(undefined),
    getVersions: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../VersionService', () => ({
  VersionService: {
    getVersions: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../storage/localDb', () => ({
  getLocalDb: vi.fn(),
}));

vi.mock('../../sync/requeueDocumentTask', () => ({
  requeueDocumentTask: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

vi.mock('../../crypto/cryptoHelpers', async () => {
  const actual = await vi.importActual<typeof import('../../crypto/cryptoHelpers')>('../../crypto/cryptoHelpers');
  return {
    ...actual,
    maybeDecrypt: vi.fn().mockImplementation(async (data: unknown) => data),
  };
});

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
    expect(result.forked).toBe(true);
    expect(result.forkTitle).toBeDefined();
    expect(LocalStorageService.createDocument).toHaveBeenCalledWith('user1', expect.objectContaining({
      title: expect.stringContaining('(конфликт,'),
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
    }), 'user1');
  });

  it('R4-2: the fork totals are the whole note, not this session delta', async () => {
    mockDb();
    await ConflictResolver.resolveConflict('user1', 'doc_local', 'doc_cloud',
      { ...dummyData, wordCount: 12, duration: 60, documentWordCount: 900, documentDuration: 5400 }, 5, { currentVersion: 3 });
    expect(LocalStorageService.updateAfterSession).toHaveBeenCalledWith('forked_doc_123', expect.objectContaining({
      totalWords: 900,
      totalDuration: 5400,
    }), 'user1');
  });

  it('creates a forked document with English conflict title when language is en (D-18)', async () => {
    localStorage.setItem('app_language', 'en');
    try {
      mockDb();
      const result = await ConflictResolver.resolveConflict(
        'user1',
        'doc_local',
        'doc_cloud',
        dummyData,
        5,
        { currentVersion: 3 }
      );
      expect(result.forkTitle).toContain('(conflict,');
    } finally {
      localStorage.removeItem('app_language');
    }
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
    mockDb();
    const { requeueDocumentTask } = await import('../../sync/requeueDocumentTask');
    await ConflictResolver.resolveConflict('user1', 'doc_local', 'doc_cloud', dummyData, 5, { currentVersion: 3 });
    expect(requeueDocumentTask).toHaveBeenCalledWith('forked_doc_123', 'user1');
  });

  it('CHOKE-1: preserves local version in both fork and original when cloud version has DecryptionError', async () => {
    const { VersionService } = await import('../VersionService');
    const { maybeDecrypt, DecryptionError } = await import('../../crypto/cryptoHelpers');

    const localVersions = [
      { id: 'lv_1', version: 1, content: 'Version 1 content', sessionStartedAt: 1000 },
      { id: 'lv_2', version: 2, content: 'Version 2 local plaintext', sessionStartedAt: 2000 },
    ];
    vi.mocked(LocalVersionService.getVersions).mockImplementation(async () => localVersions as any);

    const cloudVersions = [
      { version: 1, content: 'Version 1 content' },
      { version: 2, content: 'enc:corrupt_or_unreadable' },
    ];
    vi.mocked(VersionService.getVersions).mockResolvedValue(cloudVersions as any);

    vi.mocked(maybeDecrypt).mockImplementation(async (cv: any) => {
      if (cv.version === 2) {
        throw new DecryptionError('content');
      }
      return cv;
    });

    const storeDelete = vi.fn();
    const mockTx = {
      store: { delete: storeDelete },
      done: Promise.resolve(),
    };
    mockDb({
      transaction: vi.fn().mockReturnValue(mockTx) as any,
      get: vi.fn().mockResolvedValue(null) as any,
    });

    await ConflictResolver.resolveConflict(
      'user1',
      'doc_local',
      'doc_cloud',
      dummyData,
      3,
      { currentVersion: 2 }
    );

    // 1. In original doc: local version 2 MUST NOT be deleted (comparableOrUnknown says unknown)
    expect(storeDelete).not.toHaveBeenCalledWith('lv_2');

    // 2. In forked doc: local version 2 MUST be copied to fork because cloud copy is unreadable
    expect(LocalVersionService.addVersion).toHaveBeenCalledWith(
      'user1',
      'forked_doc_123',
      expect.objectContaining({
        versionNumber: 1, // N2-6: форк нумеруется заново с 1
        content: 'Version 2 local plaintext',
      })
    );
  });

  it('NARROW-1: deletes local version from original document when version is absent from cloud', async () => {
    const { VersionService } = await import('../VersionService');

    const localVersions = [
      { id: 'lv_1', version: 1, content: 'Version 1 content', sessionStartedAt: 1000 },
      { id: 'lv_2', version: 2, content: 'Version 2 content', sessionStartedAt: 2000 },
      { id: 'lv_3', version: 3, content: 'Version 3 local content only', sessionStartedAt: 3000 },
    ];
    vi.mocked(LocalVersionService.getVersions).mockImplementation(async () => localVersions as any);

    // Cloud has only versions 1 and 2, but cloudDoc.currentVersion is 3
    const cloudVersions = [
      { version: 1, content: 'Version 1 content' },
      { version: 2, content: 'Version 2 content' },
    ];
    vi.mocked(VersionService.getVersions).mockResolvedValue(cloudVersions as any);

    const storeDelete = vi.fn();
    const mockTx = {
      store: { delete: storeDelete },
      done: Promise.resolve(),
    };
    mockDb({
      transaction: vi.fn().mockReturnValue(mockTx) as any,
      get: vi.fn().mockResolvedValue(null) as any,
    });

    await ConflictResolver.resolveConflict(
      'user1',
      'doc_local',
      'doc_cloud',
      dummyData,
      3,
      { currentVersion: 3 }
    );

    // Pass 1 copies lv_3 to fork
    expect(LocalVersionService.addVersion).toHaveBeenCalledWith(
      'user1',
      'forked_doc_123',
      expect.objectContaining({
        content: 'Version 3 local content only', // N2-6: номер в форке — свой, по порядку
      })
    );

    // Pass 2: In original doc, lv_3 MUST be deleted because it does not exist in cloud
    expect(storeDelete).toHaveBeenCalledWith('lv_3');
  });
});

