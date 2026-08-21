import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../core/storage/localDb';
import { AIService } from '../services/AIService';
import { AIEmbeddingService } from '../services/AIEmbeddingService';
import { indexDocument, indexPending, CURRENT_EMBED_MODEL, CURRENT_EMBED_DIM, CURRENT_EMBED_SCHEMA } from '../utils/embeddingIndexer';
import { searchNotes } from '../utils/noteRetriever';
import { findRelatedNotes } from '../utils/relatedNotes';
import {
  getIndexingConsent,
  setIndexingConsent,
  hasIndexingConsent,
} from '../../../core/ai/indexingConsent';

const USER = 'user_d427_test';

vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
}));

describe('D4.27 — Indexing Consent Contract', () => {
  let embedSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    setIndexingConsent(USER, 'unanswered');

    embedSpy = vi.spyOn(AIService, 'embed').mockResolvedValue({
      ok: true,
      model: CURRENT_EMBED_MODEL,
      dim: CURRENT_EMBED_DIM,
      vectors: [[0.1, 0.2, 0.3, 0.4]],
      chunks: ['Sample chunk text'],
    } as never);

    const db = await getLocalDb();
    await db.clear('documents');
    await db.clear('versions');
    await db.clear('aiEmbeddings');

    // Seed document with version
    await db.put('documents', {
      id: 'doc_1',
      title: 'Дневник разработчика',
      lastSessionAt: Date.now(),
      aiProcessed: false,
    } as never);
    await db.put('versions', {
      id: 'v1',
      documentId: 'doc_1',
      version: 1,
      content: 'Сегодня я изучал архитектуру поисковых индексов и векторных эмбеддингов.',
    } as never);
  });

  it('1. With no answer recorded (unanswered), NO embedding request is made for indexing', async () => {
    expect(getIndexingConsent(USER)).toBe('unanswered');
    expect(hasIndexingConsent(USER)).toBe(false);

    const res = await indexDocument('doc_1');
    expect(res).toBe('skip');
    expect(embedSpy).not.toHaveBeenCalled();

    const pendingRes = await indexPending();
    expect(pendingRes.ok).toBe(0);
    expect(pendingRes.skipped).toBeGreaterThan(0);
    expect(embedSpy).not.toHaveBeenCalled();
  });

  it('2. With no answer recorded (unanswered), search falls back to keyword matching without network embedding calls', async () => {
    expect(getIndexingConsent(USER)).toBe('unanswered');

    const results = await searchNotes('архитектуру');
    expect(embedSpy).not.toHaveBeenCalled();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.documentId).toBe('doc_1');
  });

  it('3. With no answer recorded (unanswered), findRelatedNotes with text does not call embed', async () => {
    const related = await findRelatedNotes({ text: 'поисковые индексы' });
    expect(related).toEqual([]);
    expect(embedSpy).not.toHaveBeenCalled();
  });

  it('4. After refusal, search returns keyword results and NO indexing happens', async () => {
    setIndexingConsent(USER, 'refused');
    expect(getIndexingConsent(USER)).toBe('refused');
    expect(hasIndexingConsent(USER)).toBe(false);

    const indexRes = await indexDocument('doc_1');
    expect(indexRes).toBe('skip');
    expect(embedSpy).not.toHaveBeenCalled();

    const searchResults = await searchNotes('эмбеддингов');
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0]?.documentId).toBe('doc_1');
    expect(embedSpy).not.toHaveBeenCalled();
  });

  it('5. Refusal leaves existing embeddings in place', async () => {
    // Manually put an existing embedding
    await AIEmbeddingService.save({
      documentId: 'doc_1',
      vectors: [[0.5, 0.5, 0.5, 0.5]],
      chunkTexts: ['Sample chunk'],
      model: CURRENT_EMBED_MODEL,
      dim: CURRENT_EMBED_DIM,
      contentHash: 'some_hash',
      processedAt: Date.now(),
      schemaV: CURRENT_EMBED_SCHEMA,
    });

    setIndexingConsent(USER, 'refused');

    const existing = await AIEmbeddingService.get('doc_1');
    expect(existing).toBeDefined();
    expect(existing?.vectors?.[0]).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('6. After agreement, indexing proceeds and calls embedding provider', async () => {
    setIndexingConsent(USER, 'granted');
    expect(getIndexingConsent(USER)).toBe('granted');
    expect(hasIndexingConsent(USER)).toBe(true);

    const res = await indexDocument('doc_1');
    expect(res).toBe('ok');
    expect(embedSpy).toHaveBeenCalledTimes(1);
    expect(embedSpy).toHaveBeenCalledWith({
      content: 'Сегодня я изучал архитектуру поисковых индексов и векторных эмбеддингов.',
    });

    const stored = await AIEmbeddingService.get('doc_1');
    expect(stored).toBeDefined();
    expect(stored?.model).toBe(CURRENT_EMBED_MODEL);
  });
});
