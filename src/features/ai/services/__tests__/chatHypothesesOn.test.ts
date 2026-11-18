// Флаг chat_hypotheses включён: ход о застрявшем получает записи разных дней и
// метку, по которой сервер ставит правило гипотезы вне ограды данных.
//
// Мутации, на которых тесты краснеют:
//  - на ходе гипотезы строится ещё и хроника (убрать `!hypothesis &&` у хроники) → красный «рассказ со словом „впервые“»;
//  - `lastTurnHypothesisRef` не выставляется → красный «не два хода подряд»;
//  - опоры идут мимо `diverseAnchors` → красный «опоры об одном предмете»;
//  - убрать `minCandidates` → красный «записей мало»;
//  - пустой ответ служебного вызова всё равно ставит метку → красный «не нашёл опор»;
//  - правило ставится перед оградой данных, а не последним → красный «правило — последним»;
//  - убрать HYPOTHESIS_PERSONAS из условия в buildChatSystemPrompt → красный «метка у Редактора»;
//  - убрать `crisis !== true` там же → красный «метка в кризисном ходе»;
//  - убрать `chronicleDates = hypothesis.dates` → красный «id и даты разрешены».
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';

const rpc = vi.fn();
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
import { buildChatSystemPrompt } from '../../../../shared/ai/buildChatPrompt';
import { HYPOTHESIS_TURN_MARK, HYPOTHESIS_RULE } from '../../../../shared/ai/hypothesisRule';
import { resetSyncFlagsForTests } from '../../../../core/sync/syncFlags';
import { markAllAnalysed } from '../../../../test/utils/markAnalysed';

const day = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
// Векторы подобраны так: близость к реплике — первая координата; clay и work смотрят в
// одну сторону («один предмет», косинус между ними выше 0,62), остальные — в разные.
const ROWS = [
  { id: 'local_far', iso: '2026-01-05', text: 'Про погоду и пробки.', vec: [0.1, -0.99, 0] },
  { id: 'local_gift', iso: '2026-02-10', text: 'Сертификат лежит в комоде с марта.', vec: [0.4, 0, -0.92] },
  { id: 'local_child', iso: '2026-03-12', text: 'Бабушка говорила: сначала гаммы, потом двор.', vec: [0.46, -0.6, 0.65] },
  { id: 'local_coffee', iso: '2026-05-20', text: 'Кофе налила только после почты и посуды. Остыл.', vec: [0.55, 0.1, -0.83] },
  { id: 'local_trip', iso: '2026-07-08', text: 'В отпуске два дня закрывала ведомость на балконе.', vec: [0.6, -0.8, 0] },
  { id: 'local_work', iso: '2026-09-02', text: 'Сдала проект и в тот же день взяла следующий.', vec: [0.7, 0.71, 0] },
  { id: 'local_clay', iso: '2026-10-30', text: 'Глина так и лежит на балконе. Сначала надо разобрать антресоль.', vec: [0.8, 0.6, 0] },
] as const;
const STUCK = 'опять весь вечер просидела над чертежами, а к глине так и не подошла, и злюсь на себя';
const WHY = 'почему я всё время откладываю то, чего мне самой хочется';

type Hook = ReturnType<typeof useAIChatContext>;
const turn = (hook: Hook, text: string) => hook.buildContext({
  text, attached: null, mood: undefined, isFirstTurn: false,
  messageHistory: [{ role: 'user', content: 'помоги составить план на неделю' }, { role: 'assistant', content: 'Давай.' }, { role: 'user', content: text }] as never,
});

// Служебный вызов «найди опоры» подменён: возвращает то, что велено, и запоминает, что ему дали.
const pick = vi.fn();
const PICK_OK = [
  { documentId: 'local_clay', quote: 'Сначала надо разобрать антресоль.' },
  { documentId: 'local_child', quote: 'сначала гаммы, потом двор' },
  { documentId: 'local_coffee', quote: 'Кофе налила только после почты и посуды.' },
];

describe('chat_hypotheses включён', () => {
  let hook: Hook;
  beforeEach(async () => {
    rpc.mockReset();
    rpc.mockImplementation(async (_fn: string, args?: { flag?: string }) => ({ data: args?.flag === 'chat_hypotheses', error: null }));
    resetSyncFlagsForTests();
    setIndexingConsent('u1', 'granted');
    const db = await getLocalDb();
    for (const s of ['documents', 'aiEmbeddings', 'versions', 'aiSummaries'] as const) await db.clear(s);
    for (const r of ROWS) {
      await db.put('documents', { id: r.id, guestId: 'guest', title: `Заметка ${r.id}`, currentVersion: 1, totalWords: 9, totalDuration: 0, sessionsCount: 1, firstSessionAt: day(r.iso), lastSessionAt: day(r.iso), tags: [] } as never);
      await db.put('versions', { id: `${r.id}_v1`, documentId: r.id, guestId: 'guest', version: 1, content: r.text, wordCount: 0, wordsAdded: 0, charsAdded: 0, duration: 0, wpm: 0, createdAt: day(r.iso) } as never);
    }
    await markAllAnalysed(db);
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue(ROWS.map(r => ({
      documentId: r.id, vectors: [r.vec], chunkTexts: [r.text], contentHash: r.id, processedAt: 1, model: 'm', dim: 3,
    })) as never);
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0, 0]], chunks: ['q'], model: 'm', dim: 3 } as never);
    pick.mockReset();
    pick.mockResolvedValue(PICK_OK);
    vi.spyOn(AIService, 'pickAnchors').mockImplementation(pick);
    hook = renderHook(() => useAIChatContext('coach')).result.current;
  });

  it('ход о застрявшем: служебному вызову — кандидаты, в ход — опоры с отмеченным отрывком, id и даты разрешены', async () => {
    const ctx = await turn(hook, STUCK);
    // Кандидаты: записи выше порога по убыванию близости; далёкая не уходит.
    expect(pick).toHaveBeenCalledTimes(1);
    const [message, candidates] = pick.mock.calls[0] as [string, { documentId: string; text: string }[]];
    expect(message).toBe(STUCK);
    expect(candidates.map(c => c.documentId)).toEqual(['local_clay', 'local_work', 'local_trip', 'local_coffee', 'local_child', 'local_gift']);
    const sc = ctx.searchContext ?? '';
    expect(sc.startsWith(HYPOTHESIS_TURN_MARK)).toBe(true);
    expect(sc).toContain('[#local_child · 2026-03-12]\nЗаметка 1: "Заметка local_child"\nБабушка говорила: сначала гаммы, потом двор.\nГлавное здесь — дословно: сначала гаммы, потом двор');
    expect(sc.indexOf('[#local_child')).toBeLessThan(sc.indexOf('[#local_clay'));
    // Не выбранные записи в ход не идут; лёгкого поиска на этом ходе нет.
    expect(sc).not.toContain('local_work');
    expect(sc).not.toContain('[Возможно релевантные заметки]');
    expect(ctx.injectedDocumentIds).toEqual(expect.arrayContaining(['local_clay', 'local_child', 'local_coffee']));
    expect(ctx.injectedDocumentIds).not.toContain('local_work');
    expect(ctx.allowedFirstSeenDates).toEqual(expect.arrayContaining(['2026-10-30', '2026-03-12']));
  });

  it('опоры об одном предмете: вторая близкая запись в ход не идёт', async () => {
    // local_clay и local_work в этой фикстуре смотрят в одну сторону — «один предмет».
    pick.mockResolvedValue([
      { documentId: 'local_clay', quote: 'Сначала надо разобрать антресоль.' },
      { documentId: 'local_work', quote: 'Сдала проект' },
      { documentId: 'local_child', quote: 'сначала гаммы, потом двор' },
    ]);
    const sc = (await turn(hook, STUCK)).searchContext ?? '';
    expect(sc).toContain('[#local_clay');
    expect(sc).toContain('[#local_child');
    expect(sc).not.toContain('local_work');
  });

  it('служебный вызов не нашёл опор или упал — ход идёт прежним путём', async () => {
    pick.mockResolvedValue([]);
    const none = (await turn(hook, STUCK)).searchContext ?? '';
    expect(none).not.toContain(HYPOTHESIS_TURN_MARK);
    expect(none).toContain('[Возможно релевантные заметки]');
    pick.mockRejectedValue(new Error('boom'));
    const failed = (await turn(hook, STUCK)).searchContext ?? '';
    expect(failed).not.toContain(HYPOTHESIS_TURN_MARK);
    expect(failed).toContain('[Возможно релевантные заметки]');
  });

  it('записей мало — служебный вызов не делается', async () => {
    const db = await getLocalDb();
    for (const id of ['local_gift', 'local_child', 'local_coffee']) await db.delete('documents', id);
    expect((await turn(hook, STUCK)).searchContext ?? '').not.toContain(HYPOTHESIS_TURN_MARK);
    expect(pick).not.toHaveBeenCalled();
  });

  it('не два хода подряд: следующая реплика без «почему» идёт прежним путём', async () => {
    expect((await turn(hook, STUCK)).searchContext).toContain(HYPOTHESIS_TURN_MARK);
    const second = (await turn(hook, STUCK)).searchContext ?? '';
    expect(second).not.toContain(HYPOTHESIS_TURN_MARK);
    expect(second).toContain('[Возможно релевантные заметки]');
    expect(pick).toHaveBeenCalledTimes(1);
    // Через ход — снова можно.
    expect((await turn(hook, STUCK)).searchContext).toContain(HYPOTHESIS_TURN_MARK);
  });

  it('«почему» о себе — ход гипотезы и сразу после другого', async () => {
    await turn(hook, STUCK);
    expect((await turn(hook, WHY)).searchContext).toContain(HYPOTHESIS_TURN_MARK);
  });

  it('рассказ со словом «впервые» — ход гипотезы, а не хроника с правилом «вопрос о записях»', async () => {
    const sc = (await turn(hook, 'опять злюсь на себя: впервые за месяц села за глину и никак не могу продолжить')).searchContext ?? '';
    expect(sc).toContain(HYPOTHESIS_TURN_MARK);
    expect(sc).not.toContain('[Хроника по вопросу');
    expect(sc).not.toContain('[Вопрос о записях');
  });

  it('просьба найти в записях — не ход гипотезы', async () => {
    const ctx = await turn(hook, 'найди в моих записях, почему я откладываю глину');
    expect(ctx.searchContext ?? '').not.toContain(HYPOTHESIS_TURN_MARK);
    expect(pick).not.toHaveBeenCalled();
  });

  it('«почему» со словом «записи»: выдача полного поиска остаётся, опоры добавляются', async () => {
    const sc = (await turn(hook, 'почему я по своим записям всё время откладываю глину')).searchContext ?? '';
    expect(sc).toContain('Результаты поиска по архиву заметок');
    expect(sc).toContain(HYPOTHESIS_TURN_MARK);
    expect(sc).toContain('Главное здесь — дословно: сначала гаммы, потом двор');
  });

  describe('правило в системном промпте', () => {
    const base = { responseLength: 'standard' as const, rnd: () => 0 };
    const withMark = `[Сегодня: 17 ноября]\n\n${HYPOTHESIS_TURN_MARK}\n\n[#a · 2026-10-30]\nЗаметка 1: "А"\nТекст.`;

    it('правило — последним, после всех оград данных', () => {
      const p = buildChatSystemPrompt({ ...base, personaId: 'coach', documentContent: withMark, userPortrait: 'портрет', memoryContext: 'память', lastUserMessage: STUCK });
      expect(p.endsWith(HYPOTHESIS_RULE)).toBe(true);
      expect(p.lastIndexOf('DATA_CONTEXT_END')).toBeLessThan(p.indexOf(HYPOTHESIS_RULE));
    });

    it('без метки правила нет', () => {
      const p = buildChatSystemPrompt({ ...base, personaId: 'coach', documentContent: withMark.replace(HYPOTHESIS_TURN_MARK, ''), lastUserMessage: STUCK });
      expect(p).not.toContain('ОСТОРОЖНУЮ ГИПОТЕЗУ');
    });

    it('метка у Редактора и у своего характера — правила нет', () => {
      for (const personaId of ['editor', 'custom']) {
        const p = buildChatSystemPrompt({ ...base, personaId, customSystemPrompt: 'Будь краток.', documentContent: withMark, lastUserMessage: STUCK });
        expect(p).not.toContain('ОСТОРОЖНУЮ ГИПОТЕЗУ');
      }
    });

    it('метка в кризисном ходе и в строгом ходе по заметке — правила нет', () => {
      const crisis = buildChatSystemPrompt({ ...base, personaId: 'coach', documentContent: withMark, crisis: true, lastUserMessage: STUCK });
      expect(crisis).not.toContain('ОСТОРОЖНУЮ ГИПОТЕЗУ');
      const strict = buildChatSystemPrompt({ ...base, personaId: 'coach', documentContent: withMark, noteScope: { mode: 'note', title: 'А', date: '30 октября' }, lastUserMessage: STUCK });
      expect(strict).not.toContain('ОСТОРОЖНУЮ ГИПОТЕЗУ');
    });
  });
});
