import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveGuestDraftToStorage } from '../GuestDraftService';
import { applyDelete, resolve } from '../draftWriter';
import { getLocalDb } from '../../../../core/storage/localDb';
import { reportError } from '../../../../shared/errors/reportError';
import { GUEST_DRAFT_TTL_MS, STORAGE_KEYS } from '../../../../shared/constants/storageKeys';

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn(),
  getOrCreateGuestId: () => 'guest_test_uid',
  LocalDraft: {} as unknown,
}));

vi.mock('../../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

const GUEST_UID = 'guest_test_uid';

function mockDb(overrides: Record<string, unknown> = {}) {
  // DW4-2: запись строки идёт через мутатор `applyWrite` (draftWriter), то есть
  // через `transaction('drafts', 'readwrite')`, а не прямой `put`.
  const get = vi.fn().mockResolvedValue(undefined);
  const put = vi.fn().mockResolvedValue(undefined);
  const db = {
    objectStoreNames: {
      contains: vi.fn(() => true),
    } as unknown as DOMStringList,
    get,
    put,
    delete: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(() => ({ store: { get, put }, done: Promise.resolve() })),
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
    await saveGuestDraftToStorage(draft, { uid: 'guest_fixture' });
    expect(db.put).toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT)).not.toBeNull();
  });

  it('throws when both IDB and localStorage fail', async () => {
    mockDb({
      objectStoreNames: { contains: vi.fn(() => false) } as unknown as DOMStringList,
      transaction: vi.fn(() => ({
        store: {
          get: vi.fn().mockResolvedValue(undefined),
          put: vi.fn().mockRejectedValue(new Error('idb fail')),
        },
        done: Promise.resolve(),
      })),
    });
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    await expect(saveGuestDraftToStorage({ content: 'x' }, { uid: 'guest_fixture' })).rejects.toThrow('GUEST_DRAFT_SAVE_FAILED');
    setItemSpy.mockRestore();
  });

  it('succeeds if only localStorage works', async () => {
    mockDb({
      objectStoreNames: { contains: vi.fn(() => false) } as unknown as DOMStringList,
    });
    const draft = { content: 'hello' };
    await saveGuestDraftToStorage(draft, { uid: 'guest_fixture' });
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT)).not.toBeNull();
  });
});

// Шаг 6 DW-4: гостевое чтение — `draftWriter.resolve` с `{ guest: true }`
// (прежний `loadGuestDraftFromStorage` был второй точкой чтения).
describe('resolve — гость', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('returns IDB draft when IDB is newer', async () => {
    const idbDraft = { content: 'idb', updatedAt: 2000 };
    mockDb({ get: vi.fn().mockResolvedValue({ ...idbDraft, userId: 'guest_draft' }) });
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify({ content: 'ls', updatedAt: 1000 }));
    const result = await resolve(GUEST_UID, { guest: true });
    expect(result).toEqual(expect.objectContaining({ content: 'idb' }));
  });

  it('returns localStorage draft when LS is newer and syncs back to IDB', async () => {
    const lsDraft = { content: 'ls', updatedAt: 3000, owner: GUEST_UID };
    const db = mockDb({ get: vi.fn().mockResolvedValue({ content: 'idb', updatedAt: 2000, userId: 'guest_draft' }) });
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify(lsDraft));
    const result = await resolve(GUEST_UID, { guest: true });
    expect(result).toEqual(expect.objectContaining({ content: 'ls' }));
    // Кэширование идёт через мутатор: `tx.store.put(строка)` с `userId` = ключ.
    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'ls', userId: 'guest_draft' })
    );
  });

  it('restores localStorage draft to IDB when IDB is missing', async () => {
    const lsDraft = { content: 'ls', updatedAt: 1000, owner: GUEST_UID };
    const db = mockDb({ get: vi.fn().mockResolvedValue(undefined) });
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify(lsDraft));
    const result = await resolve(GUEST_UID, { guest: true });
    expect(result).toEqual(expect.objectContaining({ content: 'ls' }));
    // Кэширование идёт через мутатор: `tx.store.put(строка)` с `userId` = ключ.
    expect(db.put).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'ls', userId: 'guest_draft' })
    );
  });

  // D12/D13 (шаг 6): срок вышел — гостевой черновик обязан исчезнуть из обоих
  // адресов, а не только перестать показываться.
  it('просроченный гостевой черновик стёрт из обоих адресов', async () => {
    const stale = { userId: 'guest_draft', owner: GUEST_UID, content: 'ГОСТЕВОЕ_ПРОСРОЧЕНО_D12', updatedAt: 1_700_000_000_000 };
    const db = mockDb({ get: vi.fn().mockResolvedValue(stale) });
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify(stale));
    const realNow = Date.now;
    Date.now = () => stale.updatedAt + GUEST_DRAFT_TTL_MS + 60_000;
    try {
      const result = await resolve(GUEST_UID, { guest: true });
      expect(result).toBeNull();
    } finally {
      Date.now = realNow;
    }
    expect(db.delete).toHaveBeenCalledWith('drafts', 'guest_draft');
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT)).toBeNull();
  });

  it('returns IDB draft when localStorage is missing', async () => {
    const idbDraft = { content: 'idb', updatedAt: 1000 };
    mockDb({ get: vi.fn().mockResolvedValue({ ...idbDraft, userId: 'guest_draft' }) });
    const result = await resolve(GUEST_UID, { guest: true });
    expect(result).toEqual(expect.objectContaining({ content: 'idb' }));
  });

  it('returns null when both stores are empty', async () => {
    mockDb({ get: vi.fn().mockResolvedValue(undefined) });
    const result = await resolve(GUEST_UID, { guest: true });
    expect(result).toBeNull();
  });

  it('clears localStorage on JSON parse error', async () => {
    mockDb();
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, 'not-json');
    const result = await resolve(GUEST_UID, { guest: true });
    expect(result).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT)).toBeNull();
  });
});

describe('applyDelete — гость', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('removes from localStorage and IDB', async () => {
    const db = mockDb();
    localStorage.setItem(STORAGE_KEYS.GUEST_DRAFT, JSON.stringify({ content: 'x' }));
    await applyDelete(GUEST_UID, 'close', { guest: true });
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT)).toBeNull();
    expect(db.delete).toHaveBeenCalledWith('drafts', 'guest_draft');
  });

  it('reports errors but does not throw', async () => {
    mockDb({
      objectStoreNames: { contains: vi.fn(() => true) } as unknown as DOMStringList,
      delete: vi.fn().mockRejectedValue(new Error('idb error')),
    });
    await expect(applyDelete(GUEST_UID, 'close', { guest: true })).resolves.toMatchObject({ localOk: false });
    expect(reportError).toHaveBeenCalled();
  });
});
