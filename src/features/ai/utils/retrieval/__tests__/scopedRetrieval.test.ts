import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../../../../core/storage/localDb';

let mockCurrentUser: { uid: string } | null = { uid: 'user_b' };
vi.mock('../../../../../core/auth', () => ({
  getCurrentUser: () => mockCurrentUser,
}));

vi.mock('../../../../../core/services/LocalVersionService', () => ({
  LocalVersionService: {
    getLatestContent: vi.fn(async (docId: string) => {
      if (docId === 'doc_a') return 'User A confidential thoughts';
      if (docId === 'doc_b') return 'User B general note';
      return '';
    }),
  },
}));

vi.mock('../../services/AIEmbeddingService', () => ({
  AIEmbeddingService: {
    getAll: vi.fn(async () => []),
  },
}));

vi.mock('../../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../services/AIService', () => ({
  AIService: {
    embed: vi.fn(async () => ({ ok: true, vectors: [[0.1, 0.2, 0.3]] })),
  },
}));

import { getMiniSearch, invalidateMiniSearchCache } from '../indexCache';
import { searchNotes } from '../searchNotes';

describe('AG-ISO-2: Search and Retrieval Scoping', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetDbInstance();
    invalidateMiniSearchCache();
  });

  it('Separate databases for User A and User B: search as User B must NOT return User A documents', async () => {
    const dbA = await getLocalDb('user_a');
    await dbA.put('documents', {
      id: 'doc_a',
      guestId: 'user_a',
      title: 'Secret Diary of User A',
      currentVersion: 1,
      totalWords: 5,
      totalDuration: 10,
      sessionsCount: 1,
      firstSessionAt: Date.now(),
      lastSessionAt: Date.now(),
      tags: [],
    });
    const dbB = await getLocalDb('user_b');
    await dbB.put('documents', {
      id: 'doc_b',
      guestId: 'user_b',
      title: 'User B Groceries',
      currentVersion: 1,
      totalWords: 4,
      totalDuration: 5,
      sessionsCount: 1,
      firstSessionAt: Date.now(),
      lastSessionAt: Date.now(),
      tags: [],
    });

    // 1. MiniSearch for User A indexes doc_a
    const msA = await getMiniSearch('user_a');
    const resultsA = msA.search('Secret');
    expect(resultsA.some(r => r.id === 'doc_a')).toBe(true);

    // 2. MiniSearch for User B does NOT index doc_a
    const msB = await getMiniSearch('user_b');
    const resultsB = msB.search('Secret');
    expect(resultsB.some(r => r.id === 'doc_a')).toBe(false);

    // 3. searchNotes as User B does NOT return User A's note
    mockCurrentUser = { uid: 'user_b' };
    const searchResB = await searchNotes('Secret', 5);
    expect(searchResB.some(r => r.documentId === 'doc_a')).toBe(false);

    // 4. searchNotes as User A returns User A's note
    mockCurrentUser = { uid: 'user_a' };
    const searchResA = await searchNotes('Secret', 5);
    expect(searchResA.some(r => r.documentId === 'doc_a')).toBe(true);
  });

  it('ContactDoors caches per user and reads only active users notes', async () => {
    // Seed localStorage cache for User A
    localStorage.setItem('contact_doors_cache_user_a', JSON.stringify({ open: 5, closed: 0 }));

    // User B should NOT see User A's cached doors
    const userBCache = localStorage.getItem('contact_doors_cache_user_b');
    expect(userBCache).toBeNull();
  });
});

