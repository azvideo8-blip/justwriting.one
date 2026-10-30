// TEST-1 §2.1: the word cloud is scoped to the owner — the by-guest index is
// queried with the current uid, and the per-owner cache key is used.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const getAllFromIndex = vi.fn(async (_store?: string, _index?: string, _val?: string): Promise<unknown[]> => []);
const getAll = vi.fn(async (_store?: string): Promise<unknown[]> => []);

vi.mock('../../../../core/auth/supabaseAuthProvider', () => ({
  getCurrentUser: () => ({ uid: 'u_owner' }),
}));

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: async () => ({
    getAllFromIndex,
    getAll,
  }),
}));

import { useArchiveWordCloud, rebuildWordCloud } from '../useArchiveWordCloud';

beforeEach(() => {
  getAllFromIndex.mockClear();
  getAll.mockClear();
  localStorage.clear();
});

describe('2.1 word-cloud owner scoping', () => {
  it('hook rebuild queries ONLY the owner slice via by-guest index', async () => {
    renderHook(() => useArchiveWordCloud());
    await waitFor(() => expect(getAllFromIndex).toHaveBeenCalled());
    expect(getAllFromIndex).toHaveBeenCalledWith('documents', 'by-guest', 'u_owner');
    // The unscoped documents path is gone (getAll for aiSummaries is fine).
    expect(getAll).not.toHaveBeenCalledWith('documents');
  });

  it('rebuildWordCloud caches per owner with timestamp', async () => {
    await rebuildWordCloud('u_owner');
    expect(localStorage.getItem('cached_word_cloud_v2:u_owner')).not.toBeNull();
    const ts = localStorage.getItem('cached_word_cloud_v2:u_owner:timestamp');
    expect(ts).not.toBeNull();
    expect(Number(ts)).toBeGreaterThan(0);
  });

  it('rebuilds if cache is older than 24 hours', async () => {
    // Populate cache with an old timestamp (25 hours ago)
    const oldTimestamp = Date.now() - 25 * 60 * 60 * 1000;
    localStorage.setItem('cached_word_cloud_v2:u_owner', JSON.stringify([{ word: 'старое', count: 5 }]));
    localStorage.setItem('cached_word_cloud_v2:u_owner:timestamp', String(oldTimestamp));

    renderHook(() => useArchiveWordCloud());

    await waitFor(() => {
      expect(getAllFromIndex).toHaveBeenCalledWith('documents', 'by-guest', 'u_owner');
    });
  });

  it('does not rebuild if cache is fresh (< 24 hours)', async () => {
    const freshTimestamp = Date.now() - 1 * 60 * 60 * 1000;
    localStorage.setItem('cached_word_cloud_v2:u_owner', JSON.stringify([{ word: 'свежее', count: 5 }]));
    localStorage.setItem('cached_word_cloud_v2:u_owner:timestamp', String(freshTimestamp));

    renderHook(() => useArchiveWordCloud());

    // Should not trigger rebuild
    expect(getAllFromIndex).not.toHaveBeenCalled();
  });

  it('ignores trashed documents when building cloud', async () => {
    getAllFromIndex.mockImplementation(async (store?: string) => {
      if (store === 'documents') {
        return [
          { id: 'd1', trashedAt: Date.now() }, // in trash
          { id: 'd2' }, // active
        ] as unknown as never;
      }
      if (store === 'versions') {
        return [
          { id: 'v1', version: 1, content: 'активное слово слово' },
        ] as unknown as never;
      }
      return [] as never;
    });

    await rebuildWordCloud('u_owner');

    // Should only query versions for d2, not d1
    expect(getAllFromIndex).not.toHaveBeenCalledWith('versions', 'by-document', 'd1');
    expect(getAllFromIndex).toHaveBeenCalledWith('versions', 'by-document', 'd2');
  });
});

// Владелец 30.10: заметка, скрытая от ИИ, в облако слов не попадает.
// Мутация: убрать `!d.excludedFromAI` из фильтра → красный.
describe('облако слов без скрытых от ИИ', () => {
  it('слова скрытой заметки не попадают в облако', async () => {
    getAllFromIndex.mockImplementation(async (store?: string, _i?: string, val?: string) => {
      if (store === 'documents') return [
        { id: 'open', guestId: 'u_owner' },
        { id: 'hidden', guestId: 'u_owner', excludedFromAI: true },
      ];
      if (store === 'versions') return [{ version: 1, content: val === 'hidden' ? 'секретслово секретслово секретслово' : 'обычноеслово обычноеслово' }];
      return [];
    });
    await rebuildWordCloud('u_owner');
    const cloud = JSON.parse(localStorage.getItem('cached_word_cloud_v2:u_owner') ?? '[]') as { word: string }[];
    expect(cloud.map(e => e.word)).toContain('обычноеслово');
    expect(cloud.map(e => e.word)).not.toContain('секретслово');
    getAllFromIndex.mockImplementation(async () => []);
  });
});

// Мутация: убрать note.excludedFromAI из списка событий → красный.
describe('облако перестраивается, когда заметку скрыли от ИИ', () => {
  it('событие note.excludedFromAI → пересборка', async () => {
    const { emitDomainEvent } = await import('../../../../core/events/domainEvents');
    localStorage.setItem('cached_word_cloud_v2:u_owner', JSON.stringify([{ word: 'свежее', count: 5 }]));
    localStorage.setItem('cached_word_cloud_v2:u_owner:timestamp', String(Date.now()));
    renderHook(() => useArchiveWordCloud());
    await new Promise(r => setTimeout(r, 20));
    getAllFromIndex.mockClear();
    emitDomainEvent({ type: 'note.excludedFromAI', documentId: 'd1', excluded: true });
    await waitFor(() => expect(getAllFromIndex).toHaveBeenCalledWith('documents', 'by-guest', 'u_owner'));
  });
});

