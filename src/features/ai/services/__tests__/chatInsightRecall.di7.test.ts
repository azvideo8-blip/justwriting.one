// DI-7: вспоминание прошлого вывода в buildContext. Настоящий buildContext поверх
// fake-indexeddb; подменены края: AIService.matchInsight, AIService.embed, флаг
// chat_insights (rpc), reportError. Мутации — в комментариях у кейсов.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';

const rpc = vi.fn();
const flags = { insights: true };
const emptyChain: unknown = new Proxy(() => undefined, {
  get: (_t, prop) => (prop === 'then'
    ? (resolve: (v: unknown) => void) => resolve({ data: null, error: null })
    : () => emptyChain),
});
vi.mock('../../../../core/supabase/client', () => ({ getSupabase: () => ({ rpc, from: () => emptyChain }) }));
vi.mock('../../../../core/auth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getCurrentUser: () => ({ uid: 'u1' }),
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { useAIChatContext } from '../aiChatContext';
import { AIService } from '../AIService';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { resetSyncFlagsForTests } from '../../../../core/sync/syncFlags';
import { markAllAnalysed } from '../../../../test/utils/markAnalysed';
import { INSIGHT_RECALL_MARK } from '../../../../shared/ai/insightRecall';

const day = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
const STUCK = 'опять весь вечер просидела над чертежами, а к глине так и не подошла, и злюсь на себя';
const QUOTE_OTHER = 'Своё ты ставишь в конец очереди, а очередь не кончается.';
const QUOTE_OWN = 'Отдых для тебя — награда, а не часть работы.';
const QUOTE_HIDDEN = 'Ты ждёшь разрешения на своё, и потому всё откладываешь.';

const match = vi.fn();

type Hook = ReturnType<typeof useAIChatContext>;
// prior — сколько реплик человека было до текущей: 0 — первый ход, 2 — третий.
const turn = (hook: Hook, text: string, prior = 0) => hook.buildContext({
  text, attached: null, mood: undefined, isFirstTurn: false, dialogueId: 'dlg-current',
  messageHistory: [
    ...Array.from({ length: prior }, (_, i) => [
      { role: 'user', content: `прошлый вопрос ${i}` },
      { role: 'assistant', content: `прошлый ответ ${i}` },
    ]).flat(),
    { role: 'user', content: text },
  ] as never,
});

const conclusion = (id: string, text: string, dialogueId: string, docIds: string[]) => ({
  id, kind: 'conclusion', text, context: 'Про вечер над чертежами.',
  sourceDialogueId: dialogueId, sourceMessageId: 'm1', sourceDocumentIds: docIds,
  confirmedAt: day('2026-10-05'), confirmedBy: 'reply',
  createdAt: day('2026-10-05'), updatedAt: day('2026-10-05'),
});

async function seedDocs() {
  const db = await getLocalDb();
  for (const [id, excluded] of [['doc_src', false], ['doc_hidden', true]] as const) {
    await db.put('documents', { id, guestId: 'guest', title: `Заметка ${id}`, currentVersion: 1, totalWords: 9, totalDuration: 0, sessionsCount: 1, firstSessionAt: day('2026-09-01'), lastSessionAt: day('2026-09-01'), tags: [], ...(excluded ? { excludedFromAI: true } : {}) } as never);
    await db.put('versions', { id: `${id}_v1`, documentId: id, guestId: 'guest', version: 1, content: 'Про почту и посуду перед своим.', wordCount: 0, wordsAdded: 0, charsAdded: 0, duration: 0, wpm: 0, createdAt: day('2026-09-01') } as never);
  }
  await markAllAnalysed(db);
}

describe('DI-7: вспоминание в buildContext', () => {
  let hook: Hook;
  beforeEach(async () => {
    vi.restoreAllMocks();
    rpc.mockReset();
    flags.insights = true;
    rpc.mockImplementation(async (_fn: string, args?: { flag?: string }) => ({ data: args?.flag === 'chat_insights' && flags.insights, error: null }));
    resetSyncFlagsForTests();
    setIndexingConsent('u1', 'granted');
    localStorage.removeItem('ai_chat_extras_u1');
    const db = await getLocalDb();
    for (const s of ['documents', 'versions', 'aiChatMemory', 'aiEmbeddings', 'aiSummaries'] as const) await db.clear(s);
    await seedDocs();
    await db.put('aiChatMemory', conclusion('c_other', QUOTE_OTHER, 'dlg-other', ['doc_src']) as never);
    await db.put('aiChatMemory', conclusion('c_own', QUOTE_OWN, 'dlg-current', ['doc_src']) as never);
    await db.put('aiChatMemory', conclusion('c_hidden', QUOTE_HIDDEN, 'dlg-other2', ['doc_hidden']) as never);
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([] as never);
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0, 0]], chunks: ['q'], model: 'm', dim: 3 } as never);
    match.mockReset();
    match.mockResolvedValue({ ok: true, match: 1 });
    vi.spyOn(AIService, 'matchInsight').mockImplementation(match);
    hook = renderHook(() => useAIChatContext('coach')).result.current;
  });

  it('первый ход, попадание → блок с датой и текстом; кандидаты — только чужой видимый вывод', async () => {
    const ctx = await turn(hook, STUCK);
    expect(match).toHaveBeenCalledTimes(1);
    const [message, candidates] = match.mock.calls[0] as [string, { text: string; context: string }[]];
    expect(message).toBe(STUCK);
    // Свой диалог и скрытая опора — не кандидаты.
    expect(candidates).toEqual([{ text: QUOTE_OTHER, context: 'Про вечер над чертежами.' }]);
    const sc = ctx.searchContext ?? '';
    expect(sc).toContain(INSIGHT_RECALL_MARK);
    expect(sc).toContain('05.10.2026');
    expect(sc).toContain(`«${QUOTE_OTHER}»`);
    // Мутации: убрать исключение своего диалога — красный (кандидатов стало бы 2);
    // getConclusions вместо getUsableConclusions — красный (скрытый в кандидатах).
  });

  it('третья реплика человека → вызова нет', async () => {
    await turn(hook, STUCK, 2);
    expect(match).not.toHaveBeenCalled();
    // Мутация: убрать условие числа ходов — красный.
  });

  it('кризисная реплика → вызова нет', async () => {
    await turn(hook, 'опять думал о смерти, не вижу смысла');
    expect(match).not.toHaveBeenCalled();
    // Мутация: убрать !crisis — красный.
  });

  it('вывод только этого диалога → кандидатов нет, вызова нет', async () => {
    const db = await getLocalDb();
    await db.clear('aiChatMemory');
    await db.put('aiChatMemory', conclusion('c_own', QUOTE_OWN, 'dlg-current', ['doc_src']) as never);
    await turn(hook, STUCK);
    expect(match).not.toHaveBeenCalled();
    // Мутация: убрать исключение своего диалога — красный.
  });

  it('опора вывода скрыта → кандидатов нет, вызова нет', async () => {
    const db = await getLocalDb();
    await db.clear('aiChatMemory');
    await db.put('aiChatMemory', conclusion('c_hidden', QUOTE_HIDDEN, 'dlg-other2', ['doc_hidden']) as never);
    await turn(hook, STUCK);
    expect(match).not.toHaveBeenCalled();
    // Мутация: getConclusions вместо getUsableConclusions — красный.
  });

  it('два хода подряд с попаданием → блок только в первом', async () => {
    const first = await turn(hook, STUCK);
    expect(first.searchContext ?? '').toContain(INSIGHT_RECALL_MARK);
    const second = await turn(hook, STUCK, 1);
    expect(match).toHaveBeenCalledTimes(1);
    expect(second.searchContext ?? '').not.toContain(INSIGHT_RECALL_MARK);
    // Мутация: не поднимать флаг «вспоминали» — красный.
  });

  // Ревью 0.11.24, N-6: промах на первом ходе — второго вызова нет (пул фона общий
  // с разбором заметок). Мутация: поднимать флаг только при попадании — два вызова, красный.
  it('промах на первом ходе → на втором вызова нет', async () => {
    match.mockResolvedValue({ ok: true, match: 0 });
    await turn(hook, STUCK);
    await turn(hook, STUCK, 1);
    expect(match).toHaveBeenCalledTimes(1);
  });

  it('флаг выключен → вызова нет; та же фикстура с флагом — вызов есть', async () => {
    flags.insights = false;
    resetSyncFlagsForTests();
    await turn(hook, STUCK);
    expect(match).not.toHaveBeenCalled();
    flags.insights = true;
    resetSyncFlagsForTests();
    hook = renderHook(() => useAIChatContext('coach')).result.current;
    await turn(hook, STUCK);
    expect(match).toHaveBeenCalledTimes(1);
  });

  it('дополнения чата выключены → вызова нет', async () => {
    localStorage.setItem('ai_chat_extras_u1', '0');
    await turn(hook, STUCK);
    expect(match).not.toHaveBeenCalled();
  });
});