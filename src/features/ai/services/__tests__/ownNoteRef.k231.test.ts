import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { AIService } from '../../services/AIService';
import * as noteRetriever from '../../utils/noteRetriever';
import { referencedOwnTopics } from '../../utils/aiChatTransport';
import { linkedNote } from '../../../../test/attachedTurnFixtures';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

// К23-1 (случай #23): при приложенной заметке реплика «как я писал про X» —
// отсылка к другой своей записи. Ход был строгим, поиска не было, и модель
// отвечала «в материалах нет». Теперь ход ищет по X, заметка остаётся на месте.
// Мутации: referencedOwnTopics → [] в aiChatContext — (a) красный; без preSearchIds —
// красный «пустой поиск»; без THIS_NOTE_REF — красная таблица «не тема».
// Фикстуры синтетические.
const NOTE_ID = 'local_k231_note';
const NOTE_TEXT = 'Сегодня опять засиделась над отчётом, к вечеру голова пустая.';
const FOUND_ID = 'local_k231_found';
const FOUND_TEXT = 'Про переезд: коробки третью неделю стоят в коридоре, разбирать некому.';

const searchSpy = () => vi.spyOn(noteRetriever, 'searchNotesMulti');

async function seed() {
  const db = await getLocalDb();
  for (const store of ['documents', 'aiSummaries', 'aiEmbeddings', 'versions'] as const) {
    for (const rec of await db.getAll(store)) {
      const key = (rec as { id?: string; documentId?: string }).id ?? (rec as { documentId: string }).documentId!;
      await db.delete(store, key as string);
    }
  }
  const now = Date.now();
  for (const [i, id] of [NOTE_ID, FOUND_ID].entries()) {
    await db.put('documents', {
      id, guestId: 'u1', title: id === NOTE_ID ? 'Отчёт' : 'Переезд', currentVersion: 1, totalWords: 20, totalDuration: 60,
      sessionsCount: 1, firstSessionAt: now - i * 86_400_000 * 30, lastSessionAt: now - i * 86_400_000 * 30, tags: [],
    } as never);
  }
  const content: Record<string, string> = { [NOTE_ID]: NOTE_TEXT, [FOUND_ID]: FOUND_TEXT };
  vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) => content[id] ?? '');
  vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue(
    [NOTE_ID, FOUND_ID].map(id => ({ documentId: id, vectors: [[1, 0]], contentHash: `h${id}`, processedAt: now, model: 'm', dim: 2 })) as never,
  );
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[1, 0]] } as never);
  vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'SERVER_ERROR' } as never);
  searchSpy().mockResolvedValue({
    notes: [{ documentId: FOUND_ID, title: 'Переезд', content: FOUND_TEXT, score: 0.5, lastSessionAt: now }],
    failed: false, degraded: false,
  } as never);
}

async function build(text: string) {
  const { result } = renderHook(() => useAIChatContext('reflection'));
  return result.current.buildContext({
    text,
    attached: linkedNote(NOTE_ID, NOTE_TEXT),
    mood: undefined,
    messageHistory: [{ role: 'user', content: text }],
    isFirstTurn: true,
    scope: 'note',
  } as never);
}

describe('К23-1: отсылка к своей записи при приложенной заметке', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('(a) «как я писал про переезд» — поиск по теме, запись в выдаче, заметка на месте', async () => {
    await seed();
    const ctx = await build('это похоже на то, как я писал про переезд');
    const queries = searchSpy().mock.calls.map(c => JSON.stringify(c[0]));
    expect(queries.some(q => q.includes('переезд'))).toBe(true);
    expect(ctx.searchContext).toContain(`[#${FOUND_ID}`);
    expect(ctx.injectedDocumentIds).toContain(FOUND_ID);
    expect(ctx.searchContext).toContain('засиделась над отчётом');
    expect(ctx.effectiveScope).toBe('wide');
  });

  it.each([
    'как я писал выше, всё сложно',
    'я писал об этом в этой заметке',
    'писал про это сегодня утром',
    'что ты думаешь про эту усталость?',
  ])('(b) «%s» — ход строгий, поиска нет', async (text) => {
    await seed();
    const ctx = await build(text);
    expect(searchSpy()).not.toHaveBeenCalled();
    expect(ctx.injectedDocumentIds).not.toContain(FOUND_ID);
    expect(ctx.effectiveScope).toBeUndefined();
    expect(ctx.searchContext).toContain('засиделась над отчётом');
  });
});

describe('К23-1: пустой поиск при ссылке в теле заметки (ревью 0.11.13)', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('заметка цитирует запись, поиск по теме пуст — ход для сервера не широкий', async () => {
    await seed();
    searchSpy().mockResolvedValue({ notes: [], failed: false, degraded: false } as never);
    const body = `${NOTE_TEXT} Про коробки было тут [#${FOUND_ID}].`;
    const { result } = renderHook(() => useAIChatContext('reflection'));
    const text = 'как я писал про отпуск';
    const ctx = await result.current.buildContext({
      text, attached: linkedNote(NOTE_ID, body), mood: undefined,
      messageHistory: [{ role: 'user', content: text }], isFirstTurn: true, scope: 'note',
    } as never);
    expect(ctx.injectedDocumentIds).toContain(FOUND_ID);
    expect(ctx.effectiveScope).toBeUndefined();
  });
});

describe('К23-1: распознавание темы в реплике', () => {
  it.each([
    ['как я писал про переезд', ['переезд']],
    ['я писал о маме и сестре', ['маме']],
    ['в записи про отпуск было иначе', ['отпуск']],
    ['я уже писал про работу', ['работу']],
  ])('«%s» → %j', (text, want) => {
    expect(referencedOwnTopics(text)).toEqual(want);
  });

  it.each([
    'я писал про это', 'я писал об этом', 'как я писал выше', 'я писал про работу в этой заметке', 'про переезд',
    // ревью 0.11.13: про саму заметку и местоимения
    'В этой заметке я писал про отца, что думаешь?', 'Здесь я писал о маме', 'как я писал про неё', 'я писал про него',
    'я писал о себе', 'я писал про то же самое', 'я писал о нем',
  ])('«%s» → не тема', (text) => {
    expect(referencedOwnTopics(text)).toEqual([]);
  });
});
