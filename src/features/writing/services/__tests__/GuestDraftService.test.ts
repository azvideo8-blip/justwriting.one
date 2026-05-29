import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  saveGuestDraftToStorage,
  loadGuestDraftFromStorage,
  deleteGuestDraftFromStorage,
} from '../GuestDraftService';
import { getLocalDb } from '../../../../core/storage/localDb';

vi.mock('../../../../core/storage/localDb', () => {
  const store: Record<string, any> = {};
  return {
    getLocalDb: vi.fn().mockResolvedValue({
      objectStoreNames: { contains: (name: string) => name === 'drafts' },
      put: vi.fn().mockImplementation((_store: string, val: any) => {
        store[val.userId] = val;
      }),
      get: vi.fn().mockImplementation((_store: string, key: string) => store[key] ?? undefined),
      delete: vi.fn().mockImplementation((_store: string, key: string) => {
        delete store[key];
      }),
    }),
  };
});

async function clearIdb() {
  const db = await getLocalDb();
  try { await db.delete('drafts', 'guest_draft'); } catch { /* ok */ }
}

describe('saveGuestDraftToStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves to localStorage under key jw_guest_draft', async () => {
    await saveGuestDraftToStorage({ content: 'hello' });
    const stored = localStorage.getItem('jw_guest_draft');
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!)).toEqual(expect.objectContaining({ content: 'hello' }));
  });

  it('overwrites previous draft', async () => {
    await saveGuestDraftToStorage({ content: 'first' });
    await saveGuestDraftToStorage({ content: 'second' });
    const stored = JSON.parse(localStorage.getItem('jw_guest_draft')!);
    expect(stored.content).toBe('second');
  });
});

describe('loadGuestDraftFromStorage', () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearIdb();
  });

  it('loads from localStorage if present', async () => {
    localStorage.setItem('jw_guest_draft', JSON.stringify({ content: 'cached' }));
    const draft = await loadGuestDraftFromStorage();
    expect(draft?.content).toBe('cached');
  });

  it('returns null if both empty', async () => {
    const draft = await loadGuestDraftFromStorage();
    expect(draft).toBeNull();
  });

  it('removes corrupted localStorage entry and returns null', async () => {
    localStorage.setItem('jw_guest_draft', '{invalid json');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const draft = await loadGuestDraftFromStorage();
    expect(draft).toBeNull();
    expect(localStorage.getItem('jw_guest_draft')).toBeNull();
    warnSpy.mockRestore();
  });
});

describe('deleteGuestDraftFromStorage', () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearIdb();
  });

  it('removes jw_guest_draft from localStorage', async () => {
    localStorage.setItem('jw_guest_draft', JSON.stringify({ content: 'test' }));
    await deleteGuestDraftFromStorage();
    expect(localStorage.getItem('jw_guest_draft')).toBeNull();
  });

  it('does not throw if entries not found', async () => {
    await expect(deleteGuestDraftFromStorage()).resolves.not.toThrow();
  });
});
