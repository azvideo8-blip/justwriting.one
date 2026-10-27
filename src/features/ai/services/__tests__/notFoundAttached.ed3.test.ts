import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import * as noteRetriever from '../../utils/noteRetriever';
import { linkedNote } from '../../../../test/attachedTurnFixtures';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

// ED-3: на ходе с приложенной заметкой модель не должна получать и «в базе ничего
// не нашлось», и совет приложить заметку — два блока противоречили друг другу.
const ATTACHED_ID = 'local_att';

async function seed() {
  const db = await getLocalDb();
  for (const store of ['documents', 'aiSummaries'] as const) {
    const all = await db.getAll(store);
    for (const rec of all) {
      const key = (rec as { id?: string; documentId?: string }).id ?? (rec as { documentId: string }).documentId!;
      await db.delete(store, key as string);
    }
  }
  await db.put('documents', { id: ATTACHED_ID, title: 'Утро', currentVersion: 1, lastSessionAt: Date.now() } as never);
  await db.put('aiSummaries', { documentId: ATTACHED_ID, processedAt: Date.now(), summary: 'Про бег и усталость', themes: ['Бег'] } as never);
  vi.spyOn(noteRetriever, 'searchNotesMulti').mockResolvedValue({ notes: [], failed: false, degraded: false } as never);
}

async function build(text: string, raw: { content: string; documentId: string } | undefined, scope: 'wide' | 'note') {
  const attached = raw ? linkedNote(raw.documentId, raw.content) : null;
  const { result } = renderHook(() => useAIChatContext('editor'));
  const ctx = await result.current.buildContext({
    text, attached, mood: undefined, messageHistory: [], isFirstTurn: true, scope,
  } as never);
  return ctx.searchContext ?? '';
}

const GENERIC = 'по этому запросу в базе ничего не нашлось';
const SIMILAR = '[Поиск похожих записей: ничего не найдено';
const ATTACHED_HINT = 'Заметка приложена и у тебя есть — не проси приложить её.';

describe('ED-3: «ничего не нашлось» при приложенной заметке', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('похожие записи + приложенная заметка: одно сообщение о ненайденном, плюс строка про приложенную', async () => {
    await seed();
    const ctx = await build('другие заметки ещё посмотри', { content: 'Тело заметки про утренний бег.', documentId: ATTACHED_ID }, 'wide');
    expect(ctx).toContain(SIMILAR);
    expect(ctx).toContain(ATTACHED_HINT);
    expect(ctx).not.toContain(GENERIC);
    expect(ctx).not.toContain('Поиск по ВСЕЙ базе');
  });

  it('без приложенной заметки явный поиск остаётся с прежним общим сообщением', async () => {
    await seed();
    const ctx = await build('поищи в архиве заметки про ремонт кухни', undefined, 'wide');
    expect(ctx).toContain(GENERIC);
    expect(ctx).not.toContain(SIMILAR);
    expect(ctx).not.toContain(ATTACHED_HINT);
  });

  // Скрытая от ИИ приложенная заметка в контекст не попадает вовсе. Значит и
  // совет «не проси приложить — она есть» ей показывать нельзя: модель осталась
  // бы без текста, но с обещанием, что текст под рукой.
  it('приложенная заметка скрыта от ИИ: строки про приложенную нет, тела заметки нет', async () => {
    const db = await getLocalDb();
    await db.put('documents', { id: ATTACHED_ID, title: 'Утро', currentVersion: 1, lastSessionAt: Date.now(), excludedFromAI: true } as never);
    const ctx = await build(
      'поищи в архиве заметки про ремонт кухни',
      { content: 'SECRET тело заметки, скрытой от ИИ, про ремонт кухни.', documentId: ATTACHED_ID },
      'wide',
    );
    expect(ctx).toContain(GENERIC);
    expect(ctx).not.toContain(ATTACHED_HINT);
    expect(ctx).not.toContain('SECRET');
  });
});
