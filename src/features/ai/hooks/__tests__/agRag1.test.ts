import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../../services/aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AIService } from '../../services/AIService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { searchNotesMulti, invalidateMiniSearchCache } from '../../utils/noteRetriever';

import { setIndexingConsent } from '../../../../core/ai/indexingConsent';

import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { AIProfileService } from '../../services/AIProfileService';

const USER = 'u1';
vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

describe('AG-RAG-1: Retrieval leaks and cache window collision', () => {
  const EXCLUDED_ID = 'local_excluded_rag_doc';
  const NORMAL_ID = 'local_normal_rag_doc';

  beforeEach(async () => {
    vi.restoreAllMocks();
    invalidateMiniSearchCache();
    setIndexingConsent(USER, 'granted');
    vi.spyOn(AIProfileService, 'getPortrait').mockResolvedValue(null);
    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) => {
      if (id === EXCLUDED_ID) return 'Текст из секретной заметки, который нельзя отправлять';
      if (id === NORMAL_ID) return 'Текст из обычной заметки';
      if (id === 'doc_spring') return 'Текст весны';
      if (id === 'doc_autumn') return 'Текст осени';
      return 'Текст для кеша';
    });
    const db = await getLocalDb();
    for (const store of ['documents', 'versions', 'aiSummaries', 'aiEmbeddings'] as const) {
      const all = await db.getAll(store);
      for (const rec of all) await db.delete(store, (rec as { id: string; documentId?: string }).id || (rec as { documentId: string }).documentId);
    }
  });

  it('Requirement 1: lite retrieval with no time window excludes excludedFromAI note', async () => {
    const db = await getLocalDb();

    await db.put('documents', {
      id: EXCLUDED_ID, guestId: 'u1', title: 'Секретная заметка', currentVersion: 1,
      totalWords: 50, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: 1000, lastSessionAt: 1000, tags: [],
      excludedFromAI: true,
    } as never);

    await db.put('documents', {
      id: NORMAL_ID, guestId: 'u1', title: 'Обычная заметка', currentVersion: 1,
      totalWords: 50, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: 2000, lastSessionAt: 2000, tags: [],
      excludedFromAI: false,
    } as never);

    const testVector = [0.9, 0.1, 0.0];
    await AIEmbeddingService.save({
      documentId: EXCLUDED_ID,
      vectors: [testVector],
      chunkTexts: ['Текст из секретной заметки, который нельзя отправлять'],
      model: 'test',
      dim: 3,
      contentHash: 'hash1',
      processedAt: 1000,
    });
    await AIEmbeddingService.save({
      documentId: NORMAL_ID,
      vectors: [testVector],
      chunkTexts: ['Текст из обычной заметки'],
      model: 'test',
      dim: 3,
      contentHash: 'hash2',
      processedAt: 1000,
    });

    vi.spyOn(AIService, 'embed').mockResolvedValue({
      ok: true,
      vectors: [testVector],
      chunks: ['text'],
      model: 'test',
      dim: 3,
    });

    const { result } = renderHook(() => useAIChatContext('editor'));

    // Drive lite retrieval path: no attached note, no explicitSearch, no time window
    const ctx = await result.current.buildContext({
      text: 'Найди мне что-нибудь',
      attached: null,
      mood: undefined,
      messageHistory: [],
      isFirstTurn: false,
    });

    expect(ctx.searchContext).not.toContain('секретной заметки');
    expect(ctx.searchContext).not.toContain('Текст из секретной заметки');
    expect(ctx.injectedDocumentIds).not.toContain(EXCLUDED_ID);
  });

  it('Requirement 2: searchNotesMulti with disjoint windows returns different results and does not collide in cache', async () => {
    const db = await getLocalDb();

    const DOC_SPRING = 'doc_spring';
    const DOC_AUTUMN = 'doc_autumn';

    await db.put('documents', {
      id: DOC_SPRING, guestId: 'u1', title: 'Весенняя заметка', currentVersion: 1,
      totalWords: 50, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: 10000, lastSessionAt: 10000, tags: [],
      excludedFromAI: false,
    } as never);

    await db.put('documents', {
      id: DOC_AUTUMN, guestId: 'u1', title: 'Осенняя заметка', currentVersion: 1,
      totalWords: 50, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: 50000, lastSessionAt: 50000, tags: [],
      excludedFromAI: false,
    } as never);

    const vecSpring = [0.95, 0.05, 0.0];
    const vecAutumn = [0.94, 0.06, 0.0];

    await AIEmbeddingService.save({
      documentId: DOC_SPRING,
      vectors: [vecSpring],
      chunkTexts: ['Текст весны'],
      model: 'test',
      dim: 3,
      contentHash: 'hash_sp',
      processedAt: 1000,
    });
    await AIEmbeddingService.save({
      documentId: DOC_AUTUMN,
      vectors: [vecAutumn],
      chunkTexts: ['Текст осени'],
      model: 'test',
      dim: 3,
      contentHash: 'hash_au',
      processedAt: 1000,
    });

    const queryVec = [0.95, 0.05, 0.0];
    vi.spyOn(AIService, 'embed').mockResolvedValue({
      ok: true,
      vectors: [queryVec],
      chunks: ['text'],
      model: 'test',
      dim: 3,
    });

    const resSpring = await searchNotesMulti(['заметка'], 5, { minTime: 5000, maxTime: 15000 });
    const resAutumn = await searchNotesMulti(['заметка'], 5, { minTime: 40000, maxTime: 60000 });

    expect(resSpring.notes.some(n => n.documentId === DOC_SPRING)).toBe(true);
    expect(resSpring.notes.some(n => n.documentId === DOC_AUTUMN)).toBe(false);

    expect(resAutumn.notes.some(n => n.documentId === DOC_AUTUMN)).toBe(true);
    expect(resAutumn.notes.some(n => n.documentId === DOC_SPRING)).toBe(false);
  });

  it('Requirement 3: searchNotesMulti hits cache when query AND window are identical', async () => {
    const db = await getLocalDb();

    await db.put('documents', {
      id: 'doc_cached', guestId: 'u1', title: 'Кешированная заметка', currentVersion: 1,
      totalWords: 50, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: 10000, lastSessionAt: 10000, tags: [],
      excludedFromAI: false,
    } as never);

    const vec = [0.9, 0.1, 0.0];
    await AIEmbeddingService.save({
      documentId: 'doc_cached',
      vectors: [vec],
      chunkTexts: ['Текст для кеша'],
      model: 'test',
      dim: 3,
      contentHash: 'hash_c',
      processedAt: 1000,
    });

    const embedSpy = vi.spyOn(AIService, 'embed').mockResolvedValue({
      ok: true,
      vectors: [vec],
      chunks: ['text'],
      model: 'test',
      dim: 3,
    });

    const res1 = await searchNotesMulti(['запрос1', 'запрос2'], 5, { minTime: 5000, maxTime: 15000 });
    expect(embedSpy).toHaveBeenCalledTimes(1);

    const res2 = await searchNotesMulti(['запрос2', 'запрос1'], 5, { minTime: 5000, maxTime: 15000 });
    expect(embedSpy).toHaveBeenCalledTimes(1); // hit cache!
    expect(res2.notes.map(n => n.documentId)).toEqual(res1.notes.map(n => n.documentId));
  });
});
