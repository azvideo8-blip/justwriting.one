import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AIConsolidationService,
  MemoryUnit,
  COSINE_CLUSTERING_THRESHOLD,
  FALLBACK_JACCARD_THRESHOLD,
} from '../AIConsolidationService';
import { getLocalDb } from '../../../../core/storage/localDb';

describe('AG-MIND-W3-clustering — Vector-Based Belief Clustering', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    try {
      const db = await getLocalDb();
      if (db.objectStoreNames.contains('aiBeliefs')) await db.clear('aiBeliefs');
      if (db.objectStoreNames.contains('aiEmbeddings')) await db.clear('aiEmbeddings');
      if (db.objectStoreNames.contains('aiChatMemory')) await db.clear('aiChatMemory');
      if (db.objectStoreNames.contains('aiSummaries')) await db.clear('aiSummaries');
    } catch {
      /* ignore IDB reset */
    }
  });

  it('Requirement 1: Two units expressing the same idea in different words cluster together via high cosine similarity', () => {
    // Vector representations with high cosine similarity (~0.85)
    const vec1 = [0.8, 0.6, 0.0, 0.0];
    const vec2 = [0.75, 0.65, 0.1, 0.0];

    const units: MemoryUnit[] = [
      {
        id: 'u1',
        type: 'chat_memory',
        text: 'не могу заставить себя начать',
        date: '2026-07-01',
        salience: 0.8,
        vector: vec1,
      },
      {
        id: 'u2',
        type: 'summary',
        text: 'опять залип и потерял день',
        date: '2026-07-02',
        salience: 0.85,
        vector: vec2,
      },
    ];

    const clusters = AIConsolidationService.clusterMemoryUnits(units);
    expect(clusters.length).toBe(1);
    expect(clusters[0]?.units.map(u => u.id)).toEqual(['u1', 'u2']);
  });

  it('Requirement 2: Two units sharing words but not meaning do NOT cluster together due to low cosine similarity', () => {
    // Vector representations with low cosine similarity (~0.35) despite sharing the word "день"
    const vecProcrastination = [1.0, 0.0, 0.0, 0.0];
    const vecBirthdayParty = [0.0, 1.0, 0.0, 0.0];

    const units: MemoryUnit[] = [
      {
        id: 'u1',
        type: 'chat_memory',
        text: 'потерял целый день на прокрастинацию',
        date: '2026-07-01',
        salience: 0.8,
        vector: vecProcrastination,
      },
      {
        id: 'u2',
        type: 'summary',
        text: 'прекрасный день рождения друга',
        date: '2026-07-02',
        salience: 0.8,
        vector: vecBirthdayParty,
      },
    ];

    const clusters = AIConsolidationService.clusterMemoryUnits(units);
    // Should NOT cluster together
    expect(clusters.length).toBe(0);
  });

  it('Requirement 3: Memory units lacking vector embeddings fall back to text Jaccard similarity', () => {
    const units: MemoryUnit[] = [
      {
        id: 'u1',
        type: 'chat_memory',
        text: 'работа над проектом идет успешно',
        date: '2026-07-01',
        salience: 0.8,
        // no vector
      },
      {
        id: 'u2',
        type: 'summary',
        text: 'работа над главным проектом успешно завершена',
        date: '2026-07-02',
        salience: 0.8,
        // no vector
      },
    ];

    const clusters = AIConsolidationService.clusterMemoryUnits(units);
    expect(clusters.length).toBe(1);
    expect(clusters[0]?.units.map(u => u.id)).toEqual(['u1', 'u2']);
  });

  it('Requirement 4: 0 network or embedding fetch calls are made on the consolidation path', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const db = await getLocalDb();
    await db.put('aiEmbeddings', {
      documentId: 'doc-100',
      vectors: [[0.5, 0.5, 0.5, 0.5]],
      model: 'qwen3-embedding-8b',
      dim: 4,
      contentHash: 'hash1',
      processedAt: Date.now(),
    });

    await db.put('aiSummaries', {
      documentId: 'doc-100',
      summary: 'высокая продуктивность в кодинге',
      tone: 'нейтральный',
      frequentWords: [],
      insights: [],
      themes: [],
      extractedFacts: [],
      processedAt: Date.now(),
      eventDate: '2026-05-10',
    });

    const gathered = await AIConsolidationService.gatherMemoryUnits();
    expect(gathered.length).toBe(1);
    const clusters = AIConsolidationService.clusterMemoryUnits(gathered);
    expect(clusters).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Requirement 5: Named constants COSINE_CLUSTERING_THRESHOLD and FALLBACK_JACCARD_THRESHOLD are exported correctly', () => {
    expect(COSINE_CLUSTERING_THRESHOLD).toBe(0.78);
    expect(FALLBACK_JACCARD_THRESHOLD).toBe(0.35);
  });
  it('Summary units are dated by eventDate, not by "today" (firstSeenAt correctness)', async () => {
    // The service used to read a `createdAt` field that does not exist on
    // AIDocumentSummary (a loose `as` cast hid it), so every summary unit fell
    // back to Date.now(). That date becomes the cluster's earliestDate and then
    // a belief's firstSeenAt — the exact date the signature feature states back
    // to the user. Dating every belief "today" would make it quietly wrong.
    const db = await getLocalDb();
    await db.clear('aiSummaries');
    await db.put('aiSummaries', {
      documentId: 'doc-date',
      summary: 'работа выматывает, когда нет контроля',
      tone: 'усталый',
      frequentWords: [],
      insights: [],
      themes: [],
      extractedFacts: [],
      processedAt: Date.now(),
      eventDate: '2026-05-10',
    });

    const units = await AIConsolidationService.gatherMemoryUnits();
    const summaryUnit = units.find(u => u.id === 'summary-doc-date');
    expect(summaryUnit).toBeDefined();
    expect(summaryUnit?.date).toBe('2026-05-10');
  });

  it('Units from the SAME document do not auto-cluster on their shared vector', () => {
    // Vectors are stored per document, so two facts from one note carry the
    // identical vector and cosine between them is always 1.0 — which would
    // cluster every multi-fact note wholesale regardless of content.
    const sharedVector = [0.1, 0.9, 0.3, 0.2];
    const units = [
      {
        id: 'timeline-doc-1-0',
        type: 'timeline' as const,
        text: 'закрыл сложную задачу на работе',
        date: '2026-05-10',
        salience: 0.8,
        vector: sharedVector,
        docId: 'doc-1',
      },
      {
        id: 'timeline-doc-1-1',
        type: 'timeline' as const,
        text: 'позвонил маме, договорились увидеться',
        date: '2026-05-10',
        salience: 0.8,
        vector: sharedVector,
        docId: 'doc-1',
      },
    ];

    const clusters = AIConsolidationService.clusterMemoryUnits(units);
    expect(clusters).toHaveLength(0);
  });
});
