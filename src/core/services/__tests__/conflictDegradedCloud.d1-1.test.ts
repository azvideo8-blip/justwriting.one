import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictResolver } from '../ConflictResolver';
import { LocalVersionService } from '../LocalVersionService';
import { VersionService } from '../VersionService';
import { getLocalDb } from '../../storage/localDb';

vi.mock('../LocalStorageService', () => ({
  LocalStorageService: {
    createDocument: vi.fn().mockResolvedValue('forked_doc_d1_1'),
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

const UID = 'user_d1_1';
const LOCAL_DOC = 'doc_local_d1_1';
const CLOUD_DOC = 'doc_cloud_d1_1';
const MARKER = 'MARKER_D1_TEXT';

function mockDb() {
  const storeDelete = vi.fn();
  const db = {
    transaction: vi.fn().mockReturnValue({ store: { delete: storeDelete }, done: Promise.resolve() }),
    get: vi.fn().mockResolvedValue(null),
  };
  vi.mocked(getLocalDb).mockResolvedValue(db as never);
  return { db, storeDelete };
}

const edit = {
  title: 'Черновик',
  content: MARKER,
  tags: [],
  wordCount: 1,
  duration: 10,
  wpm: 6,
  sessionStartedAt: new Date(1700000000000),
};

describe('D1-1: нечитаемая облачная версия не уносит локальный текст', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(LocalVersionService.getVersions).mockResolvedValue([]);
    vi.mocked(VersionService.getVersions).mockResolvedValue([]);
  });

  it('версия с _degraded и пустым content: локальный текст остаётся в форке', async () => {
    mockDb();
    vi.mocked(LocalVersionService.getVersions).mockResolvedValue([
      { id: 'lv_1', version: 1, content: 'старая версия', sessionStartedAt: 1000 },
      { id: 'lv_2', version: 2, content: MARKER, sessionStartedAt: 2000 },
    ] as never);
    vi.mocked(VersionService.getVersions).mockResolvedValue([
      { version: 1, content: 'старая версия', wordCount: 2, duration: 10, wpm: 12 },
      { version: 2, content: '', wordCount: 0, duration: 0, wpm: 0, _degraded: true },
    ] as never);

    await ConflictResolver.resolveConflict(UID, LOCAL_DOC, CLOUD_DOC, edit, 2, { currentVersion: 2 });

    const forkTexts = vi.mocked(LocalVersionService.addVersion).mock.calls
      .filter(([, docId]) => docId === 'forked_doc_d1_1')
      .map(([, , payload]) => (payload as { content: string }).content);
    expect(forkTexts).toContain(MARKER);
  });

  it('не-строковый content после расшифровки: локальный текст остаётся в форке', async () => {
    mockDb();
    vi.mocked(LocalVersionService.getVersions).mockResolvedValue([
      { id: 'lv_1', version: 1, content: MARKER, sessionStartedAt: 1000 },
    ] as never);
    vi.mocked(VersionService.getVersions).mockResolvedValue([
      { version: 1, content: 42, wordCount: 2, duration: 10, wpm: 12 },
    ] as never);

    await ConflictResolver.resolveConflict(UID, LOCAL_DOC, CLOUD_DOC, edit, 1, { currentVersion: 1 });

    const forkTexts = vi.mocked(LocalVersionService.addVersion).mock.calls
      .filter(([, docId]) => docId === 'forked_doc_d1_1')
      .map(([, , payload]) => (payload as { content: string }).content);
    expect(forkTexts).toContain(MARKER);
  });
});
