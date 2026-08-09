import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WritingDraftService } from '../WritingDraftService';
import { getLocalDb, LocalDraft } from '../../../../core/storage/localDb';
import { DataProvider } from '../../../../core/data';
import { maybeEncrypt, maybeDecrypt, isProfileLoaded } from '../../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../../shared/errors/reportError';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn(),
}));

vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: vi.fn(),
    saveDraft: vi.fn(),
    deleteDraft: vi.fn(),
  }
}));

vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  maybeEncrypt: vi.fn(async (doc: Record<string, unknown>) => doc),
  maybeDecrypt: vi.fn(async (doc: Record<string, unknown>) => doc),
  isProfileLoaded: vi.fn(() => true),
}));

vi.mock('../../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

vi.mock('../../../../core/utils/dateUtils', () => ({
  toTimestampMs: (v: unknown) => (typeof v === 'number' ? v : null),
}));

const mockUserId = 'user_123';

function makeLocalDb(overrides: Record<string, unknown> = {}) {
  const db = {
    objectStoreNames: {
      contains: vi.fn(() => true),
    } as unknown as DOMStringList,
    get: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof getLocalDb>>;
  vi.mocked(getLocalDb).mockResolvedValue(db);
  return db;
}

describe('WritingDraftService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('loadDraft', () => {
    it('returns null when nothing found', async () => {
      makeLocalDb();
      const draft = await WritingDraftService.loadDraft(mockUserId);
      expect(draft).toBeNull();
    });

    it('returns local draft when no cloud draft', async () => {
      const now = Date.now();
      const localDraft = { userId: mockUserId, content: 'local', updatedAt: now, wordCount: 50 };
      makeLocalDb({ get: vi.fn().mockResolvedValue(localDraft) });
      const draft = await WritingDraftService.loadDraft(mockUserId);
      expect(draft).toEqual(localDraft);
    });

    it('returns cloud draft when no local draft', async () => {
      const now = Date.now();
      const cloudDraft = { userId: mockUserId, content: 'cloud', updatedAt: now, wordCount: 50 };
      vi.mocked(DataProvider.getDraft).mockResolvedValue(cloudDraft);
      vi.mocked(maybeDecrypt).mockResolvedValue(cloudDraft);
      makeLocalDb();
      const draft = await WritingDraftService.loadDraft(mockUserId);
      expect(draft).toEqual(cloudDraft);
    });
  });

  describe('deleteDraft', () => {
    it('deletes from localDb, localStorage, and cloud', async () => {
      const db = makeLocalDb();
      await WritingDraftService.deleteDraft(mockUserId);
      expect(db.delete).toHaveBeenCalledWith('drafts', mockUserId);
      expect(localStorage.getItem(STORAGE_KEYS.DRAFT(mockUserId))).toBeNull();
      expect(DataProvider.deleteDraft).toHaveBeenCalledWith(mockUserId);
    });
  });
});
