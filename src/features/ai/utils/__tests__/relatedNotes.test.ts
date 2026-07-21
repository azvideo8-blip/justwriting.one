import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findRelatedNotes } from '../relatedNotes';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { AIService } from '../../services/AIService';
import { getLocalDb } from '../../../../core/storage/localDb';

vi.mock('../../services/AIEmbeddingService', () => ({
  AIEmbeddingService: {
    get: vi.fn(),
    getAll: vi.fn(),
  },
}));

vi.mock('../../services/AIService', () => ({
  AIService: {
    embed: vi.fn(),
  },
}));

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn(),
}));

describe('findRelatedNotes', () => {
  const seedId = 'seed-note-1';
  const now = Date.now(); // Real time for age-checking relative limits

  const mockDocuments = [
    { id: seedId, title: 'Seed Note', lastSessionAt: now },
    { id: 'related-1', title: 'Related Note 1', lastSessionAt: now - 3600000 * 24 }, // 1 day old
    { id: 'related-2', title: 'Related Note 2', lastSessionAt: now - 3600000 * 48 }, // 2 days old
    { id: 'near-duplicate', title: 'Near Duplicate', lastSessionAt: now - 3600000 * 12 }, // 12 hours old
    { id: 'irrelevant', title: 'Irrelevant Note', lastSessionAt: now - 3600000 * 72 }, // 3 days old
  ];

  // We'll use 3D vectors
  const seedVector = [1.0, 0.0, 0.0];
  const vecRelated1 = [0.7, 0.7, 0.0]; // Cosine sim to seed = 0.707 (passes floor 0.35)
  const vecRelated2 = [0.6, 0.0, 0.8]; // Cosine sim to seed = 0.6 (passes floor 0.35)
  const vecNearDuplicate = [0.69, 0.71, 0.0]; // Cosine sim to seed = 0.69, similarity to related-1 = 0.99 (fails MMR-lite)
  const vecIrrelevant = [0.0, 1.0, 0.0]; // Cosine sim to seed = 0.0 (below floor 0.35)

  const mockEmbeddings = [
    { documentId: seedId, vectors: [seedVector] },
    { documentId: 'related-1', vectors: [vecRelated1] },
    { documentId: 'related-2', vectors: [vecRelated2] },
    { documentId: 'near-duplicate', vectors: [vecNearDuplicate] },
    { documentId: 'irrelevant', vectors: [vecIrrelevant] },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getLocalDb).mockResolvedValue({
      getAll: vi.fn().mockImplementation(async (store: string) => {
        if (store === 'documents') return mockDocuments;
        return [];
      }),
    } as any);

    vi.mocked(AIEmbeddingService.getAll).mockResolvedValue(mockEmbeddings as any);
    vi.mocked(AIEmbeddingService.get).mockImplementation(async (id: string) => {
      return mockEmbeddings.find(e => e.documentId === id) as any;
    });

    vi.mocked(AIService.embed).mockResolvedValue({
      ok: true,
      vectors: [seedVector],
      chunks: [''],
      dim: 3,
      model: 'test-model',
    });
  });

  it('excludes the seed note itself', async () => {
    const results = await findRelatedNotes({ docId: seedId });
    const resultIds = results.map(r => r.documentId);
    expect(resultIds).not.toContain(seedId);
  });

  it('filters out notes below relevance floor', async () => {
    const results = await findRelatedNotes({ docId: seedId });
    const resultIds = results.map(r => r.documentId);
    expect(resultIds).not.toContain('irrelevant');
  });

  it('applies MMR-lite and filters out near-duplicate notes', async () => {
    const results = await findRelatedNotes({ docId: seedId });
    const resultIds = results.map(r => r.documentId);
    expect(resultIds).toContain('related-1');
    expect(resultIds).not.toContain('near-duplicate');
  });

  it('respects minAgeDays filter', async () => {
    // minAgeDays = 1.5 -> excludes related-1 (1 day old) and near-duplicate (12 hrs old), but keeps related-2 (2 days old)
    const results = await findRelatedNotes({ docId: seedId }, { minAgeDays: 1.5 });
    const resultIds = results.map(r => r.documentId);
    expect(resultIds).not.toContain('related-1');
    expect(resultIds).toContain('related-2');
  });

  it('performs query by text using AIService.embed', async () => {
    // Exclude seedId explicitly in ignoredDocIds so it is not returned in the text search
    const results = await findRelatedNotes({ text: 'Some seed query text' }, { ignoredDocIds: new Set([seedId]) });
    expect(AIService.embed).toHaveBeenCalledWith({ content: 'Some seed query text' });
    const resultIds = results.map(r => r.documentId);
    expect(resultIds).toContain('related-1');
    expect(resultIds).toContain('related-2');
  });
});
