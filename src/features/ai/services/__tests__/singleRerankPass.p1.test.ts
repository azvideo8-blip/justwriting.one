// П-1 (08.10.2026): в чате больше нет второго прохода переранжирования.
//
// Замер 08.10 на синтетическом корпусе (312 заметок / 116 запросов, боевой код
// ретривала): второй проход в `aiChatContext` не улучшал MRR, забирал 0,03
// помеченных заметок из контекста и добавлял второй сетевой вызов на ход. Порядок
// показа всё равно пересобирается ниже по composite-оценке, то есть проход решал
// только состав top-8. Первый проход внутри `searchNotes` остаётся.
//
// Мутация, на которой тест краснеет: вернуть в `aiChatContext.ts` блок с
// `AIService.rerank({ …, maxResults: 8 })` — красными становятся и «нет вызова с
// maxResults: 8», и «успешный и провалившийся реранк дают один и тот же контекст»,
// и «нет записи chat_rerank».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AIService } from '../AIService';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import { reportAIDegradation } from '../../utils/aiDegradationReporter';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../utils/aiDegradationReporter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/aiDegradationReporter')>();
  return { ...actual, reportAIDegradation: vi.fn() };
});

// 8 кандидатов: гейт удалённого блока был `allNotes.length > 5`, то есть на базе
// второй проход обязан был тут запуститься.
const IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(x => `local_p1_${x}`);

type RerankResult = { ok: boolean; error?: string; documentIds?: string[] };

async function runTurn(rerankResult: RerankResult) {
  const spy = vi.spyOn(AIService, 'rerank').mockResolvedValue(rerankResult as never);
  const { result } = renderHook(() => useAIChatContext('coach'));
  const ctx = await result.current.buildContext({
    text: 'Что там было в заметках про Альфа?',
    attached: null,
    mood: undefined,
    messageHistory: [],
    isFirstTurn: true,
    forcedSearchQuery: 'Альфа',
  });
  return { spy, ctx };
}

describe('П-1: один проход переранжирования на ход', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100_000), loaded: true, isAdmin: false });
    const db = await getLocalDb();
    for (const store of ['documents', 'versions', 'aiSummaries', 'aiEmbeddings'] as const) {
      for (const rec of await db.getAll(store)) {
        await db.delete(store, (rec as { id?: string; documentId?: string }).id || (rec as { documentId: string }).documentId);
      }
    }
    for (const id of IDS) {
      await db.put('documents', {
        id, guestId: 'u1', title: `Заметка ${id}`, currentVersion: 1, totalWords: 50, totalDuration: 0,
        sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 1000, tags: [],
      } as never);
    }
    vi.spyOn(LocalVersionService, 'getLatestContent').mockResolvedValue('Текст про проект Альфа и всё вокруг него.');
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue(IDS.map(id => ({
      documentId: id, vectors: [[1, 0, 0]], chunkTexts: ['Текст про проект Альфа'], contentHash: 'h', processedAt: 1, model: 'm', dim: 3,
    })) as never);
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0, 0]] } as never);
  });

  it('ход с восемью кандидатами не вызывает реранк с maxResults: 8', async () => {
    const { spy } = await runTurn({ ok: true, documentIds: IDS.slice(0, 8) });
    const maxResults = spy.mock.calls.map(c => (c[0] as { maxResults?: number }).maxResults);
    expect(maxResults.filter(m => m === 8)).toEqual([]);
  });

  // Ядро регрессии: состав и порядок контекста определяет бюджет сборки, а не
  // ответ реранжера. На базе успешный реранк пересортировывал и резал список до
  // восьми, поэтому «успех» и «отказ» давали разные контексты.
  it('успешный реранк и отказ дают один и тот же контекст: второго прохода нет', async () => {
    const ok = await runTurn({ ok: true, documentIds: [...IDS].reverse().slice(0, 4) });
    const bad = await runTurn({ ok: false, error: 'UPSTREAM' });
    expect(ok.ctx.searchContext).toBe(bad.ctx.searchContext);
    expect(ok.ctx.searchContext, 'контекст пуст — стенд ничего не собирает').toBeTruthy();
  });

  it('деградация chat_rerank больше не пишется', async () => {
    await runTurn({ ok: false, error: 'UPSTREAM' });
    expect(vi.mocked(reportAIDegradation).mock.calls.filter(c => c[0].feature === 'chat_rerank')).toEqual([]);
  });

  it('проверка не холостая: в исходнике чата нет ни второго прохода, ни его признака', async () => {
    const src = readFileSync('src/features/ai/services/aiChatContext.ts', 'utf8');
    expect(src).not.toContain('maxResults: 8');
    expect(src).not.toContain("feature: 'chat_rerank'");
    expect(src).toContain('П-1');
  });
});
