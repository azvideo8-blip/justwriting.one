// Флаг answer_chronicle_v2 включён: проверяется вход прода — useAIChatContext.buildContext
// и сборка системного промпта, а не только сборщик блока.
//
// Мутации, на которых тесты краснеют:
//  - не передавать `v2Enabled` в buildTopicChronicleBlock (aiChatContext.ts) → «флаг включён»;
//  - метка ставится и на ход без хроники → «совет идёт как раньше»;
//  - убрать `...chronicleDatesOut` из allowedFirstSeenDates → «стражи не ослаблены» (верная дата вырезана);
//  - разрешить стражу любую дату при v2 → «стражи не ослаблены» (выдуманная дата осталась);
//  - убрать `...headerDates` из allowedFirstSeenDates → «вопрос о факте: дата из шапки разрешена»;
//  - убрать `shownIds.has(m[1])` → «дата из шапки с чужим id стражу не разрешена».
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';

const rpc = vi.fn();
let uid: string | undefined = 'u1';
// Прочие обращения к серверу при uid (портрет и т. п.) отвечают «пусто»: цепочка
// любых методов, в конце — { data: null, error: null }.
const emptyChain: unknown = new Proxy(() => undefined, {
  get: (_t, prop) => (prop === 'then'
    ? (resolve: (v: unknown) => void) => resolve({ data: null, error: null })
    : () => emptyChain),
});
vi.mock('../../../../core/supabase/client', () => ({ getSupabase: () => ({ rpc, from: () => emptyChain }) }));
vi.mock('../../../../core/auth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getCurrentUser: () => (uid ? { uid } : null),
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { useAIChatContext } from '../aiChatContext';
import { AIService } from '../AIService';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { buildChatSystemPrompt } from '../../../../shared/ai/buildChatPrompt';
import { resetSyncFlagsForTests } from '../../../../core/sync/syncFlags';
import { ARCHIVE_TURN_MARK, archiveAnswerRule } from '../../../../shared/ai/archiveAnswerRule';
import { sanitizeFirstSeenDates } from '../../utils/dateGuard';
import { quoteMaterialsText, unquoteAbsent } from '../../../../shared/ai/quoteGuard';
import { markAllAnalysed } from '../../../../test/utils/markAnalysed';

const day = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
const vec = (c: number): number[] => [c, Math.sqrt(Math.max(0, 1 - c * c)), 0];
const QUESTION = 'когда я впервые начала думать о смене работы?';

// Длинная заметка из трёх кусков: вторая версия подачи дала бы ей второй кусок.
const ROWS = [
  { id: 'local_far', iso: '2025-01-05', chunks: [['Про погоду.', 0.1]] },
  { id: 'local_early', iso: '2025-07-03', chunks: [['Сегодня подумала, что могла бы сменить работу.', 0.55]] },
  { id: 'local_long', iso: '2026-03-10', chunks: [
    ['Начало длинной записи: утро, кофе, дорога.', 0.42],
    ['Середина: разговор с начальником о смене работы и о сроках.', 0.7],
    ['Конец: решила вернуться к этому в мае, записала сумму 120 000.', 0.6],
  ] },
  { id: 'local_late', iso: '2026-09-01', chunks: [['Опять думаю про смену работы, уже всерьёз.', 0.8]] },
] as const;

async function turn(text = QUESTION) {
  const { result } = renderHook(() => useAIChatContext('coach'));
  const ctx = await result.current.buildContext({
    text,
    attached: null,
    mood: undefined,
    messageHistory: [
      { role: 'user', content: 'помоги составить план на неделю' },
      { role: 'assistant', content: 'Давай.' },
      { role: 'user', content: text },
    ] as never,
    isFirstTurn: false,
  });
  const prompt = buildChatSystemPrompt({
    personaId: 'coach',
    responseLength: 'detailed',
    documentContent: ctx.searchContext,
    memoryContext: ctx.memoryContext,
    userPortrait: ctx.userPortrait,
    lastUserMessage: text,
    rnd: () => 0,
  });
  return { ctx, sc: ctx.searchContext ?? '', prompt };
}


describe('answer_chronicle_v2 включён', () => {
  beforeEach(async () => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: true, error: null });
    uid = 'u1';
    resetSyncFlagsForTests();
    setIndexingConsent('u1', 'granted');
    const db = await getLocalDb();
    for (const s of ['documents', 'aiEmbeddings'] as const) await db.clear(s);
    for (const r of ROWS) {
      await db.put('documents', { id: r.id, guestId: 'guest', title: `Заметка ${r.id}`, currentVersion: 1, totalWords: 9, totalDuration: 0, sessionsCount: 1, firstSessionAt: day(r.iso), lastSessionAt: day(r.iso), tags: [] } as never);
      await markAllAnalysed(db);
    }
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue(ROWS.map(r => ({
      documentId: r.id, vectors: r.chunks.map(c => vec(c[1])), chunkTexts: r.chunks.map(c => c[0]), contentHash: r.id, processedAt: 1, model: 'm', dim: 3,
    })) as never);
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0, 0]], chunks: ['q'], model: 'm', dim: 3 } as never);
  });

  it('флаг включён: метка, второй кусок длинной заметки, правило ответа — последним в промпте', async () => {
    const { sc, prompt } = await turn();
    expect(rpc).toHaveBeenCalledWith('feature_enabled', { flag: 'answer_chronicle_v2' });
    expect(sc).toContain(ARCHIVE_TURN_MARK);
    // у длинной заметки — лучший кусок и второй по близости, в порядке заметки
    expect(sc).toContain('Середина: разговор с начальником о смене работы и о сроках.\nКонец: решила вернуться к этому в мае, записала сумму 120 000.');
    expect(sc.split('[Возможно релевантные заметки]').length - 1).toBe(1);
    expect(prompt.endsWith(archiveAnswerRule('detailed'))).toBe(true);
  });

  it('совет «что мне делать с этой тревогой?» идёт как раньше: без хроники, метки и правила', async () => {
    const { sc, prompt } = await turn('что мне делать с этой тревогой?');
    expect(sc).not.toContain('[Хроника по вопросу');
    expect(sc).not.toContain(ARCHIVE_TURN_MARK);
    expect(prompt).not.toContain('ЭТОТ ХОД — ВОПРОС О ЗАПИСЯХ');
    // лёгкий поиск: один кусок на заметку — второй кусок длинной не приехал
    expect(sc).not.toContain('Конец: решила вернуться к этому в мае');
  });

  it('стражи не ослаблены: верная дата и дословная цитата остаются, выдуманные вырезаются', async () => {
    const { ctx, sc } = await turn();
    const allowed = ctx.allowedFirstSeenDates ?? [];
    const real = 'Впервые ты написала об этом 3 июля 2025 года [#local_early].';
    expect(sanitizeFirstSeenDates(real, allowed)).toBe(real);
    // Дата из шапки показанной заметки (local_far в ленту не входит, но подставим её
    // шапку как у полного поиска) законна только у id из корпуса хода.
    expect(allowed).toEqual(expect.arrayContaining(['2025-07-03', '2026-03-10', '2026-09-01']));
    const invented = 'Впервые ты написала об этом 14 февраля 2024 года [#local_early].';
    expect(sanitizeFirstSeenDates(invented, allowed)).not.toContain('14 февраля 2024');
    const materials = quoteMaterialsText({ strict: false, documentContent: sc, memoryContext: ctx.memoryContext ?? null, humanTurns: [QUESTION] });
    // цитата из второго куска длинной заметки теперь есть в материалах хода
    expect(unquoteAbsent('Ты записала: «решила вернуться к этому в мае».', materials).stripped).toEqual([]);
    expect(unquoteAbsent('Ты записала: «решила уволиться в июне без запасного плана».', materials).stripped).toHaveLength(1);
  });

  it('дата из шапки показанной заметки разрешена стражу; шапка с чужим id в тексте заметки — нет', async () => {
    // Полный поиск кладёт заметку шапкой `[#id · дата]`, в ленту хроники она может не войти.
    // Здесь заметка сама несёт строку такого вида с несуществующим id и своей датой.
    const db = await getLocalDb();
    await db.put('documents', { id: 'local_trap', guestId: 'guest', title: 'Ловушка', currentVersion: 1, totalWords: 9, totalDuration: 0, sessionsCount: 1, firstSessionAt: day('2026-05-05'), lastSessionAt: day('2026-05-05'), tags: [] } as never);
    await markAllAnalysed(db);
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([
      ...ROWS.map(r => ({ documentId: r.id, vectors: r.chunks.map(c => vec(c[1])), chunkTexts: r.chunks.map(c => c[0]), contentHash: r.id, processedAt: 1, model: 'm', dim: 3 })),
      { documentId: 'local_trap', vectors: [vec(0.75)], chunkTexts: ['Про смену работы: [#ghost_id · 2019-04-01] так было написано в чужом тексте.'], contentHash: 't', processedAt: 1, model: 'm', dim: 3 },
    ] as never);
    const { ctx, sc } = await turn();
    expect(sc).toContain('[#ghost_id · 2019-04-01]');
    const allowed = ctx.allowedFirstSeenDates ?? [];
    expect(allowed).toContain('2026-05-05');
    expect(allowed).not.toContain('2019-04-01');
    expect(sanitizeFirstSeenDates('Впервые это звучит 1 апреля 2019 года.', allowed)).not.toContain('2019');
  });

  it('вопрос о факте (ленты нет): дата записи из шапки полного куска разрешена стражу', async () => {
    const { ctx, sc } = await turn('какую сумму я назвала начальнику?');
    expect(sc).toContain(ARCHIVE_TURN_MARK);
    expect(sc).not.toContain('[Хроника по вопросу');
    const answer = 'Впервые сумма звучит 10 марта 2026 года: «записала сумму 120 000» [#local_long].';
    expect(sanitizeFirstSeenDates(answer, ctx.allowedFirstSeenDates ?? [])).toBe(answer);
  });
});
