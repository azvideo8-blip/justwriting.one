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

// LD-6: ход-согласие после широкого хода с результатами терял эти результаты.
// Второй ход (широкий) нашёл записи и Редактор предложил из них пост, третий —
// короткое «давай, собери, только без …». turnScope считал его строгим, а
// строгий возврат в aiChatContext стоит раньше липкого поиска, поэтому найденные
// заметки исчезали. Фикстуры синтетические.
const NOTE_ID = 'local_ld6_note';
const NOTE_TEXT = 'Понедельник был рваный: правки по каталогу, созвон с подрядчиком, вечером допиливала макет.';
const FOUND_1 = 'Созвон с подрядчиком: он перенёс срок на четверг, я не предупредила заранее.';
const FOUND_2 = 'Подрядчик снова сорвал срок, и я в третий раз правлю макет каталога.';
const FOUND_3 = 'Вечером допилила макет, подрядчик ответил только к полуночи.';

const CONTENT: Record<string, string> = {
  [NOTE_ID]: NOTE_TEXT,
  local_ld6_found_1: FOUND_1,
  local_ld6_found_2: FOUND_2,
  local_ld6_found_3: FOUND_3,
};
const TITLES: Record<string, string> = {
  [NOTE_ID]: 'Рваный понедельник',
  local_ld6_found_1: 'Созвон с подрядчиком',
  local_ld6_found_2: 'Подрядчик сорвал срок',
  local_ld6_found_3: 'Макет допилен',
};

const PROPOSAL = 'Из этих трёх записей собирается короткий пост про срывы сроков. Хочешь, соберу его?';

async function seed() {
  const db = await getLocalDb();
  for (const store of ['documents', 'aiSummaries', 'aiEmbeddings', 'versions'] as const) {
    const all = await db.getAll(store);
    for (const rec of all) {
      const key = (rec as { id?: string; documentId?: string }).id ?? (rec as { documentId: string }).documentId!;
      await db.delete(store, key as string);
    }
  }
  const now = Date.now();
  for (const [i, id] of Object.keys(CONTENT).entries()) {
    await db.put('documents', {
      id, guestId: 'u1', title: TITLES[id], currentVersion: 1, totalWords: 20, totalDuration: 60, sessionsCount: 1,
      firstSessionAt: now - i * 86_400_000, lastSessionAt: now - i * 86_400_000, tags: [],
    } as never);
  }
  await db.put('aiSummaries', { documentId: NOTE_ID, processedAt: now, summary: 'Понедельник: правки каталога и подрядчик.', themes: ['Подрядчик'] } as never);

  vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) => CONTENT[id] ?? '');
  vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue(
    Object.keys(CONTENT).map(id => ({ documentId: id, vectors: [[1, 0]], contentHash: `h${id}`, processedAt: now, model: 'm', dim: 2 })) as never,
  );
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0]] } as never);
  vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'SERVER_ERROR' } as never);
  vi.spyOn(noteRetriever, 'searchNotesMulti').mockResolvedValue({
    notes: [
      { documentId: 'local_ld6_found_1', title: TITLES.local_ld6_found_1, content: FOUND_1, score: 0.4, lastSessionAt: now },
      { documentId: 'local_ld6_found_2', title: TITLES.local_ld6_found_2, content: FOUND_2, score: 0.3, lastSessionAt: now },
      { documentId: 'local_ld6_found_3', title: TITLES.local_ld6_found_3, content: FOUND_3, score: 0.2, lastSessionAt: now },
    ],
    failed: false, degraded: false,
  } as never);
}

type Turn = { text: string; scope: 'note' | 'wide'; history: Array<{ role: 'user' | 'assistant'; content: string }>; forcedSearchQuery?: string };

async function build(turn: Turn) {
  const { result } = renderHook(() => useAIChatContext('editor'));
  return result.current.buildContext({
    text: turn.text,
    attached: linkedNote(NOTE_ID, NOTE_TEXT),
    mood: undefined,
    messageHistory: turn.history,
    isFirstTurn: turn.history.length === 0,
    scope: turn.scope,
    forcedSearchQuery: turn.forcedSearchQuery,
  } as never);
}

const hasResults = (ctx: { searchContext?: string | null | undefined }) =>
  (ctx.searchContext ?? '').includes('Результаты поиска по архиву заметок');

describe('LD-6: короткое согласие держит широкий ход', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('широкий ход с результатами, а потом «давай, собери, только без …» — результаты на месте', async () => {
    await seed();
    const wide = await build({
      text: 'посмотри, что у меня было с подрядчиком',
      scope: 'wide',
      history: [{ role: 'user', content: 'посмотри, что у меня было с подрядчиком' }],
      forcedSearchQuery: 'подрядчик сорвал срок',
    });
    expect(hasResults(wide)).toBe(true);

    // Тот же ход-сессия: второй вызов из того же хука видит липкий поиск.
    const { result } = renderHook(() => useAIChatContext('editor'));
    await result.current.buildContext({
      text: 'посмотри, что у меня было с подрядчиком',
      attached: linkedNote(NOTE_ID, NOTE_TEXT),
      mood: undefined,
      messageHistory: [{ role: 'user', content: 'посмотри, что у меня было с подрядчиком' }],
      isFirstTurn: false,
      scope: 'wide',
      forcedSearchQuery: 'подрядчик сорвал срок',
    } as never);
    const consent = await result.current.buildContext({
      text: 'давай, собери, только без истории про коллегу',
      attached: linkedNote(NOTE_ID, NOTE_TEXT),
      mood: undefined,
      messageHistory: [
        { role: 'user', content: 'посмотри, что у меня было с подрядчиком' },
        { role: 'assistant', content: PROPOSAL },
        { role: 'user', content: 'давай, собери, только без истории про коллегу' },
      ],
      isFirstTurn: false,
      scope: 'note',
    } as never);

    expect(hasResults(consent)).toBe(true);
    expect(consent.searchContext).toContain('[#local_ld6_found_1');
    // Ревью LD-6: ход расширен — и правило заметки на сервере обязано быть
    // широким, иначе «анализируй только заметку» стоит рядом с результатами.
    expect(consent.effectiveScope).toBe('wide');
  });

  it('то же согласие после СТРОГОГО хода остаётся строгим', async () => {
    await seed();
    const { result } = renderHook(() => useAIChatContext('editor'));
    await result.current.buildContext({
      text: 'разбери эту заметку',
      attached: linkedNote(NOTE_ID, NOTE_TEXT),
      mood: undefined,
      messageHistory: [{ role: 'user', content: 'разбери эту заметку' }],
      isFirstTurn: false,
      scope: 'note',
    } as never);
    const consent = await result.current.buildContext({
      text: 'давай, собери',
      attached: linkedNote(NOTE_ID, NOTE_TEXT),
      mood: undefined,
      messageHistory: [
        { role: 'user', content: 'разбери эту заметку' },
        { role: 'assistant', content: 'Заметка держится на одном образе. Хочешь, соберу из неё пост?' },
        { role: 'user', content: 'давай, собери' },
      ],
      isFirstTurn: false,
      scope: 'note',
    } as never);
    expect(hasResults(consent)).toBe(false);
    expect(consent.effectiveScope).toBeUndefined();
    // В строгом ходе блок заметки печатается без названия — сверяемся по телу.
    expect(consent.searchContext).toContain('Понедельник был рваный');
  });

  it('длинный новый запрос после широкого хода остаётся строгим', async () => {
    await seed();
    const { result } = renderHook(() => useAIChatContext('editor'));
    await result.current.buildContext({
      text: 'посмотри, что у меня было с подрядчиком',
      attached: linkedNote(NOTE_ID, NOTE_TEXT),
      mood: undefined,
      messageHistory: [{ role: 'user', content: 'посмотри, что у меня было с подрядчиком' }],
      isFirstTurn: false,
      scope: 'wide',
      forcedSearchQuery: 'подрядчик сорвал срок',
    } as never);
    const long = await result.current.buildContext({
      text: 'давай соберём пост, только без истории про коллегу, и добавь абзац про то, как я вела переговоры',
      attached: linkedNote(NOTE_ID, NOTE_TEXT),
      mood: undefined,
      messageHistory: [
        { role: 'user', content: 'посмотри, что у меня было с подрядчиком' },
        { role: 'assistant', content: PROPOSAL },
        { role: 'user', content: 'давай соберём пост, только без истории про коллегу, и добавь абзац про то, как я вела переговоры' },
      ],
      isFirstTurn: false,
      scope: 'note',
    } as never);
    expect(hasResults(long)).toBe(false);
  });

  it('согласие после широкого хода без предложения в ответе остаётся строгим', async () => {
    await seed();
    const { result } = renderHook(() => useAIChatContext('editor'));
    await result.current.buildContext({
      text: 'посмотри, что у меня было с подрядчиком',
      attached: linkedNote(NOTE_ID, NOTE_TEXT),
      mood: undefined,
      messageHistory: [{ role: 'user', content: 'посмотри, что у меня было с подрядчиком' }],
      isFirstTurn: false,
      scope: 'wide',
      forcedSearchQuery: 'подрядчик сорвал срок',
    } as never);
    const noProposal = await result.current.buildContext({
      text: 'давай',
      attached: linkedNote(NOTE_ID, NOTE_TEXT),
      mood: undefined,
      messageHistory: [
        { role: 'user', content: 'посмотри, что у меня было с подрядчиком' },
        { role: 'assistant', content: 'Нашлось три записи про подрядчика, все про перенесённые сроки.' },
        { role: 'user', content: 'давай' },
      ],
      isFirstTurn: false,
      scope: 'note',
    } as never);
    expect(hasResults(noProposal)).toBe(false);
  });

  it('согласие без приложенной заметки ничего не меняет (широкий ход и так идёт)', async () => {
    await seed();
    const ctx = await build({
      text: 'давай, собери',
      scope: 'wide',
      history: [
        { role: 'user', content: 'посмотри, что у меня было с подрядчиком' },
        { role: 'assistant', content: PROPOSAL },
        { role: 'user', content: 'давай, собери' },
      ],
    });
    expect(hasResults(ctx)).toBe(false);
  });
});
