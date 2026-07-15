import { vi, describe, it, expect, beforeEach } from 'vitest';
import { getLocalDb } from '../../../core/storage/localDb';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { searchNotesMulti } from '../utils/noteRetriever';

vi.mock('../services/AIService', () => ({
  AIService: {
    embed: vi.fn().mockResolvedValue({
      ok: true,
      vectors: [new Array(1536).fill(0.1)],
    }),
    rerank: vi.fn().mockImplementation(() => {
      throw new Error('Rerank should not be called when bypassing!');
    }),
  },
}));

describe('local bypass pre-pass (T-3)', () => {
  beforeEach(async () => {
    const db = await getLocalDb();
    await db.clear('documents');
    await db.clear('aiEmbeddings');
    await db.clear('aiSummaries');
  });

  it('bypasses reranking when query contains exact quotes matching note content', async () => {
    const db = await getLocalDb();
    
    // Put a doc with version content
    await db.put('documents', {
      id: 'doc_quote_match',
      title: 'Усталость',
      lastSessionAt: Date.now(),
      version: 1,
    } as any);

    // Mock version store
    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id) => {
      if (id === 'doc_quote_match') {
        return 'Иногда я чувствую сильное выгорание на работе.';
      }
      return '';
    });

    // Put a dummy embedding to satisfy retrieval flow
    await db.put('aiEmbeddings', {
      documentId: 'doc_quote_match',
      vectors: [new Array(1536).fill(0.1)],
      chunkTexts: ['Иногда я чувствую сильное выгорание на работе.'],
      model: 'test',
      dim: 1536,
      contentHash: 'test-hash',
      processedAt: Date.now(),
    });

    // Perform search with exact quote in quotes
    const results = await searchNotesMulti(['хочу обсудить «выгорание на работе»'], 5);
    
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.documentId).toBe('doc_quote_match');
  });

  it('bypasses reranking when query contains named entities matching note content', async () => {
    const db = await getLocalDb();
    
    // Put a doc with version content
    await db.put('documents', {
      id: 'doc_entity_match',
      title: 'Москва',
      lastSessionAt: Date.now(),
      version: 1,
    } as any);

    // Mock version store
    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id) => {
      if (id === 'doc_entity_match') {
        return 'Мы приехали в город Санкт-Петербург.';
      }
      return '';
    });

    // Put a dummy embedding to satisfy retrieval flow
    await db.put('aiEmbeddings', {
      documentId: 'doc_entity_match',
      vectors: [new Array(1536).fill(0.1)],
      chunkTexts: ['Мы приехали в город Санкт-Петербург.'],
      model: 'test',
      dim: 1536,
      contentHash: 'test-hash',
      processedAt: Date.now(),
    });

    // Perform search with a capitalized named entity >= 3 chars
    const results = await searchNotesMulti(['Расскажи про Санкт-Петербург'], 5);
    
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.documentId).toBe('doc_entity_match');
  });
});
