import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WritingDraftService } from '../WritingDraftService';
import { getLocalDb, LocalDraft } from '../../../../core/storage/localDb';
import { getClient } from '../../../../core/firebase/firestoreClient';
import { maybeEncrypt, maybeDecrypt, isProfileLoaded } from '../../../../core/crypto/cryptoHelpers';
import { reportError } from '../../../../shared/errors/reportError';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn(),
}));

vi.mock('../../../../core/firebase/firestoreClient', () => ({
  getClient: vi.fn(),
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

function makeFirestoreClient(overrides: Record<string, unknown> = {}) {
  const docRef = { id: mockUserId };
  const getDoc = vi.fn().mockResolvedValue({ exists: () => false, data: () => undefined });
  const setDoc = vi.fn().mockResolvedValue(undefined);
  const deleteDoc = vi.fn().mockResolvedValue(undefined);
  const serverTimestamp = vi.fn(() => ({ seconds: Date.now() / 1000, nanoseconds: 0 }));
  const doc = vi.fn(() => docRef);

  vi.mocked(getClient).mockResolvedValue({
    db: {} as unknown,
    mod: {
      doc,
      getDoc,
      setDoc,
      deleteDoc,
      serverTimestamp,
      ...overrides,
    },
  } as unknown as Awaited<ReturnType<typeof getClient>>);

  return { doc, getDoc, setDoc, deleteDoc, serverTimestamp, docRef };
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
      makeFirestoreClient();
      const draft = await WritingDraftService.loadDraft(mockUserId);
      expect(draft).toBeNull();
    });

    it('returns local draft when no cloud draft', async () => {
      const now = Date.now();
      const localDraft = { userId: mockUserId, content: 'local', updatedAt: now, wordCount: 50 };
      makeLocalDb({ get: vi.fn().mockResolvedValue(localDraft) });
      makeFirestoreClient();
      const draft = await WritingDraftService.loadDraft(mockUserId);
      expect(draft).toEqual(localDraft);
    });

    it('returns cloud draft when no local draft', async () => {
      const now = Date.now();
      const cloudDraft = { userId: mockUserId, content: 'cloud', updatedAt: now, wordCount: 50 };
      const { getDoc } = makeFirestoreClient();
      vi.mocked(getDoc).mockResolvedValue({
        exists: () => true,
        data: () => cloudDraft,
      } as unknown);
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
      const { getDoc } = makeFirestoreClient();
      vi.mocked(getDoc).mockResolvedValue({
        exists: () => true,
        data: () => cloudDraft,
      } as unknown);
      vi.mocked(maybeDecrypt).mockResolvedValue(cloudDraft);
      const draft = await WritingDraftService.loadDraft(mockUserId);
      expect(draft).toEqual(localDraft);
    });

    it('picks draft with higher wordCount when timestamps within 60s', async () => {
      const now = Date.now();
      const localDraft = { userId: mockUserId, content: 'local', updatedAt: now, wordCount: 50 };
      const cloudDraft = { userId: mockUserId, content: 'cloud', updatedAt: now + 10_000, wordCount: 100 };
      makeLocalDb({ get: vi.fn().mockResolvedValue(localDraft) });
      const { getDoc } = makeFirestoreClient();
      vi.mocked(getDoc).mockResolvedValue({
        exists: () => true,
        data: () => cloudDraft,
      } as unknown);
      vi.mocked(maybeDecrypt).mockResolvedValue(cloudDraft);
      const draft = await WritingDraftService.loadDraft(mockUserId);
      expect(draft).toEqual(cloudDraft);
    });

    it('deletes draft and returns null if sessionStorage says deleted after draft updatedAt', async () => {
      const now = Date.now();
      const localDraft = { userId: mockUserId, content: 'local', updatedAt: now, wordCount: 50 };
      makeLocalDb({ get: vi.fn().mockResolvedValue(localDraft), delete: vi.fn().mockResolvedValue(undefined) });
      makeFirestoreClient();
      sessionStorage.setItem(STORAGE_KEYS.DRAFT_DELETED(mockUserId), String(now + 1000));
      const draft = await WritingDraftService.loadDraft(mockUserId);
      expect(draft).toBeNull();
    });

    it('deletes draft and returns null if draft is expired', async () => {
      const oldDraft = { userId: mockUserId, content: 'old', updatedAt: 1, wordCount: 50 };
      makeLocalDb({ get: vi.fn().mockResolvedValue(oldDraft), delete: vi.fn().mockResolvedValue(undefined) });
      makeFirestoreClient();
      const draft = await WritingDraftService.loadDraft(mockUserId);
      expect(draft).toBeNull();
    });

    it('falls back to legacy localStorage if IDB has no drafts store', async () => {
      const now = Date.now();
      const legacyDraft = { content: 'legacy', title: 'Legacy', updatedAt: now };
      localStorage.setItem(STORAGE_KEYS.DRAFT(mockUserId), JSON.stringify(legacyDraft));
      makeLocalDb({ objectStoreNames: { contains: vi.fn(() => false) } as unknown as DOMStringList });
      makeFirestoreClient();
      const draft = await WritingDraftService.loadDraft(mockUserId);
      expect(draft).toEqual(expect.objectContaining({ content: 'legacy', title: 'Legacy', userId: mockUserId }));
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
  });

  describe('saveToFirestore', () => {
    it('does nothing if no userId', async () => {
      makeFirestoreClient();
      await WritingDraftService.saveToFirestore({ userId: '', content: '', updatedAt: 0 } as unknown as LocalDraft);
      expect(vi.mocked(getClient)).not.toHaveBeenCalled();
    });

    it('does nothing if profile not loaded', async () => {
      vi.mocked(isProfileLoaded).mockReturnValue(false);
      makeFirestoreClient();
      await WritingDraftService.saveToFirestore({ userId: mockUserId, content: '', updatedAt: 0 } as unknown as LocalDraft);
      expect(vi.mocked(getClient)).not.toHaveBeenCalled();
    });

    it('aborts previous controller and writes to firestore', async () => {
      vi.mocked(isProfileLoaded).mockReturnValue(true);
      const { setDoc, serverTimestamp } = makeFirestoreClient();
      vi.mocked(maybeEncrypt).mockResolvedValue({ content: 'enc', userId: mockUserId, title: 'T' });
      const draft = { userId: mockUserId, content: 'hello', title: 'T', updatedAt: 1000 };
      await WritingDraftService.saveToFirestore(draft as unknown as LocalDraft);
      expect(setDoc).toHaveBeenCalled();
      expect(serverTimestamp).toHaveBeenCalled();
    });

    it('throws if setDoc fails and signal is not aborted', async () => {
      vi.mocked(isProfileLoaded).mockReturnValue(true);
      const { setDoc } = makeFirestoreClient();
      vi.mocked(setDoc).mockRejectedValue(new Error('network'));
      const draft = { userId: mockUserId, content: 'hello', updatedAt: 1000 };
      await expect(WritingDraftService.saveToFirestore(draft as unknown as LocalDraft)).rejects.toThrow('Draft save aborted');
    });

    it('does not throw if signal was aborted', async () => {
      vi.mocked(isProfileLoaded).mockReturnValue(true);
      makeFirestoreClient();
      // We can simulate abort by calling save twice quickly
      const draft = { userId: mockUserId, content: 'hello', updatedAt: 1000 };
      const p1 = WritingDraftService.saveToFirestore(draft as unknown as LocalDraft);
      const p2 = WritingDraftService.saveToFirestore(draft as unknown as LocalDraft);
      await expect(p2).resolves.toBeUndefined();
      // p1 either resolves early because of abort check, or completes before abort
      // either way it should not throw
      await expect(p1).resolves.toBeUndefined();
    });
  });

  describe('deleteDraft', () => {
    it('does nothing if userId is empty', async () => {
      await WritingDraftService.deleteDraft('');
      expect(vi.mocked(getClient)).not.toHaveBeenCalled();
    });

    it('deletes from localDb, localStorage, and firestore', async () => {
      const db = makeLocalDb();
      const { deleteDoc } = makeFirestoreClient();
      await WritingDraftService.deleteDraft(mockUserId);
      expect(db.delete).toHaveBeenCalledWith('drafts', mockUserId);
      expect(localStorage.getItem(STORAGE_KEYS.DRAFT(mockUserId))).toBeNull();
      expect(deleteDoc).toHaveBeenCalled();
    });

    it('reports errors but does not throw', async () => {
      makeLocalDb({
        delete: vi.fn().mockRejectedValue(new Error('idb error')),
      });
      const { deleteDoc } = makeFirestoreClient();
      vi.mocked(deleteDoc).mockRejectedValue(new Error('firestore error'));
      await expect(WritingDraftService.deleteDraft(mockUserId)).resolves.toBeUndefined();
      expect(reportError).toHaveBeenCalled();
    });
  });
});
