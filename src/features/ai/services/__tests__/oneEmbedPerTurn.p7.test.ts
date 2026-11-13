// П-7 (08.10.2026): один вектор реплики на ход.
//
// Ветке тем профиля нужен вектор запроса. При явном поиске запрос равен тексту
// реплики, а реплика уже векторизована в начале хода (AUDIT-M5, `turnEmb`) —
// второй вызов `AIService.embed` на тот же текст дублировал работу и тратил
// единицу эмбеддингов пользователя.
//
// Мутация, на которой тест краснеет: в `aiChatContext.ts` вернуть
// `const queryEmbResult = await AIService.embed({ content: searchQuery })` без
// ветки `reuseTurnVector` → красный на «embed вызван ровно один раз».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AIService } from '../../services/AIService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { AIProfileFacetService } from '../../services/AIProfileFacetService';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { useAiLimitStore } from '../../store/useAiLimitStore';
import { markAllAnalysed } from '../../../../test/utils/markAnalysed';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../utils/aiDegradationReporter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/aiDegradationReporter')>();
  return { ...actual, reportAIDegradation: vi.fn() };
});

const TEXT = 'что я писал про проект Альфа';
const DOC = 'local_p7_note';
const VEC = [1, 0, 0];

describe('П-7: вектор реплики переиспользуется в ветке тем профиля', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    setIndexingConsent('guest', 'granted');
    useAiLimitStore.setState({ remaining: 10, limit: 10, used: 0, resetsAt: new Date(Date.now() + 100_000), loaded: true, isAdmin: false });
    const db = await getLocalDb();
    for (const store of ['documents', 'versions', 'aiSummaries', 'aiEmbeddings'] as const) {
      for (const rec of await db.getAll(store)) {
        await db.delete(store, (rec as { id?: string; documentId?: string }).id || (rec as { documentId: string }).documentId);
      }
    }
    await db.put('documents', {
      id: DOC, guestId: 'u1', title: 'Про Альфа', currentVersion: 1, totalWords: 40, totalDuration: 0,
      sessionsCount: 1, firstSessionAt: 1000, lastSessionAt: 1000, tags: [],
    } as never);
    await markAllAnalysed(db);
    vi.spyOn(LocalVersionService, 'getLatestContent').mockResolvedValue('Собрали релиз Альфа, обсуждали сроки.');
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([{
      documentId: DOC, vectors: [VEC], chunkTexts: ['Собрали релиз Альфа'], contentHash: 'h', processedAt: 1, model: 'm', dim: 3,
    }] as never);
    // темы профиля непустые — иначе ветка, где был дубль, не выполняется вовсе
    vi.spyOn(AIProfileFacetService, 'getAll').mockResolvedValue([{
      id: 'f1', label: 'Работа', summary: 'Задачи, сроки, релизы', centroid: VEC, noteIds: [DOC],
    }] as never);
    vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'UPSTREAM' } as never);
  });

  it('ход с явным поиском и непустыми темами профиля векторизует реплику один раз', async () => {
    const embed = vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [VEC] } as never);
    const { result } = renderHook(() => useAIChatContext('coach'));
    const ctx = await result.current.buildContext({
      text: TEXT,
      attached: null,
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
    });

    expect(ctx.searchContext ?? '').toContain('Работа');
    const calls = embed.mock.calls.map(c => (c[0] as { content: string }).content);
    expect(calls, `векторизаций реплики: ${JSON.stringify(calls)}`).toEqual([TEXT]);
  });

  // Прежний кейс читал исходник и искал там имя `reuseTurnVector` (R7Q-036):
  // переименование переменной его краснило, а возврат второго embed — нет.
  // Здесь контроль над самим стендом: если вектор переиспользовать НЕЧЕМ (явный
  // поиск не равен тексту реплики), ветка тем профиля обязана векторизовать
  // запрос отдельно. Тогда «ровно один вызов» в первом кейсе — измерение, а не
  // молчание счётчика.
  it('контроль: без переиспользования тот же путь векторизует запрос отдельно', async () => {
    const embed = vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [VEC] } as never);
    const { result } = renderHook(() => useAIChatContext('coach'));
    const ctx = await result.current.buildContext({
      text: TEXT,
      attached: null,
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
      forcedSearchQuery: 'сроки релиза',
    });

    const calls = embed.mock.calls.map(c => (c[0] as { content: string }).content);
    expect(ctx.searchContext ?? '').toContain('Работа');
    expect(calls.length, `векторизаций: ${JSON.stringify(calls)}`).toBeGreaterThanOrEqual(2);
    expect(calls).toContain('сроки релиза');
  });
});
