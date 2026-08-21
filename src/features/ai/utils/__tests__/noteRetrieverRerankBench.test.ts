import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { searchNotes } from '../noteRetriever';
import { AIService } from '../../services/AIService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

describe('searchNotes — rerank benchmark support', () => {
  const NOTE_1 = 'local_doc_1';
  const NOTE_2 = 'local_doc_2';

  beforeEach(async () => {
    vi.restoreAllMocks();
    setIndexingConsent('guest', 'granted');
    const db = await getLocalDb();
    await db.clear('documents');
    await db.clear('versions');
    await db.clear('aiSummaries');

    await db.put('documents', {
      id: NOTE_1, guestId: 'u1', title: 'Ощущение застоя', currentVersion: 1,
      totalWords: 50, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: 1000, lastSessionAt: 1000, tags: [],
    } as never);
    await db.put('documents', {
      id: NOTE_2, guestId: 'u1', title: 'Рабочие задачи', currentVersion: 1,
      totalWords: 50, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: 2000, lastSessionAt: 2000, tags: [],
    } as never);

    await db.put('aiSummaries', {
      documentId: NOTE_1, summary: 'Мысли о застое и отсутствии прогресса в делах',
      tone: 'нейтральный', themes: ['застой'], insights: [], extractedFacts: [],
    } as never);
    await db.put('aiSummaries', {
      documentId: NOTE_2, summary: 'Обзор выполненных задач по спринту',
      tone: 'деловой', themes: ['работа'], insights: [], extractedFacts: [],
    } as never);

    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) =>
      id === NOTE_1 ? 'Кажется, что всё остановилось и ничего не меняется.' : 'Сделал пять задач по списку.',
    );
  });

  it('skips rerank when skipRerank is true and invokes onRerankMeta callback', async () => {
    // Vector similarity: [1, 0, 0] vs [0.6, 0.8, 0] = 0.6 (below 0.88, above RESURFACE_FLOOR 0.35)
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([
      { documentId: NOTE_1, vectors: [[0.6, 0.8, 0]], contentHash: 'h1', processedAt: 1, model: 'm', dim: 3 },
      { documentId: NOTE_2, vectors: [[0.5, 0.86, 0]], contentHash: 'h2', processedAt: 1, model: 'm', dim: 3 },
    ] as never);
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0, 0]] } as never);
    const rerankSpy = vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: true, documentIds: [NOTE_2, NOTE_1] } as never);

    let meta: { bypassed: boolean; bypassReason?: string } | undefined;
    const results = await searchNotes('тяжело на душе', 5, {
      skipRerank: true,
      onRerankMeta: m => { meta = m; },
    });

    expect(rerankSpy).not.toHaveBeenCalled();
    expect(meta?.bypassed).toBe(true);
    expect(meta?.bypassReason).toBe('skip_option');
    expect(results.length).toBeGreaterThan(0);
  });

  it('calls rerank when skipRerank is false/omitted and records latency in onRerankMeta', async () => {
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([
      { documentId: NOTE_1, vectors: [[0.6, 0.8, 0]], contentHash: 'h1', processedAt: 1, model: 'm', dim: 3 },
      { documentId: NOTE_2, vectors: [[0.5, 0.86, 0]], contentHash: 'h2', processedAt: 1, model: 'm', dim: 3 },
    ] as never);
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0, 0]] } as never);
    const rerankSpy = vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: true, documentIds: [NOTE_2, NOTE_1] } as never);

    let meta: { bypassed: boolean; rerankLatencyMs?: number; cardCount?: number } | undefined;
    const results = await searchNotes('тяжело на душе', 5, {
      skipRerank: false,
      onRerankMeta: m => { meta = m; },
    });

    expect(rerankSpy).toHaveBeenCalled();
    expect(meta?.bypassed).toBe(false);
    expect(typeof meta?.rerankLatencyMs).toBe('number');
    expect(meta?.cardCount).toBeGreaterThanOrEqual(1);
    expect(results[0]?.documentId).toBe(NOTE_2);
  });
});
