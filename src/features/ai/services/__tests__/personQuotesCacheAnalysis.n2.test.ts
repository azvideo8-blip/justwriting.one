import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '@/features/ai/services/aiChatContext';
import { getLocalDb } from '@/core/storage/localDb';
import { AIService } from '@/features/ai/services/AIService';
import { AIEmbeddingService } from '@/features/ai/services/AIEmbeddingService';
import { LocalVersionService } from '@/core/services/LocalVersionService';
import { useAiLimitStore } from '@/features/ai/store/useAiLimitStore';
import { setIndexingConsent } from '@/core/ai/indexingConsent';

vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('@/features/ai/utils/aiDegradationReporter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/ai/utils/aiDegradationReporter')>();
  return { ...actual, reportAIDegradation: vi.fn() };
});

const X = 'local_n2_x';
const TEXT = 'Марина позвонила вечером MARKER_DAILY_QUOTE';
const QUERY = 'Что я писал про Марину?';

async function turn(result: { current: ReturnType<typeof useAIChatContext> }) {
  return await result.current.buildContext({
    text: QUERY, attached: null, mood: undefined, messageHistory: [],
    isFirstTurn: true, forcedSearchQuery: 'что я писал про марину',
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100_000), loaded: true, isAdmin: false });
  setIndexingConsent(undefined, 'granted');
  const db = await getLocalDb();
  for (const store of ['documents', 'versions', 'aiSummaries', 'aiEmbeddings'] as const) await db.clear(store);
  await db.put('documents', {
    id: X, guestId: 'u1', title: 'Запись n2', currentVersion: 1, totalWords: 5, totalDuration: 0,
    sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 1000, tags: [],
  } as never);
  await db.put('aiSummaries', {
    documentId: X, summary: '', tone: '', frequentWords: [], insights: [], themes: [], extractedFacts: [], processedAt: 1,
  } as never);
  vi.spyOn(LocalVersionService, 'getLatestContent').mockResolvedValue(TEXT);
  vi.spyOn(AIEmbeddingService, 'getAll').mockImplementation(async () => {
    const rows = await db.getAll('aiEmbeddings');
    return rows as never;
  });
  await db.put('aiEmbeddings', {
    documentId: X, vectors: [[0, 1, 0]], chunkTexts: [TEXT], contentHash: X, processedAt: 1, model: 'm', dim: 3,
  } as never);
  vi.spyOn(AIService, 'embed').mockImplementation(async (opts: { content: string }) => {
    // Полный текст хода не векторизуется (сбой поставщика), имя — векторизуется.
    if (/писал/i.test(opts.content)) return { ok: false, error: 'HARNESS_EMBED_DOWN' } as never;
    return { ok: true, vectors: [[1, 0, 0]] } as never;
  });
  vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'HARNESS_NO_RERANK' } as never);
});

describe('TR-9: кэш цитат по имени не переживает удаление разбора', () => {
  it('ход 1 нашёл цитату; после удаления разбора ход 2 того же диалога её не несёт', async () => {
    const { result } = renderHook(() => useAIChatContext('coach'));
    const ctx1 = await turn(result);
    expect(JSON.stringify(ctx1), 'ход 1 не нашёл цитату — сценарий не состоялся').toContain('MARKER_DAILY_QUOTE');

    // «Удалить разбор ИИ»: строк разбора и вектора больше нет.
    const db = await getLocalDb();
    await db.delete('aiSummaries', X);
    await db.delete('aiEmbeddings', X);

    const ctx2 = await turn(result);
    expect(ctx2.injectedDocumentIds ?? [], 'неразобранная X снова во injected').not.toContain(X);
    expect(JSON.stringify(ctx2), 'сырая цитата неразобранной заметки ушла модели из кэша')
      .not.toContain('MARKER_DAILY_QUOTE');
  });

  it('КОНТРОЛЬ: новый диалог после удаления разбора цитату не находит', async () => {
    const db = await getLocalDb();
    await db.delete('aiSummaries', X);
    await db.delete('aiEmbeddings', X);
    const { result } = renderHook(() => useAIChatContext('coach'));
    const ctx = await turn(result);
    expect(JSON.stringify(ctx)).not.toContain('MARKER_DAILY_QUOTE');
  });
});
