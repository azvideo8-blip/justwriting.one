import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { AIService } from '../../services/AIService';
import * as noteRetriever from '../../utils/noteRetriever';
import { linkedNote } from '../../../../test/attachedTurnFixtures';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

const NOTE_ID = 'local_k241_note';
const FOUND_1 = 'local_k241_found_1';
const FOUND_2 = 'local_k241_found_2';
const HIDDEN = 'local_k241_hidden';

const NOTE_TEXT = 'Утренняя страница: усталость к среде, вечером короткая прогулка до реки.';
const FOUND_TEXT_1 = 'Разговор с сестрой: она сказала, что я снова беру чужие сроки на себя.';
const FOUND_TEXT_2 = 'Вечер после смены: лёг в полночь, голова пустая, ничего не записал.';

const CONTENT: Record<string, string> = {
  [NOTE_ID]: NOTE_TEXT,
  [FOUND_1]: FOUND_TEXT_1,
  [FOUND_2]: FOUND_TEXT_2,
  [HIDDEN]: 'Эта запись скрыта от ИИ, её текста у модели нет.',
};
const TITLES: Record<string, string> = {
  [NOTE_ID]: 'Утренняя страница',
  [FOUND_1]: 'Разговор с сестрой',
  [FOUND_2]: 'Вечер после смены',
  [HIDDEN]: 'Скрытая запись',
};


let searchSpy: ReturnType<typeof vi.spyOn>;

async function seed() {
  const db = await getLocalDb();
  for (const store of ['documents', 'aiSummaries', 'aiEmbeddings', 'versions'] as const) {
    for (const rec of await db.getAll(store)) {
      const key = (rec as { id?: string; documentId?: string }).id ?? (rec as { documentId: string }).documentId!;
      await db.delete(store, key as string);
    }
  }
  const now = Date.now();
  for (const [i, id] of Object.keys(CONTENT).entries()) {
    await db.put('documents', {
      id, guestId: 'u1', title: TITLES[id], currentVersion: 1, totalWords: 20, totalDuration: 60,
      sessionsCount: 1, firstSessionAt: now - i * 86_400_000, lastSessionAt: now - i * 86_400_000, tags: [],
      ...(id === HIDDEN ? { excludedFromAI: true } : {}),
    } as never);
  }
  await db.put('aiSummaries', { documentId: FOUND_1, processedAt: now, summary: 'Сестра про чужие сроки.', themes: ['Сроки'] } as never);

  vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) => CONTENT[id] ?? '');
  vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue(
    Object.keys(CONTENT).map(id => ({ documentId: id, vectors: [[1, 0]], contentHash: `h${id}`, processedAt: now, model: 'm', dim: 2 })) as never,
  );
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0]] } as never);
  vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'SERVER_ERROR' } as never);
  searchSpy = vi.spyOn(noteRetriever, 'searchNotesMulti').mockResolvedValue({
    notes: [
      { documentId: FOUND_1, title: TITLES[FOUND_1], content: FOUND_TEXT_1, score: 0.4, lastSessionAt: now },
      { documentId: FOUND_2, title: TITLES[FOUND_2], content: FOUND_TEXT_2, score: 0.3, lastSessionAt: now },
    ],
    failed: false, degraded: false,
  } as never);
}

type Turn = {
  text: string;
  scope: 'note' | 'wide';
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  prevTurnDocIds?: string[];
  attached?: boolean;
  forcedSearchQuery?: string;
};

async function build(turn: Turn, hook?: { result: { current: ReturnType<typeof useAIChatContext> } }) {
  const rendered = hook ?? renderHook(() => useAIChatContext('coach'));
  const ctx = await rendered.result.current.buildContext({
    text: turn.text,
    attached: turn.attached === false ? null : linkedNote(NOTE_ID, NOTE_TEXT),
    mood: undefined,
    messageHistory: turn.history,
    isFirstTurn: turn.history.length === 0,
    scope: turn.scope,
    ...(turn.forcedSearchQuery ? { forcedSearchQuery: turn.forcedSearchQuery } : {}),
    ...(turn.prevTurnDocIds ? { prevTurnDocIds: turn.prevTurnDocIds } : {}),
  } as never);
  return { ctx, rendered };
}


// К24-1 (случай #24): строгий ход по заметке кончился предложением вернуться к
// другой записи со ссылкой (номер пришёл из фона прошлых дней). Человек ответил
// «посмотри в той заметке» — ход стал широким, искал по служебным словам и
// ничего не нашёл; записи, на которую он указал, в материалах не было.
// Фикстуры синтетические.
const REPLY_WITH_POINTER = `В этой записи усталость к среде. Хочешь, посмотрим запись про разговор с сестрой [#${FOUND_1}]?`;
const POINTER_HISTORY = (q: string) => [
  { role: 'user' as const, content: 'что тут у меня' },
  { role: 'assistant' as const, content: REPLY_WITH_POINTER },
  { role: 'user' as const, content: q },
];
const POINTED = 'на которые ты ссылался в прошлом ответе';

describe('К24-1: указатель на запись из прошлого ответа кладёт её в ход', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('«посмотри в той заметке» — запись по ссылке и приложенная заметка, поиска нет', async () => {
    await seed();
    const { ctx } = await build({ text: 'посмотри в той заметке', scope: 'wide', history: POINTER_HISTORY('посмотри в той заметке'), prevTurnDocIds: [NOTE_ID, FOUND_1] });
    expect(ctx.searchContext).toContain(POINTED);
    expect(ctx.searchContext).toContain(`[#${FOUND_1} · `);
    expect(ctx.searchContext).toContain('Разговор с сестрой: она сказала');
    expect(ctx.searchContext).toContain(NOTE_TEXT);
    expect(ctx.injectedDocumentIds).toEqual(expect.arrayContaining([FOUND_1, NOTE_ID]));
    expect(ctx.effectiveScope).toBe('wide');
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('короткое согласие на предложение со ссылкой — то же', async () => {
    await seed();
    const { ctx } = await build({ text: 'давай', scope: 'note', history: POINTER_HISTORY('давай'), prevTurnDocIds: [NOTE_ID, FOUND_1] });
    expect(ctx.searchContext).toContain(POINTED);
    expect(ctx.searchContext).toContain('Разговор с сестрой: она сказала');
    expect(ctx.injectedDocumentIds).toContain(FOUND_1);
  });

  it('«посмотри эту заметку» при приложенной — строгий ход, как раньше', async () => {
    await seed();
    const { ctx } = await build({ text: 'посмотри эту заметку', scope: 'note', history: POINTER_HISTORY('посмотри эту заметку'), prevTurnDocIds: [NOTE_ID, FOUND_1] });
    // Фон прошлых дней строгого хода может нести ту же запись — это не указатель.
    expect(ctx.searchContext ?? '').not.toContain(POINTED);
    expect(ctx.effectiveScope).toBeUndefined();
  });

  it('в прошлом ответе ссылок нет — указатель ничего не подставляет', async () => {
    await seed();
    const history = [
      { role: 'user' as const, content: 'что тут у меня' },
      { role: 'assistant' as const, content: 'В этой записи усталость к среде. Хочешь, посмотрим другие записи?' },
      { role: 'user' as const, content: 'посмотри в той заметке' },
    ];
    const { ctx } = await build({ text: 'посмотри в той заметке', scope: 'wide', history, prevTurnDocIds: [NOTE_ID, FOUND_1] });
    expect(ctx.searchContext ?? '').not.toContain(POINTED);
  });

  it('скрытая или неразобранная запись по ссылке в материалы не идёт', async () => {
    await seed();
    for (const id of [HIDDEN, FOUND_2]) {
      const reply = `В этой записи усталость. Хочешь, посмотрим ту запись [#${id}]?`;
      const history = [
        { role: 'user' as const, content: 'что тут у меня' },
        { role: 'assistant' as const, content: reply },
        { role: 'user' as const, content: 'посмотри в той заметке' },
      ];
      const { ctx } = await build({ text: 'посмотри в той заметке', scope: 'wide', history, prevTurnDocIds: [NOTE_ID, id] });
      expect(ctx.searchContext ?? '').not.toContain(POINTED);
    }
  });

  it('номер, которого модель тогда не видела, не подставляется', async () => {
    await seed();
    const { ctx } = await build({ text: 'посмотри в той заметке', scope: 'wide', history: POINTER_HISTORY('посмотри в той заметке'), prevTurnDocIds: [NOTE_ID] });
    expect(ctx.searchContext ?? '').not.toContain(POINTED);
  });
});
