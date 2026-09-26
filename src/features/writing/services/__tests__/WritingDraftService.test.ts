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
    vi.resetAllMocks();
    vi.mocked(DataProvider.saveDraft).mockResolvedValue(undefined);
    vi.mocked(DataProvider.getDraft).mockResolvedValue(null);
    vi.mocked(DataProvider.deleteDraft).mockResolvedValue(undefined);
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('user_123'), 'true'); // D-22: эти тесты проверяют облачную запись
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('user_unchanged'), 'true'); // D-22: эти тесты проверяют облачную запись
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('user_retyped'), 'true'); // D-22: эти тесты проверяют облачную запись
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('user_gen_test'), 'true'); // D-22: эти тесты проверяют облачную запись
    sessionStorage.clear();
  });

  describe('loadDraft', () => {
    it('returns null when nothing found', async () => {
      makeLocalDb();
      const draft = await WritingDraftService.loadDraft(mockUserId);
      expect(getLocalDb).toHaveBeenCalledWith(mockUserId);
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

    it('picks local draft when newer by more than 60s', async () => {
      const now = Date.now();
      const localDraft = { userId: mockUserId, content: 'local', updatedAt: now, wordCount: 50 };
      const cloudDraft = { userId: mockUserId, content: 'cloud', updatedAt: now - 120_000, wordCount: 50 };
      makeLocalDb({ get: vi.fn().mockResolvedValue(localDraft) });
            vi.mocked(DataProvider.getDraft).mockResolvedValue(cloudDraft);
      vi.mocked(maybeDecrypt).mockResolvedValue(cloudDraft);
      const draft = await WritingDraftService.loadDraft(mockUserId);
      expect(draft).toEqual(localDraft);
    });

    it('picks draft with higher wordCount when timestamps within 60s', async () => {
      const now = Date.now();
      const localDraft = { userId: mockUserId, content: 'local', updatedAt: now, wordCount: 50 };
      const cloudDraft = { userId: mockUserId, content: 'cloud', updatedAt: now + 10_000, wordCount: 100 };
      makeLocalDb({ get: vi.fn().mockResolvedValue(localDraft) });
            vi.mocked(DataProvider.getDraft).mockResolvedValue(cloudDraft);
      vi.mocked(maybeDecrypt).mockResolvedValue(cloudDraft);
      const draft = await WritingDraftService.loadDraft(mockUserId);
      expect(draft).toEqual(cloudDraft);
    });

    it('deletes draft and returns null if sessionStorage says deleted after draft updatedAt', async () => {
      const now = Date.now();
      const localDraft = { userId: mockUserId, content: 'local', updatedAt: now, wordCount: 50 };
      makeLocalDb({ get: vi.fn().mockResolvedValue(localDraft), delete: vi.fn().mockResolvedValue(undefined) });
            sessionStorage.setItem(STORAGE_KEYS.DRAFT_DELETED(mockUserId), String(now + 1000));
      const draft = await WritingDraftService.loadDraft(mockUserId);
      expect(draft).toBeNull();
    });

    it('deletes draft and returns null if draft is expired', async () => {
      const oldDraft = { userId: mockUserId, content: 'old', updatedAt: 1, wordCount: 50 };
      makeLocalDb({ get: vi.fn().mockResolvedValue(oldDraft), delete: vi.fn().mockResolvedValue(undefined) });
            const draft = await WritingDraftService.loadDraft(mockUserId);
      expect(draft).toBeNull();
    });

    it('falls back to legacy localStorage if IDB has no drafts store', async () => {
      const now = Date.now();
      const legacyDraft = { content: 'legacy', title: 'Legacy', updatedAt: now };
      localStorage.setItem(STORAGE_KEYS.DRAFT(mockUserId), JSON.stringify(legacyDraft));
      makeLocalDb({ objectStoreNames: { contains: vi.fn(() => false) } as unknown as DOMStringList });
            const draft = await WritingDraftService.loadDraft(mockUserId);
      expect(draft).toEqual(expect.objectContaining({ content: 'legacy', title: 'Legacy', userId: mockUserId }));
    });

    it('reports error and does not overwrite local storage if local IDB read fails', async () => {
      const db = makeLocalDb({
        get: vi.fn().mockRejectedValue(new Error('IDB read error')),
        put: vi.fn(),
      });
      const cloudDraft = { userId: mockUserId, content: 'cloud text', updatedAt: Date.now(), wordCount: 10 };
      vi.mocked(DataProvider.getDraft).mockResolvedValue(cloudDraft);
      vi.mocked(maybeDecrypt).mockResolvedValue(cloudDraft);

      const draft = await WritingDraftService.loadDraft(mockUserId);

      expect(draft).toEqual(cloudDraft);
      expect(reportError).toHaveBeenCalledWith(
        expect.any(Error),
        { action: 'loadDraft_local_failed', userId: mockUserId }
      );
      expect(db.put).not.toHaveBeenCalled();
    });
  });

  describe('clearLegacyDraft', () => {
    it('removes legacy localStorage key', async () => {
      localStorage.setItem(STORAGE_KEYS.DRAFT(mockUserId), JSON.stringify({ content: 'x' }));
      await WritingDraftService.clearLegacyDraft(mockUserId);
      expect(localStorage.getItem(STORAGE_KEYS.DRAFT(mockUserId))).toBeNull();
    });
  });

  describe('saveToLocal', () => {
    it('puts draft into localDb', async () => {
      const db = makeLocalDb();
      const draft = { userId: mockUserId, content: 'test', updatedAt: 1000 } as unknown as LocalDraft;
      await WritingDraftService.saveToLocal(draft);
      expect(db.put).toHaveBeenCalledWith('drafts', draft);
    });

    it('D-1: re-throws IDB error so persistDraft sees rejected (not false-positive fulfilled)', async () => {
      makeLocalDb({ put: vi.fn().mockRejectedValue(new Error('IDB quota exceeded')) });
      const draft = { userId: mockUserId, content: 'test', updatedAt: 1000 } as unknown as LocalDraft;
      await expect(WritingDraftService.saveToLocal(draft)).rejects.toThrow('IDB quota exceeded');
      expect(reportError).toHaveBeenCalled();
    });
  });

  describe('saveDraftToCloud', () => {
    it('does nothing if no userId', async () => {
            const wrote = await WritingDraftService.saveDraftToCloud({ userId: '', content: '', updatedAt: 0 } as unknown as LocalDraft);
      expect(DataProvider.saveDraft).not.toHaveBeenCalled();
      // Reports "did not write" so the caller can't record a stale cloud copy
      // as a successful save.
      expect(wrote).toBe(false);
    });

    it('does nothing if profile not loaded', async () => {
      vi.mocked(isProfileLoaded).mockReturnValue(false);
            const wrote = await WritingDraftService.saveDraftToCloud({ userId: mockUserId, content: '', updatedAt: 0 } as unknown as LocalDraft);
      expect(DataProvider.saveDraft).not.toHaveBeenCalled();
      expect(wrote).toBe(false);
    });

    it('aborts previous controller and writes to firestore with full document overwrite (no merge: true)', async () => {
      vi.mocked(isProfileLoaded).mockReturnValue(true);
            vi.mocked(maybeEncrypt).mockResolvedValue({ content: 'enc', userId: mockUserId, title: 'T' });
      const draft = { userId: mockUserId, content: 'hello', title: 'T', updatedAt: 1000 };
      await WritingDraftService.saveDraftToCloud(draft as unknown as LocalDraft);
      expect(DataProvider.saveDraft).toHaveBeenCalledWith(
        mockUserId,
        expect.objectContaining({ content: 'enc', title: 'T' })
      );
                });

    it('rethrows the original error if setDoc fails and signal is not aborted', async () => {
      vi.mocked(isProfileLoaded).mockReturnValue(true);
            const original = Object.assign(new Error('denied'), { code: 'permission-denied' });
      vi.mocked(DataProvider.saveDraft).mockRejectedValue(original);
      const draft = { userId: mockUserId, content: 'hello', updatedAt: 1000 };
      // The error must survive intact: the caller classifies permanent vs
      // transient failures by `code`, which the old generic wrapper discarded.
      await expect(WritingDraftService.saveDraftToCloud(draft as unknown as LocalDraft)).rejects.toBe(original);
    });

    it('skips the write when nothing but the clock changed', async () => {
      vi.mocked(isProfileLoaded).mockReturnValue(true);
            vi.mocked(maybeEncrypt).mockImplementation(async (d: Record<string, unknown>) => d);
      const uid = 'user_unchanged';
      const base = { userId: uid, content: 'hello', title: 'T', wordCount: 1 };

      await WritingDraftService.saveDraftToCloud({ ...base, seconds: 30, updatedAt: 1000 } as unknown as LocalDraft);
      expect(DataProvider.saveDraft).toHaveBeenCalledTimes(1);

      // The 30s cloud autosave firing again on an untouched draft: only the
      // elapsed counters moved, so this must not reach Firestore.
      const wrote = await WritingDraftService.saveDraftToCloud(
        { ...base, seconds: 60, totalPauseSeconds: 12, updatedAt: 31_000 } as unknown as LocalDraft
      );
      expect(DataProvider.saveDraft).toHaveBeenCalledTimes(1);
      // Still reported as current — the cloud copy is not stale.
      expect(wrote).toBe(true);

      await WritingDraftService.saveDraftToCloud(
        { ...base, content: 'hello world', seconds: 90, updatedAt: 61_000 } as unknown as LocalDraft
      );
      expect(DataProvider.saveDraft).toHaveBeenCalledTimes(2);
    });

    it('writes again after the draft is deleted and retyped identically', async () => {
      vi.mocked(isProfileLoaded).mockReturnValue(true);
      makeLocalDb();
            vi.mocked(maybeEncrypt).mockImplementation(async (d: Record<string, unknown>) => d);
      const uid = 'user_retyped';
      const draft = { userId: uid, content: 'again', updatedAt: 1000 } as unknown as LocalDraft;

      await WritingDraftService.saveDraftToCloud(draft);
      await WritingDraftService.deleteDraft(uid);
      await WritingDraftService.saveDraftToCloud(draft);
      expect(DataProvider.saveDraft).toHaveBeenCalledTimes(2);
    });

    it('skips write and returns false if generation changed before cloud save completes', async () => {
      vi.mocked(isProfileLoaded).mockReturnValue(true);
      const uid = 'user_gen_test';
      const draft = { userId: uid, content: 'in flight text', updatedAt: 1000 } as unknown as LocalDraft;

      let resolveSave!: () => void;
      const savePromise = new Promise<void>(r => { resolveSave = r; });
      vi.mocked(DataProvider.saveDraft).mockImplementation(() => savePromise);

      const genAtStart = WritingDraftService.getDraftGeneration(uid);
      const saveOp = WritingDraftService.saveDraftToCloud(draft, genAtStart);

      // Session ends while save is in flight
      WritingDraftService.bumpDraftGeneration(uid);

      resolveSave();
      const result = await saveOp;
      expect(result).toBe(false);
    });

    it('saveToLocal drops write if generation changed', async () => {
      const db = makeLocalDb();
      const uid = 'user_local_gen';
      const draft = { userId: uid, content: 'local text', updatedAt: 1000 } as unknown as LocalDraft;

      const genAtStart = WritingDraftService.getDraftGeneration(uid);
      // Bump generation before saveToLocal runs or completes
      WritingDraftService.bumpDraftGeneration(uid);

      await WritingDraftService.saveToLocal(draft, genAtStart);
      expect(db.put).not.toHaveBeenCalled();
    });

    it('DEEP-1: saveToLocal passes draft.userId to getLocalDb so partition never falls back to guest DB', async () => {
      makeLocalDb();
      const uid = 'user_cross_tab_signout';
      const draft = { userId: uid, content: 'private text', updatedAt: 1000 } as unknown as LocalDraft;

      await WritingDraftService.saveToLocal(draft);
      expect(getLocalDb).toHaveBeenCalledWith(uid);
    });

    it('DEEP-1: saveToLocal refuses to write when draft.userId is empty', async () => {
      const db = makeLocalDb();
      const draft = { userId: '', content: 'no owner', updatedAt: 1000 } as unknown as LocalDraft;

      await WritingDraftService.saveToLocal(draft);
      expect(db.put).not.toHaveBeenCalled();
    });
  });

  describe('deleteDraft', () => {
    it('does nothing if userId is empty', async () => {
      await WritingDraftService.deleteDraft('');
      expect(DataProvider.saveDraft).not.toHaveBeenCalled();
    });

    it('deletes from localDb, localStorage, and firestore', async () => {
      const db = makeLocalDb();
      await WritingDraftService.deleteDraft(mockUserId);
      expect(getLocalDb).toHaveBeenCalledWith(mockUserId);
      expect(db.delete).toHaveBeenCalledWith('drafts', mockUserId);
      expect(localStorage.getItem(STORAGE_KEYS.DRAFT(mockUserId))).toBeNull();
      expect(DataProvider.deleteDraft).toHaveBeenCalledWith(mockUserId);
    });

    it('reports errors but does not throw', async () => {
      makeLocalDb({
        delete: vi.fn().mockRejectedValue(new Error('idb error')),
      });
            vi.mocked(DataProvider.deleteDraft).mockRejectedValue(new Error('firestore error'));
      // N-54: не бросает, но сообщает, что локальный черновик не удалён.
      await expect(WritingDraftService.deleteDraft(mockUserId)).resolves.toBe(false);
      expect(reportError).toHaveBeenCalled();
    });
  });
});
