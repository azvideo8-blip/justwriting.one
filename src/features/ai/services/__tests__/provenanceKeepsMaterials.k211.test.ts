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

// К21-1 (случай #21, 21.1 (1)): человек спросил «откуда ты это взял», а ход
// остался строгим (или ушёл искать по тексту самого вопроса) — материалы
// прошлого ответа пропали, и отвечать было нечем. Теперь такой ход берёт те же
// записи: по id из прошлой реплики ассистента (contextDocIds, К21-3), а если id
// в реплике нет (старые диалоги) — повторяет прошлый запрос, как LD-6.
// Фикстуры синтетические.
const NOTE_ID = 'local_k211_note';
const FOUND_1 = 'local_k211_found_1';
const FOUND_2 = 'local_k211_found_2';
const GONE = 'local_k211_gone';
const HIDDEN = 'local_k211_hidden';

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

const ANSWER_WITH_REF = `Похоже, сроки ты берёшь на себя не впервые. В записи про разговор это звучит прямо [#${FOUND_1}].`;

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

const hasResults = (ctx: { searchContext?: string | null | undefined }) =>
  (ctx.searchContext ?? '').includes('Результаты поиска по архиву заметок');

describe('К21-1: ход о происхождении держит материалы прошлого ответа', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('по id из прошлой реплики — те же записи, нового поиска нет', async () => {
    await seed();
    // Свежий хук = перезагрузка вкладки: липких запросов в памяти нет, а ход
    // всё равно обязан поднять записи прошлого ответа.
    const { ctx } = await build({
      text: 'Откуда ты это взял?',
      scope: 'note',
      history: [
        { role: 'user', content: 'посмотри, что у меня было про сроки' },
        { role: 'assistant', content: ANSWER_WITH_REF },
        { role: 'user', content: 'Откуда ты это взял?' },
      ],
      prevTurnDocIds: [FOUND_1, FOUND_2],
    });

    expect(hasResults(ctx)).toBe(true);
    expect(ctx.searchContext).toContain(`[#${FOUND_1} · `);
    expect(ctx.searchContext).toContain('Разговор с сестрой: она сказала');
    expect(ctx.searchContext).toContain('[Суть: Сестра про чужие сроки.]');
    expect(ctx.injectedDocumentIds).toContain(FOUND_1);
    expect(ctx.injectedTitles).toContain('Разговор с сестрой');
    expect(ctx.effectiveScope).toBe('wide');
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('скрытых, удалённых и отсутствующих на устройстве записей в материалах нет', async () => {
    await seed();
    const { ctx } = await build({
      text: 'это откуда?',
      scope: 'wide',
      history: [
        { role: 'user', content: 'что у меня было про сроки' },
        { role: 'assistant', content: ANSWER_WITH_REF },
        { role: 'user', content: 'это откуда?' },
      ],
      prevTurnDocIds: [FOUND_1, HIDDEN, GONE],
      attached: false,
    });

    expect(ctx.injectedDocumentIds).toEqual([FOUND_1]);
    expect(ctx.searchContext).not.toContain('Скрытая запись');
    expect(ctx.searchContext).not.toContain(HIDDEN);
    expect(ctx.searchContext).not.toContain(GONE);
  });

  it('без id в реплике (старый диалог) повторяется прошлый запрос', async () => {
    await seed();
    const { rendered } = await build({
      text: 'посмотри, что у меня было про сроки',
      scope: 'wide',
      history: [{ role: 'user', content: 'посмотри, что у меня было про сроки' }],
      forcedSearchQuery: 'сроки чужие разговор с сестрой',
    });
    searchSpy.mockClear();

    const { ctx } = await build({
      text: 'Откуда ты это взял?',
      scope: 'note',
      history: [
        { role: 'user', content: 'посмотри, что у меня было про сроки' },
        { role: 'assistant', content: ANSWER_WITH_REF },
        { role: 'user', content: 'Откуда ты это взял?' },
      ],
    }, rendered);

    expect(hasResults(ctx)).toBe(true);
    expect(ctx.searchContext).toContain(`[#${FOUND_1} · `);
    expect(ctx.effectiveScope).toBe('wide');
    // Запрос — прошлый, а не текст вопроса о происхождении.
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(String(searchSpy.mock.calls[0]?.[0])).toContain('сроки чужие разговор с сестрой');
    expect(String(searchSpy.mock.calls[0]?.[0])).not.toContain('Откуда');
  });

  it('провенанс после строгого хода без выдачи остаётся строгим', async () => {
    await seed();
    const { ctx: strictCtx, rendered } = await build({
      text: 'разбери эту заметку',
      scope: 'note',
      history: [{ role: 'user', content: 'разбери эту заметку' }],
    });
    expect(hasResults(strictCtx)).toBe(false);

    const { ctx } = await build({
      text: 'Откуда ты это взял?',
      scope: 'note',
      history: [
        { role: 'user', content: 'разбери эту заметку' },
        { role: 'assistant', content: `В этой записи усталость звучит прямо [#${NOTE_ID}].` },
        { role: 'user', content: 'Откуда ты это взял?' },
      ],
      // Материалы строгого хода — сама заметка: выдачи не было, значит и
      // продолжать нечего.
      prevTurnDocIds: [NOTE_ID],
    }, rendered);

    expect(hasResults(ctx)).toBe(false);
    expect(ctx.effectiveScope).toBeUndefined();
    expect(ctx.searchContext).toContain(NOTE_TEXT);
  });

  it('длинная реплика с «откуда» внутри темы — обычный ход со своим поиском', async () => {
    await seed();
    const { rendered } = await build({
      text: 'посмотри, что у меня было про сроки',
      scope: 'wide',
      history: [{ role: 'user', content: 'посмотри, что у меня было про сроки' }],
      forcedSearchQuery: 'сроки чужие разговор с сестрой',
    });
    searchSpy.mockClear();

    const text = 'Расскажи, откуда взялась эта привычка брать чужие сроки и что я про неё писал в октябре';
    const { ctx } = await build({
      text,
      scope: 'wide',
      history: [
        { role: 'user', content: 'посмотри, что у меня было про сроки' },
        { role: 'assistant', content: ANSWER_WITH_REF },
        { role: 'user', content: text },
      ],
      prevTurnDocIds: [FOUND_1],
    }, rendered);

    expect(ctx.effectiveScope).toBeUndefined();
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(String(searchSpy.mock.calls[0]?.[0])).toContain('привычка');
  });
});
