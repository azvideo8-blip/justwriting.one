import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AIService } from '../AIService';
import * as noteRetriever from '../../utils/noteRetriever';
import { turnScope } from '../../utils/turnScope';
import { asksForSimilarNotes } from '../../utils/aiChatTransport';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

// DLG-Q7 (Fable T-11) — с отклонением от Fable: он искал причину в Редакторе, а
// ломается ход раньше. При приложенной заметке реплика «поищи похожие темы» не
// совпадала с RELATION_MARKERS → режим 'note' → контекст возвращается вообще без
// поиска, и модель честно отвечает «ничего не нашлось».
describe('Q-7: turnScope слышит просьбы о других записях', () => {
  it.each([
    ['добавь немного личного, поищи похожие темы', 'wide'],
    ['другие заметки ещё посмотри', 'wide'],
    ['из других заметок добавь', 'wide'],
    ['разбери эту заметку', 'note'],
    ['сделай пост', 'note'],
    ['что тут главное?', 'note'],
  ])('%s → %s', (text, expected) => {
    expect(turnScope(text)).toBe(expected);
  });
});

describe('Q-7: asksForSimilarNotes', () => {
  it('просьба без своей темы — true, со своей — false', () => {
    expect(asksForSimilarNotes('ещё посмотри другие заметки')).toBe(true);
    expect(asksForSimilarNotes('другие заметки про маму')).toBe(false);
    expect(asksForSimilarNotes('привет')).toBe(false);
    expect(asksForSimilarNotes('добавь немного личного, поищи похожие темы')).toBe(true);
  });
});

describe('Q-7: запрос строится из приложенной заметки', () => {
  const ATTACHED_ID = 'local_att';
  const OTHER_ID = 'local_other';

  async function seed(summary: Record<string, unknown> | null, attachedDoc: Record<string, unknown> = {}) {
    const db = await getLocalDb();
    for (const store of ['documents', 'aiSummaries', 'aiEmbeddings'] as const) {
      const all = await db.getAll(store);
      for (const rec of all) {
        await db.delete(store, (rec as { id: string; documentId?: string }).id || (rec as { documentId: string }).documentId);
      }
    }
    await db.put('documents', {
      id: ATTACHED_ID, title: 'Утро перед стартом', currentVersion: 1, lastSessionAt: Date.now(), ...attachedDoc,
    } as never);
    await db.put('documents', { id: OTHER_ID, title: 'Тренировка', currentVersion: 1, lastSessionAt: Date.now() - 86_400_000 } as never);
    if (summary) await db.put('aiSummaries', { documentId: ATTACHED_ID, processedAt: Date.now(), ...summary } as never);

    const notes = [ATTACHED_ID, OTHER_ID].map(id => ({
      documentId: id, title: id === ATTACHED_ID ? 'Утро перед стартом' : 'Тренировка',
      content: 'Бег, усталость, план на неделю', score: 0.2, lastSessionAt: Date.now(),
    }));
    const search = vi.spyOn(noteRetriever, 'searchNotesMulti').mockResolvedValue({ notes, failed: false, degraded: false } as never);
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: false, error: 'err' } as never);
    vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'no quota' } as never);
    return search;
  }

  async function run(text: string, attachedContent: string) {
    const { result } = renderHook(() => useAIChatContext('editor'));
    return result.current.buildContext({
      text,
      attached: { content: attachedContent, documentId: ATTACHED_ID },
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
      scope: 'wide',
    });
  }

  const TURN = 'другие заметки ещё посмотри';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('с разбором: ищем по разбору, а не по тексту реплики; приложенная исключена', async () => {
    const search = await seed({ summary: 'Про бег и усталость перед стартом', themes: ['Бег', 'усталость', 'мама'] });
    const ctx = await run(TURN, 'Тело приложенной заметки про утренний бег.');

    expect(search).toHaveBeenCalled();
    const query = search.mock.calls[0]![0]!.join(' ');
    expect(query).toContain('Бег');
    expect(query).not.toBe(TURN);
    expect(query).not.toContain('ещё посмотри');
    // приложенная заметка уже в контексте отдельным блоком
    expect(ctx.searchContext).not.toMatch(new RegExp(`\\[#${ATTACHED_ID} · [^\\]]*\\]\\nЗаметка`));
    expect(ctx.searchContext).toContain('Заметка');
  });

  it('без разбора: запрос из названия и начала тела', async () => {
    const search = await seed(null);
    await run(TURN, 'Утренний бег, пульс и разговор с мамой про переезд. ' + 'Дальше много текста. '.repeat(80));
    const query = search.mock.calls[0]![0]!.join(' ');
    expect(query).toContain('Утро перед стартом');
    expect(query).toContain('разговор с мамой');
    expect(query).not.toContain('ещё посмотри');
  });

  it('скрытая от ИИ приложенная заметка: её тело в поисковый запрос не попадает', async () => {
    const search = await seed(null, { excludedFromAI: true });
    await run(TURN, 'SECRET тело заметки, скрытой от ИИ. ' + 'Ещё строки. '.repeat(40));
    const queries = search.mock.calls.map(c => c[0]!.join(' '));
    for (const q of queries) expect(q).not.toContain('SECRET');
  });

  it('ничего не найдено — в контекст уходит явная строка о поиске похожих', async () => {
    await seed({ summary: 'Про бег', themes: ['Бег'] });
    vi.spyOn(noteRetriever, 'searchNotesMulti').mockResolvedValue({ notes: [], failed: false, degraded: false } as never);
    const ctx = await run(TURN, 'Тело про бег.');
    expect(ctx.searchContext ?? '').toContain('[Поиск похожих записей: ничего не найдено');
  });
});
