// Строгий ход по приложенной заметке: в контекст идёт только она. Раньше поиск,
// хронология и память запускались по тексту хода, и модель выдавала цитаты из
// других записей за текст приложенной (разбор «от 29 июля» для заметки от 29 сентября).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AIMemoryAssembler } from '../AIMemoryAssembler';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ language: 'ru', t: (k: string) => k }),
}));

const ATTACHED_ID = 'doc_strict_1';
const ATTACHED_CONTENT = 'Текст приложенной заметки про часы и выбор';

async function build(scope: 'note' | 'wide') {
  const { result } = renderHook(() => useAIChatContext('coach'));
  return result.current.buildContext({
    text: 'сравни январь и февраль',
    attached: { documentId: ATTACHED_ID, content: ATTACHED_CONTENT },
    mood: undefined,
    messageHistory: [],
    isFirstTurn: true,
    scope,
  });
}

describe('приложенная заметка: строгий и широкий ход', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    const db = await getLocalDb();
    await db.put('documents', { id: ATTACHED_ID, title: 'Аскеза', currentVersion: 1, lastSessionAt: Date.now() } as never);
  });

  it('строгий ход: только заметка — ни сравнения периодов, ни памяти', async () => {
    const assemble = vi.spyOn(AIMemoryAssembler, 'assembleMemoryContext');
    const ctx = await build('note');
    expect(ctx.searchContext).toContain(ATTACHED_CONTENT);
    expect(ctx.searchContext).not.toContain('РЕЖИМ СРАВНЕНИЯ');
    expect(ctx.searchContext).not.toContain('Результаты поиска');
    expect(ctx.memoryContext).toBeNull();
    expect(assemble).not.toHaveBeenCalled();
  });

  it('широкий ход: механизмы контекста работают, как раньше', async () => {
    const ctx = await build('wide');
    expect(ctx.searchContext).toContain(ATTACHED_CONTENT);
    expect(ctx.searchContext).toContain('РЕЖИМ СРАВНЕНИЯ');
  });
});

describe('кризис в приложенной заметке', () => {
  it('строгий ход с вопросом «разбери» всё равно даёт телефоны помощи', async () => {
    const db = await getLocalDb();
    await db.put('documents', { id: 'doc_risk', title: 'Ночь', currentVersion: 1, lastSessionAt: Date.now() } as never);
    const { result } = renderHook(() => useAIChatContext('coach'));
    const ctx = await result.current.buildContext({
      text: 'Разбери эту заметку',
      attached: { documentId: 'doc_risk', content: 'Каждую ночь думаю про суицид.' },
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
      scope: 'note',
    });
    expect(ctx.searchContext).toContain('8-800-333-44-34');
  });
});
