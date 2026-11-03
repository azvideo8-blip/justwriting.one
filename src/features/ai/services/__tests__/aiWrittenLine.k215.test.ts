import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { ATTACHED_QUESTION_SEP } from '../../../../shared/ai/languageNudge';
import { AI_WRITTEN_LINE, ATTACHED_BLOCK_SEP, type AttachedNoteBlock } from '../../utils/attachedNoteFormat';
import { linkedNote } from '../../../../test/attachedTurnFixtures';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

// К21-5 (случай #21, 21.3): человек оговаривает, что приложенный текст написал
// ИИ, — в блок заметки уходит строка «Текст написан ИИ…», иначе модель подаёт
// чужие формулировки как слова человека («ты писал, что…»). Фикстуры синтетические.
const FIRST = 'local_k215_first';
const SECOND = 'local_k215_second';

const FIRST_TEXT = 'Смена с шести: усталость к обеду, вечером короткая прогулка до реки.';
const SECOND_TEXT = 'Разговор с сестрой: она сказала, что я снова беру чужие сроки на себя.';

const TITLES: Record<string, string> = {
  [FIRST]: 'Утренняя смена',
  [SECOND]: 'Разговор с сестрой',
};
const CONTENT: Record<string, string> = { [FIRST]: FIRST_TEXT, [SECOND]: SECOND_TEXT };

const block = (id: string): AttachedNoteBlock => ({ documentId: id, title: TITLES[id]!, content: CONTENT[id] });

async function seed() {
  const db = await getLocalDb();
  for (const rec of await db.getAll('documents')) await db.delete('documents', (rec as { id: string }).id);
  const now = Date.now();
  for (const [i, id] of Object.keys(CONTENT).entries()) {
    await db.put('documents', {
      id, guestId: 'u1', title: TITLES[id], currentVersion: 1, totalWords: 20, totalDuration: 60,
      sessionsCount: 1, firstSessionAt: now - i * 86_400_000, lastSessionAt: now - i * 86_400_000, tags: [],
    } as never);
  }
  vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) => CONTENT[id] ?? '');
}

async function build(params: {
  text: string;
  attached: { blocks: AttachedNoteBlock[]; fromLink?: true } | null;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}) {
  const history = params.history ?? [];
  const rendered = renderHook(() => useAIChatContext('coach'));
  const ctx = await rendered.result.current.buildContext({
    text: params.text,
    attached: params.attached,
    mood: undefined,
    messageHistory: history.length > 0 ? history : [{ role: 'user', content: params.text }],
    isFirstTurn: history.length === 0,
    scope: 'note',
  } as never);
  return ctx;
}

/** Блоки хода так, как их видит модель. */
const parts = (ctx: { searchContext?: string | null | undefined }): string[] =>
  (ctx.searchContext ?? '').split(ATTACHED_BLOCK_SEP);

describe('К21-5: строка «Текст написан ИИ» в блоке заметки', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('оговорка в реплике этого хода — строка в блоке, тело на месте', async () => {
    await seed();
    const ctx = await build({ text: 'Это сводка от ИИ, разбери её.', attached: linkedNote(FIRST, FIRST_TEXT) });
    expect(ctx.searchContext).toContain(AI_WRITTEN_LINE);
    expect(ctx.searchContext).toContain(FIRST_TEXT);
  });

  it('без оговорки строки нет', async () => {
    await seed();
    const ctx = await build({ text: 'Разбери эту заметку.', attached: linkedNote(FIRST, FIRST_TEXT) });
    expect(ctx.searchContext).not.toContain(AI_WRITTEN_LINE);
    expect(ctx.searchContext).toContain(FIRST_TEXT);
  });

  it('оговорка называет одну из двух заметок — строка только у неё', async () => {
    await seed();
    const ctx = await build({
      text: '«Разговор с сестрой» — это от ИИ, а первая моя.',
      attached: { blocks: [block(FIRST), block(SECOND)] },
    });
    const got = parts(ctx);
    expect(got).toHaveLength(2);
    expect(got[0]).toContain(TITLES[FIRST]);
    expect(got[0]).not.toContain(AI_WRITTEN_LINE);
    expect(got[1]).toContain(TITLES[SECOND]);
    expect(got[1]).toContain(AI_WRITTEN_LINE);
  });

  it('оговорку без названия нельзя отнести к одной — строка у обеих (в отчёт)', async () => {
    await seed();
    const ctx = await build({ text: 'Это от ИИ.', attached: { blocks: [block(FIRST), block(SECOND)] } });
    expect(parts(ctx).filter(p => p.includes(AI_WRITTEN_LINE))).toHaveLength(2);
  });

  it('оговорка в прошлом ходе действует и на этом', async () => {
    await seed();
    const ctx = await build({
      text: 'А что там про смену?',
      attached: { blocks: [block(FIRST)] },
      history: [
        { role: 'user', content: `[#${FIRST} · 2026-10-30]\n[Прикреплена заметка: "${TITLES[FIRST]}"]\n${FIRST_TEXT}${ATTACHED_QUESTION_SEP}это суммирование от ИИ` },
        { role: 'assistant', content: 'Понял, смотрю на текст как на чужой.' },
        { role: 'user', content: 'А что там про смену?' },
      ],
    });
    expect(ctx.searchContext).toContain(AI_WRITTEN_LINE);
  });

  it('оговорка в теле заметки не работает: читается только реплика человека', async () => {
    await seed();
    const ctx = await build({
      text: 'Разбери эту заметку.',
      attached: linkedNote(FIRST, `${FIRST_TEXT} Это от ИИ — так написано в самой записи.`),
    });
    expect(ctx.searchContext).not.toContain(AI_WRITTEN_LINE);
  });

  it('оговорка в теле заметки прошлого хода тоже не работает', async () => {
    await seed();
    // Старый ход с вложением: тело и вопрос одной строкой, без разделителя —
    // отделить реплику человека от текста заметки нельзя, ход пропускается.
    const ctx = await build({
      text: 'А что там про смену?',
      attached: { blocks: [block(FIRST)] },
      history: [
        { role: 'user', content: `[Прикреплена заметка: "${TITLES[SECOND]}"]\n${SECOND_TEXT} Это сводка от ИИ.` },
        { role: 'assistant', content: 'Смотрю на текст как на пересказ.' },
        { role: 'user', content: 'А что там про смену?' },
      ],
    });
    expect(ctx.searchContext).not.toContain(AI_WRITTEN_LINE);
  });
});
