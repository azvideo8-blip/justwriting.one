import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveGuestDraftToStorage, loadGuestDraftFromStorage, deleteGuestDraftFromStorage } from '../GuestDraftService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { reportError } from '../../../../shared/errors/reportError';

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn(),
  LocalDraft: {} as unknown,
}));

vi.mock('../../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

vi.mock('../../../../shared/constants/storageKeys', () => ({
  STORAGE_KEYS: {
    GUEST_DRAFT: 'jw_guest_draft',
  },
}));

function mockDb(overrides: Record<string, unknown> = {}) {
  const db = {
    objectStoreNames: {
      contains: vi.fn(() => true),
    } as unknown as DOMStringList,
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof getLocalDb>>;
  vi.mocked(getLocalDb).mockResolvedValue(db);
  return db;
}

describe('saveGuestDraftToStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('saves to IDB and localStorage when both succeed', async () => {
    const db = mockDb();
    const draft = { content: 'hello', title: 'Test' };
    await saveGuestDraftToStorage(draft);
    expect(db.put).toHaveBeenCalled();
    expect(localStorage.getItem('jw_guest_draft')).not.toBeNull();
  });

  it('throws when both IDB and localStorage fail', async () => {
    mockDb({
      objectStoreNames: { contains: vi.fn(() => false) } as unknown as DOMStringList,
      put: vi.fn().mockRejectedValue(new Error('idb fail')),
    });
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    await expect(saveGuestDraftToStorage({ content: 'x' })).rejects.toThrow('GUEST_DRAFT_SAVE_FAILED');
    setItemSpy.mockRestore();
  });

  it('succeeds if only localStorage works', async () => {
    mockDb({
      objectStoreNames: { contains: vi.fn(() => false) } as unknown as DOMStringList,
    });
    const draft = { content: 'hello' };
    await saveGuestDraftToStorage(draft);
    expect(localStorage.getItem('jw_guest_draft')).not.toBeNull();
  });
});

describe('loadGuestDraftFromStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('returns IDB draft when IDB is newer', async () => {
    const idbDraft = { content: 'idb', updatedAt: 2000 };
    mockDb({ get: vi.fn().mockResolvedValue({ ...idbDraft, userId: 'guest_draft' }) });
    localStorage.setItem('jw_guest_draft', JSON.stringify({ content: 'ls', updatedAt: 1000 }));
    const result = await loadGuestDraftFromStorage();
    expect(result).toEqual(expect.objectContaining({ content: 'idb' }));
  });

  it('returns localStorage draft when LS is newer and syncs back to IDB', async () => {
    const lsDraft = { content: 'ls', updatedAt: 3000 };
    const db = mockDb({ get: vi.fn().mockResolvedValue({ content: 'idb', updatedAt: 2000, userId: 'guest_draft' }) });
    localStorage.setItem('jw_guest_draft', JSON.stringify(lsDraft));
    const result = await loadGuestDraftFromStorage();
    expect(result).toEqual(expect.objectContaining({ content: 'ls' }));
    expect(db.put).toHaveBeenCalledWith(
      'drafts',
      expect.objectContaining({ content: 'ls', userId: 'guest_draft' })
    );
  });

  it('restores localStorage draft to IDB when IDB is missing', async () => {
    const lsDraft = { content: 'ls', updatedAt: 1000 };
    const db = mockDb({ get: vi.fn().mockResolvedValue(undefined) });
    localStorage.setItem('jw_guest_draft', JSON.stringify(lsDraft));
    const result = await loadGuestDraftFromStorage();
    expect(result).toEqual(expect.objectContaining({ content: 'ls' }));
    expect(db.put).toHaveBeenCalledWith(
      'drafts',
      expect.objectContaining({ content: 'ls', userId: 'guest_draft' })
    );
  });

  it('returns IDB draft when localStorage is missing', async () => {
    const idbDraft = { content: 'idb', updatedAt: 1000 };
    mockDb({ get: vi.fn().mockResolvedValue({ ...idbDraft, userId: 'guest_draft' }) });
    const result = await loadGuestDraftFromStorage();
    expect(result).toEqual(expect.objectContaining({ content: 'idb' }));
  });

  it('returns null when both stores are empty', async () => {
    mockDb({ get: vi.fn().mockResolvedValue(undefined) });
    const result = await loadGuestDraftFromStorage();
    expect(result).toBeNull();
  });

  it('clears localStorage on JSON parse error', async () => {
    mockDb();
    localStorage.setItem('jw_guest_draft', 'not-json');
    const result = await loadGuestDraftFromStorage();
    expect(result).toBeNull();
    expect(localStorage.getItem('jw_guest_draft')).toBeNull();
  });
});

describe('deleteGuestDraftFromStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('removes from localStorage and IDB', async () => {
    const db = mockDb();
    localStorage.setItem('jw_guest_draft', JSON.stringify({ content: 'x' }));
    await deleteGuestDraftFromStorage();
    expect(localStorage.getItem('jw_guest_draft')).toBeNull();
    expect(db.delete).toHaveBeenCalledWith('drafts', 'guest_draft');
  });

  it('reports errors but does not throw', async () => {
    mockDb({
      objectStoreNames: { contains: vi.fn(() => true) } as unknown as DOMStringList,
      delete: vi.fn().mockRejectedValue(new Error('idb error')),
    });
    await expect(deleteGuestDraftFromStorage()).resolves.toBeUndefined();
    expect(reportError).toHaveBeenCalled();
  });
});
