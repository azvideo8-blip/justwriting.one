// TEST-1 §2.1: the word cloud is scoped to the owner — the by-guest index is
// queried with the current uid, and the per-owner cache key is used.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const getAllFromIndex = vi.fn(async () => []);
const getAll = vi.fn(async () => []);

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

  it('rebuildWordCloud caches per owner', async () => {
    await rebuildWordCloud('u_owner');
    expect(localStorage.getItem('cached_word_cloud_v2:u_owner')).not.toBeNull();
  });
});
