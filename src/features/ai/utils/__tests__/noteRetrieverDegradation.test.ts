import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { searchNotes, invalidateMiniSearchCache } from '../noteRetriever';
import { AIService } from '../../services/AIService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { useActivityLogStore } from '../../../../shared/activity/useActivityLogStore';
import { resetAIDegradationSession } from '../aiDegradationReporter';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';

describe('noteRetriever degradation reporting (AI-3)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    invalidateMiniSearchCache();
    resetAIDegradationSession();
    useActivityLogStore.getState().clearLog();
    setIndexingConsent('guest', 'granted');

    const db = await getLocalDb();
    await db.clear('documents');
    await db.clear('aiSummaries');
    await db.clear('aiEmbeddings');

    await db.put('documents', {
      id: 'doc_1',
      guestId: 'guest',
      title: 'Заметка про отпуск',
      currentVersion: 1,
      totalWords: 50,
      totalDuration: 10,
      sessionsCount: 1,
      firstSessionAt: Date.now(),
      lastSessionAt: Date.now(),
      tags: [],
    });
    await db.put('documents', {
      id: 'doc_2',
      guestId: 'guest',
      title: 'Заметка про работу',
      currentVersion: 1,
      totalWords: 50,
      totalDuration: 10,
      sessionsCount: 1,
      firstSessionAt: Date.now(),
      lastSessionAt: Date.now(),
      tags: [],
    });

    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) =>
      id === 'doc_1'
        ? 'Поездка на море и пляжный отдых в августе.'
        : 'Рабочие задачи, митинги и спринты.',
    );

    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([
      { documentId: 'doc_1', vectors: [[0.6, 0.3, 0.7416]], contentHash: 'h1', processedAt: 1, model: 'm', dim: 3 },
      { documentId: 'doc_2', vectors: [[0.1, 0.1, 0.9899]], contentHash: 'h2', processedAt: 1, model: 'm', dim: 3 },
    ] as never);
  });

  it('still returns results and logs exactly one daily limit entry on failing rerank, deduplicating on subsequent search', async () => {
    vi.spyOn(AIService, 'embed').mockResolvedValue({
      ok: true,
      vectors: [[0.8, 0.6, 0.0]],
      chunks: [],
      model: 'test',
      dim: 3,
    });

    // Failing rerank with DAILY_LIMIT error
    vi.spyOn(AIService, 'rerank').mockResolvedValue({
      ok: false,
      error: 'DAILY_LIMIT',
    });

    // 1. First search (semantic match without literal words)
    const results1 = await searchNotes('летний релакс', 5);
    expect(results1.length).toBeGreaterThan(0);
    expect(results1[0]?.documentId).toBe('doc_1');

    const entriesAfterFirst = useActivityLogStore.getState().entries;
    expect(entriesAfterFirst).toHaveLength(1);
    expect(entriesAfterFirst[0]?.message).toContain('Дневной лимит ИИ исчерпан');
    expect(entriesAfterFirst[0]?.count).toBe(1);
    expect(entriesAfterFirst[0]?.level).toBe('warning');

    // 2. Second search with the same daily limit failure
    const results2 = await searchNotes('карьерные дела', 5);
    expect(results2.length).toBeGreaterThan(0);

    const entriesAfterSecond = useActivityLogStore.getState().entries;
    expect(entriesAfterSecond).toHaveLength(1); // Still exactly one entry
    expect(entriesAfterSecond[0]?.count).toBe(2); // Count incremented to 2
  });

  it('does not log degradation entries when rerank succeeds', async () => {
    vi.spyOn(AIService, 'embed').mockResolvedValue({
      ok: true,
      vectors: [[0.8, 0.6, 0.0]],
      chunks: [],
      model: 'test',
      dim: 3,
    });

    vi.spyOn(AIService, 'rerank').mockResolvedValue({
      ok: true,
      documentIds: ['doc_1'],
    });

    const results = await searchNotes('летний релакс', 5);
    expect(results.length).toBeGreaterThan(0);

    const entries = useActivityLogStore.getState().entries;
    expect(entries).toHaveLength(0);
  });
});
