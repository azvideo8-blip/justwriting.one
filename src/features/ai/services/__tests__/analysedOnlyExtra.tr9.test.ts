// TR-9, ещё два места, где текст заметки уходил мимо поиска:
//  • «откуда ты это взял?» — текст заметок, на которые сослался прошлый ответ
//    (ответ мог быть написан до TR-9 и ссылаться на неразобранную);
//  • список заметок периода — у неразобранной в строку шло её название.
// Мутации (прогнаны, красные):
//  1. aiChatContext: убрать `if (!(await summaryAt(doc.id))) continue;` → «откуда взял»;
//  2. temporalBlocks.periodNotes: убрать `&& summaryById.has(d.id)` → «список периода».
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { buildTemporalBlocks } from '../chatContext/temporalBlocks';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { AIService } from '../AIService';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

const DONE = 'local_tr9x_done';
const RAW = 'local_tr9x_raw';
const TEXT: Record<string, string> = {
  [DONE]: 'Разговор с сестрой: беру чужие сроки на себя. ТЕКСТ_РАЗОБРАННОЙ',
  [RAW]: 'Разговор с братом: откладываю звонок. ТЕКСТ_НЕРАЗОБРАННОЙ',
};
const at = new Date('2026-09-10T12:00:00').getTime();

beforeEach(async () => {
  vi.restoreAllMocks();
  const db = await getLocalDb();
  for (const s of ['documents', 'aiSummaries', 'aiEmbeddings', 'aiTimeline'] as const) await db.clear(s);
  await db.put('documents', {
    id: DONE, guestId: 'u1', title: 'НАЗВАНИЕ_РАЗОБРАННОЙ', currentVersion: 1, totalWords: 9,
    totalDuration: 60, sessionsCount: 1, firstSessionAt: at, lastSessionAt: at, tags: [],
  } as never);
  await db.put('documents', {
    id: RAW, guestId: 'u1', title: 'НАЗВАНИЕ_НЕРАЗОБРАННОЙ', currentVersion: 1, totalWords: 9,
    totalDuration: 60, sessionsCount: 1, firstSessionAt: at + 1000, lastSessionAt: at + 1000, tags: [],
  } as never);
  await db.put('aiSummaries', {
    documentId: DONE, summary: 'СУТЬ_РАЗОБРАННОЙ', tone: '', frequentWords: [], insights: [], themes: [], extractedFacts: [], processedAt: 1,
  } as never);
  vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) => TEXT[id] ?? '');
  vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([] as never);
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0]] } as never);
  vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'HARNESS_NO_RERANK' } as never);
});

describe('TR-9: «откуда ты это взял?»', () => {
  it('текст неразобранной заметки из прошлого ответа повторно не уходит; разобранной — уходит', async () => {
    const { result } = renderHook(() => useAIChatContext('reflection'));
    const history = [
      { role: 'user' as const, content: 'что у меня было с родными?' },
      { role: 'assistant' as const, content: `Ты писал про сроки [#${DONE}] и про звонок [#${RAW}].` },
      { role: 'user' as const, content: 'откуда ты это взял?' },
    ];
    const ctx = await result.current.buildContext({
      text: 'откуда ты это взял?', mood: undefined, messageHistory: history, isFirstTurn: false, scope: 'wide',
      prevTurnDocIds: [DONE, RAW],
    } as never);
    expect(ctx.searchContext).toContain('ТЕКСТ_РАЗОБРАННОЙ');
    expect(ctx.searchContext).not.toContain('ТЕКСТ_НЕРАЗОБРАННОЙ');
    expect(ctx.injectedDocumentIds ?? []).not.toContain(RAW);
  });
});

describe('TR-9: список заметок периода', () => {
  it('в перечне периода нет ни названия, ни номера неразобранной заметки', async () => {
    const res = await buildTemporalBlocks({
      text: 'перечисли все записи за сентябрь 2026',
      effectiveQuery: 'перечисли все записи за сентябрь 2026',
      explicitSearch: false,
      lastSearchQuery: '',
      db: await getLocalDb(),
    });
    const out = JSON.stringify(res);
    expect(out, 'ход не дошёл до перечня периода — тест ничего не проверил').toContain('СУТЬ_РАЗОБРАННОЙ');
    expect(out).not.toContain('НАЗВАНИЕ_НЕРАЗОБРАННОЙ');
    expect(out).not.toContain(RAW);
  });
});

// Ревью 0.11.14: «двери» (наблюдение для КПТ, коуча, группы) читали текст всех
// заметок, и вывод о них уходил в подсказку модели.
// Мутация (прогнана, красная): убрать `!doorsAnalysed.has(d.id) ||` в aiChatContext.
describe('TR-9: «двери» в подсказке психологических собеседников', () => {
  it('текст неразобранной заметки для «дверей» не читается; разобранной — читается', async () => {
    const read = vi.spyOn(LocalVersionService, 'getLatestContent');
    const { result } = renderHook(() => useAIChatContext('cbt'));
    await result.current.buildContext({
      text: 'мне тревожно перед разговором', mood: undefined,
      messageHistory: [{ role: 'user', content: 'мне тревожно перед разговором' }], isFirstTurn: true, scope: 'wide',
    } as never);
    const ids = read.mock.calls.map(c => c[0]);
    expect(ids, '«двери» не считались — тест ничего не проверил').toContain(DONE);
    expect(ids).not.toContain(RAW);
  });
});
