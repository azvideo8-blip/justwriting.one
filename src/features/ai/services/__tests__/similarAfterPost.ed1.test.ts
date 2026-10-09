import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { AIService } from '../../services/AIService';
import * as noteRetriever from '../../utils/noteRetriever';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

// ED-1: после готового поста «эта тема» — тема поста, а не разбор всей заметки.
// Диагноз шага 1 на этом же архиве: запрос строился из summary+themes, блок
// приходил НЕ пустым, а размытым — 9 заметок, из них 6 про другие темы заметки.
const ATTACHED = 'local_multi';

const CONTENT: Record<string, string> = {
  [ATTACHED]:
    'Утро до дедлайна. Сдавал отчётность, потом звонок юристу по договору аренды. Вечером скалодром: зацепы, трасса 6A. ' +
    'Мама просила торт на день рождения, а сантехник всё ещё не пришёл менять плитку в ванной.',
  local_wall_1: 'Скалодром вечером: новые зацепы на трассе 6A, левое предплечье гудит, но связка вышла.',
  local_wall_2: 'Трасса 6A наконец взята с первого подхода. Зацепы мелкие, держались только на замагленных пальцах.',
  local_wall_3: 'Забрал абонемент на скалодром, тренер показал работу ног на зацепах. Планирую трассу 6A к субботе.',
  local_tax_1: 'Отдал отчётность в налоговой, потребовались цифры за третий квартал.',
  local_tax_2: 'Проверка отчётности: не сходились две строки, весь вечер с таблицами.',
  local_law_1: 'Юрист по договору аренды: арендодатель не хочет менять пункт о депозите.',
  local_law_2: 'Договор аренды прочитан, два пункта к обсуждению.',
  local_mom_1: 'Мама просит торт на день рождения, клубничный, и чтобы свечи были длинные.',
  local_bath_1: 'Сантехник перенёс визит: менять плитку в ванной будем в следующем месяце.',
  local_run_1: 'Пробежал шесть километров вдоль реки, пульс держался.',
  local_book_1: 'Дочитал роман про архивиста, финал показлся натянутым.',
};

const TITLES: Record<string, string> = {
  [ATTACHED]: 'Утро до дедлайна',
  local_wall_1: 'Скалодром, зацепы',
  local_wall_2: 'Трасса 6A взята',
  local_wall_3: 'Абонемент и работа ног',
  local_tax_1: 'Отчётность сдана',
  local_tax_2: 'Цифры за квартал',
  local_law_1: 'Договор аренды',
  local_law_2: 'Пункты договора',
  local_mom_1: 'Торт для мамы',
  local_bath_1: 'Плитка в ванной',
  local_run_1: 'Шесть километров',
  local_book_1: 'Роман про архивиста',
};

const POST =
  'Скалодром выигрывается не руками, а терпением к мелким зацепам.\n' +
  'Трасса 6A держалась три недели и сегодня наконец взята с первого подхода.\n' +
  '\n— — —\n' +
  'Из заметок: [#local_multi]';

const TURN = 'поищи ещё записи на эту тему и допиши в пост';
const ALL_IDS = Object.keys(CONTENT);

async function seed(extra: Record<string, Record<string, unknown>> = {}) {
  const db = await getLocalDb();
  for (const store of ['documents', 'aiSummaries', 'aiEmbeddings', 'versions'] as const) {
    const all = await db.getAll(store);
    for (const rec of all) {
      const key = (rec as { id?: string; documentId?: string }).id ?? (rec as { documentId: string }).documentId!;
      await db.delete(store, key as string);
    }
  }
  const now = Date.now();
  for (const [i, id] of ALL_IDS.entries()) {
    await db.put('documents', {
      id, guestId: 'u1', title: TITLES[id], currentVersion: 1,
      totalWords: 20, totalDuration: 60, sessionsCount: 1,
      firstSessionAt: now - i * 86_400_000, lastSessionAt: now - i * 86_400_000, tags: [],
      ...extra[id],
    } as never);
  }
  await db.put('aiSummaries', {
    documentId: ATTACHED, processedAt: now,
    summary: 'Один день: отчётность, юрист по договору аренды, скалодром, торт для мамы и плитка в ванной.',
    themes: ['Отчётность', 'Договор аренды', 'Скалолазание', 'День рождения мамы', 'Ремонт ванной'],
  } as never);

  vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) => CONTENT[id] ?? '');
  // Индекс есть, но к тексту отношения не имеет — решает слово.
  vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue(
    ALL_IDS.map(id => ({ documentId: id, vectors: [[id === ATTACHED ? 1 : 0, id === ATTACHED ? 0 : 1]], contentHash: `h${id}`, processedAt: now, model: 'm', dim: 2 })) as never,
  );
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[0, 1]] } as never);
  vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'SERVER_ERROR' } as never);
}

async function run(history: Array<{ role: 'user' | 'assistant'; content: string }>) {
  const { result } = renderHook(() => useAIChatContext('editor'));
  return result.current.buildContext({
    text: TURN,
    attached: { content: CONTENT[ATTACHED]!, documentId: ATTACHED },
    mood: undefined,
    messageHistory: history,
    isFirstTurn: history.length === 0,
    scope: 'wide',
  } as never);
}

const queryOf = (calls: unknown[][]) => calls.map(c => (c[0] as string[]).join(' '));

describe('ED-1: после поста ищем по теме поста', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('запрос строится из поста, а не из разбора всей заметки; в блоке — заметки темы поста', async () => {
    await seed();
    const spy = vi.spyOn(noteRetriever, 'searchNotesMulti');
    const ctx = await run([
      { role: 'user', content: 'сделай пост про скалодром' },
      { role: 'assistant', content: POST },
    ]);

    const queries = queryOf(spy.mock.calls);
    const joined = queries.join(' ');
    expect(joined).toContain('Скалодром');
    expect(joined).toContain('Трасса 6A');
    // Чужие темы той же заметки в запрос не едут.
    for (const foreign of ['отчётность', 'договор', 'торт', 'плитка']) {
      expect(joined.toLowerCase()).not.toContain(foreign);
    }

    const block = (ctx.searchContext ?? '').split('Результаты поиска по архиву заметок')[1] ?? '';
    for (const id of ['local_wall_1', 'local_wall_2', 'local_wall_3']) {
      expect(block, `нет ${id} в блоке`).toContain(`[#${id} `);
    }
    expect(block).not.toMatch(new RegExp(`\\[#${ATTACHED} · [^\\]]*\\]\\nЗаметка`));
  });

  it('первый ход без ответа ИИ — запрос по-прежнему из разбора заметки', async () => {
    await seed();
    const spy = vi.spyOn(noteRetriever, 'searchNotesMulti');
    await run([]);
    const joined = queryOf(spy.mock.calls).join(' ');
    expect(joined).toContain('Отчётность');
    expect(joined).toContain('Ремонт ванной');
  });

  it('последний ответ ссылается на заметку, скрытую от ИИ: берём разбор, тело скрытой ни в запрос, ни в контекст', async () => {
    await seed({ local_law_1: { excludedFromAI: true } });
    const spy = vi.spyOn(noteRetriever, 'searchNotesMulti');
    const ctx = await run([
      { role: 'user', content: 'сделай пост' },
      { role: 'assistant', content: `Договор аренды буксует: арендодатель не уступает в депозите.\n\n— — —\nИз заметок: [#local_law_1]` },
    ]);

    const queries = queryOf(spy.mock.calls);
    for (const q of queries) {
      expect(q).not.toContain('арендодатель не уступает');
      expect(q).not.toContain('Юрист по договору аренды:');
    }
    // Фолбэк — разбор заметки.
    expect(queries.join(' ')).toContain('Отчётность');
    expect(ctx.searchContext ?? '').not.toContain('депозите');
  });

  // Тот же guard на втором условии: заметку выбросили в корзину после ответа.
  it('последний ответ ссылается на заметку в корзине: берём разбор, её тело не в запросе', async () => {
    await seed({ local_law_2: { trashedAt: Date.now() } });
    const spy = vi.spyOn(noteRetriever, 'searchNotesMulti');
    await run([
      { role: 'user', content: 'сделай пост' },
      { role: 'assistant', content: `Договор прочитан, два пункта к обсуждению.\n\n— — —\nИз заметок: [#local_law_2]` },
    ]);
    const joined = queryOf(spy.mock.calls).join(' ');
    expect(joined).not.toContain('два пункта к обсуждению');
    expect(joined).toContain('Отчётность');
  });

  it('keywordScore на таком ходе считается по запросу, а не по тексту реплики', async () => {
    await seed();
    const now = Date.now();
    vi.spyOn(noteRetriever, 'searchNotesMulti').mockResolvedValue({
      notes: [
        { documentId: 'local_book_1', title: TITLES.local_book_1, content: CONTENT.local_book_1, score: 0.2, lastSessionAt: now },
        { documentId: 'local_wall_1', title: TITLES.local_wall_1, content: CONTENT.local_wall_1, score: 0.2, lastSessionAt: now },
      ],
      failed: false, degraded: false,
    } as never);
    const ctx = await run([
      { role: 'user', content: 'сделай пост про скалодром' },
      { role: 'assistant', content: POST },
    ]);
    const block = (ctx.searchContext ?? '').split('Результаты поиска по архиву заметок')[1] ?? '';
    //OPT-7: лучшие заметки кладутся последними (ближе к запросу), поэтому
    // «выиграл» — тот, у кого номер «Заметка N» больше.
    const idx = (title: string) => Number(block.match(new RegExp(`Заметка (\\d+): "${title}"`))?.[1] ?? -1);
    expect(idx('Скалодром, зацепы'), 'пост-тематическая заметка должна идти ближе к запросу').toBeGreaterThan(idx('Роман про архивиста'));
  });
});
