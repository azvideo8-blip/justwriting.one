import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import {
  buildPersonQuotesBlock,
  detectPersonMentions,
} from '../personQuotes';
import { useAIChatContext } from '../../aiChatContext';
import { getLocalDb } from '../../../../../core/storage/localDb';
import { AIService } from '../../AIService';
import * as noteRetriever from '../../../utils/noteRetriever';
import { setIndexingConsent } from '../../../../../core/ai/indexingConsent';
import { markAllAnalysed } from '../../../../../test/utils/markAnalysed';

vi.mock('../../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

// DLG-Q9 (Fable T-17): отдельный блок строк человека нужен, чтобы модель
// называла расхождение реплики с записями, а не подгоняла записи под реплику.
describe('Q-9: detectPersonMentions', () => {
  const corpus = 'вчера Оля сказала, что приедет. Разговор с мамой про переезд.';

  it.each([
    ['мама против переезда', ['мама']],
    ['маме не понравится', ['мама']],
    ['у меня другие планы', []],
    ['друг друга не слышим', []],
    ['мужчина в метро', []],
    ['женщина у дома', []],
    ['братство народов', []],
    ['В понедельник', []],
    ['Оля отменила бег', ['Оля']],
  ])('«%s» → %j', (text, expected) => {
    expect(detectPersonMentions(text, { corpusText: corpus }).map(m => m.key)).toEqual(expected);
  });

  it('имя в начале реплики принимается, только если оно есть внутри записей', () => {
    expect(detectPersonMentions('Оля отменила бег', { corpusText: '' })).toEqual([]);
    expect(detectPersonMentions('Оля отменила бег', { corpusText: corpus }).map(m => m.key)).toEqual(['Оля']);
  });

  it('собственное имя пользователя — не собеседник', () => {
    expect(detectPersonMentions('Аня снова всё тянет', { selfName: 'Аня', corpusText: 'Аня пишет: устала' })).toEqual([]);
  });

  // R-5 (ревью 07.10): в профиле «имя фамилия», и сверка со строкой целиком
  // считала собственное имя чужим человеком.
  it('имя и фамилия в профиле: своё имя отсекается по каждому слову', () => {
    expect(detectPersonMentions('Вот Илья снова не спит', { selfName: 'Илья Соколов', corpusText: 'Илья не спит' })).toEqual([]);
    expect(detectPersonMentions('Вот Фёдор снова не спит', { selfName: 'фёдор соколов', corpusText: 'Фёдор не спит' })).toEqual([]);
  });

  it('не больше двух людей за ход, первые по порядку', () => {
    const found = detectPersonMentions('мама, потом Оля, потом Петя и Валя', { corpusText: 'сказала Оля, ответил Петя' });
    expect(found.map(m => m.key)).toEqual(['мама', 'Оля']);
  });
});

describe('Q-9: buildPersonQuotesBlock', () => {
  const person = detectPersonMentions('мама против переезда', {})[0]!;
  const notes = [
    { id: 'local_x', date: '2026-09-14', text: 'Тебе там не с кем, я одна, переезжай ко мне. Мама звонит каждый день.' },
    { id: 'local_y', date: '2026-09-28', text: 'Мама считает это моим долгом.' },
    { id: 'local_z', date: '2026-09-29', text: 'Про погоду и ничего больше.' },
  ];

  it('берёт только предложения с формой человека, в формате шапки и ссылки', () => {
    const block = buildPersonQuotesBlock(person, notes)!;
    expect(block.startsWith('[Что в записях говорит/делает «мама»]')).toBe(true);
    expect(block).toContain('«Мама звонит каждый день» [#local_x · 2026-09-14]');
    expect(block).toContain('«Мама считает это моим долгом» [#local_y · 2026-09-28]');
    expect(block).not.toContain('погоду');
  });

  it('лимиты: 4 строки, 200 знаков на строку, блок не длиннее 600 знаков', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `local_${i}`, date: '2026-09-14', text: `Мама сказала номер ${i}. ` + 'Длинное пояснение про кухню, переезд и планы. '.repeat(12),
    }));
    const block = buildPersonQuotesBlock(person, many)!;
    const lines = block.split('\n').slice(1);
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      const quoted = line.match(/«([^»]*)»/)?.[1] ?? '';
      expect(quoted.length).toBeLessThanOrEqual(200);
    }
    expect(block.length).toBeLessThanOrEqual(601);
  });

  it('нет строк — нет блока', () => {
    expect(buildPersonQuotesBlock(person, [{ id: 'local_z', date: '2026-09-29', text: 'Про погоду.' }])).toBeNull();
  });

  // П-5 (замер 08.10.2026): прежний шаблон `${Имя}[а-яё]*` знал только
  // именительный. Если в записях человек упоминался в косвенном падеже, блок не
  // строился — хотя реплика была именно про него. Это ошибка 0.9.33.
  it('имя в записях стоит в косвенном падеже — блок строится', () => {
    const byName = detectPersonMentions('Оля опять всё отменила', {
      corpusText: 'сегодня Оля устала, вечером говорили с Олей',
    })[0]!;
    expect(byName.key).toBe('Оля');
    const block = buildPersonQuotesBlock(byName, [
      { id: 'local_n1', date: '2026-09-14', text: 'Сегодня говорили с Олей, она устала.' },
      { id: 'local_n2', date: '2026-09-15', text: 'Оле обещал позвонить, но не позвонил.' },
      { id: 'local_n3', date: '2026-09-16', text: 'Про погоду и ничего больше.' },
    ])!;
    expect(block).toContain('говорили с Олей');
    expect(block).toContain('Оле обещал позвонить');
    expect(block).not.toContain('погоду');
  });

  it('имя из реплики в косвенном падеже находит именительный в записях', () => {
    const byName = detectPersonMentions('думал про Олю весь вечер', { corpusText: 'Оля сказала' })[0]!;
    expect(byName.key).toBe('Олю');
    const block = buildPersonQuotesBlock(byName, [
      { id: 'local_n4', date: '2026-09-14', text: 'Оля сказала, что приедет в субботу.' },
    ])!;
    expect(block).toContain('Оля сказала, что приедет в субботу');
  });
});

describe('Q-9: блок в контексте хода', () => {
  const OPEN_DOC = 'local_mom';
  const HIDDEN_DOC = 'local_hidden_mom';
  const PLAIN_DOC = 'local_plain';

  const now = () => Date.now();
  const note = (id: string, title: string, content: string, score = 0.3) => ({
    documentId: id, title, content, score, lastSessionAt: now(),
  });

  async function seed() {
    const db = await getLocalDb();
    for (const store of ['documents', 'aiSummaries', 'aiEmbeddings'] as const) {
      const all = await db.getAll(store);
      for (const rec of all) {
        await db.delete(store, (rec as { id?: string; documentId?: string }).id ?? (rec as { documentId: string }).documentId!);
      }
    }
    await db.put('documents', { id: OPEN_DOC, title: 'Звонок', currentVersion: 1, lastSessionAt: now() } as never);
    await markAllAnalysed(db);
    await db.put('documents', { id: HIDDEN_DOC, title: 'Скрытое', currentVersion: 1, lastSessionAt: now(), excludedFromAI: true } as never);
    await markAllAnalysed(db);
    await db.put('documents', { id: PLAIN_DOC, title: 'План', currentVersion: 1, lastSessionAt: now() } as never);
    await markAllAnalysed(db);

    // Основной поиск на этот ход не запускается (реплика не похожа на запрос),
    // поэтому заметку «мама» даёт только дополнительный поиск по форме имени.
    // Скрытая заметка приходит именно в его ответах — фильтр в personQuotes
    // остаётся единственной защитой.
    const search = vi.spyOn(noteRetriever, 'searchNotesMulti').mockImplementation(async (queries: string[]) => {
      const aboutPerson = queries.some(q => /^(мама|папа|Оля|друг)$|мама|Оля/i.test(q));
      return {
        notes: aboutPerson ? [
          note(OPEN_DOC, 'Звонок', 'Мама зовёт переезжать к ней: тебе там не с кем, я одна. Мама звонит каждый день.'),
          note(HIDDEN_DOC, 'Скрытое', 'Мама в скрытой заметке: против любого переезда.', 0.4),
        ] : [note(PLAIN_DOC, 'План', 'Список дел на неделю: бег, отчёт, стоматолог.')],
        failed: false,
        degraded: false,
      };
    });
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: false, error: 'err' } as never);
    vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'no quota' } as never);
    return search;
  }

  async function run(text: string, extra: Record<string, unknown> = {}) {
    const { result } = renderHook(() => useAIChatContext('coach'));
    return result.current.buildContext({
      text, attached: null, mood: undefined, messageHistory: [], isFirstTurn: true, ...extra,
    });
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
    setIndexingConsent(undefined, 'granted');
    await seed();
  });

  it('блок стоит до результатов поиска, id добавлен в allowlist цитат', async () => {
    // Явный поисковый ход: тогда в контексте есть оба блока, и видно порядок.
    const ctx = await run('мама против, хотя прямо не говорит', { forcedSearchQuery: 'мама против переезда' });
    const search = ctx.searchContext ?? '';
    expect(search).toContain('[Что в записях говорит/делает «мама»]');
    expect(search.indexOf('[Что в записях говорит/делает'))
      .toBeLessThan(search.indexOf('Результаты поиска по архиву'));
    expect(search).toContain('«Мама звонит каждый день»');
    expect(ctx.injectedDocumentIds).toContain(OPEN_DOC);
  });

  // Ревью безопасности 0.9.33: блок кэшируется на сессию, а заметку могут скрыть
  // от ИИ в другой вкладке посреди диалога. Права проверяются на каждом ходе.
  it('заметку скрыли посреди диалога — на следующем ходе её строк в блоке нет', async () => {
    const { result } = renderHook(() => useAIChatContext('coach'));
    const turn = (text: string) => result.current.buildContext({
      text, attached: null, mood: undefined, messageHistory: [], isFirstTurn: false,
    });
    const first = await turn('мама против, хотя прямо не говорит');
    expect(first.searchContext ?? '').toContain('«Мама звонит каждый день»');

    const same = await turn('мама против, хотя прямо не говорит');
    expect(same.injectedDocumentIds).toContain(OPEN_DOC);

    const db = await getLocalDb();
    const doc = await db.get('documents', OPEN_DOC);
    await db.put('documents', { ...doc, excludedFromAI: true } as never);
    await markAllAnalysed(db);
    const second = await turn('мама против, хотя прямо не говорит');
    expect(second.searchContext ?? '').not.toContain('Мама звонит каждый день');
    expect(second.injectedDocumentIds ?? []).not.toContain(OPEN_DOC);
  });

  it('скрытая от ИИ заметка в блок не попадает', async () => {
    const ctx = await run('мама против, хотя прямо не говорит');
    expect(ctx.searchContext ?? '').not.toContain('против любого переезда');
    expect(ctx.injectedDocumentIds ?? []).not.toContain(HIDDEN_DOC);
  });

  it('кризисная реплика — блока нет, архив в кризис не поднимаем', async () => {
    const ctx = await run('мама давит, и я не хочу жить');
    expect(ctx.crisis).toBe(true);
    expect(ctx.searchContext ?? '').not.toContain('[Что в записях говорит/делает');
  });

  it('светский ход — блока нет', async () => {
    const ctx = await run('привет');
    expect(ctx.searchContext ?? '').not.toContain('[Что в записях говорит/делает');
  });

  // V-5: инвариант плана MIND — на ходе чата ни одного нового вызова LLM.
  // Дополнительный поиск по человеку идёт без облачного переранжирования.
  it('дополнительный поиск по человеку не зовёт переранжирование', async () => {
    const search = await seed();
    await run('мама против, хотя прямо не говорит');
    const byPerson = search.mock.calls.filter(c => (c[0] as string[]).every(q => /^(мама|папа|Оля|друг)$/i.test(q)));
    expect(byPerson).toHaveLength(1);
    expect((byPerson[0]![2] as { skipRerank?: boolean } | undefined)?.skipRerank).toBe(true);
  });

  it('дополнительный поиск — не больше одного за ход', async () => {
    const search = await seed();
    await run('мама против, хотя прямо не говорит и Оля тоже');
    const byPerson = search.mock.calls.filter(c => (c[0] as string[]).every(q => /^(мама|папа|Оля|друг)$/i.test(q)));
    expect(byPerson).toHaveLength(1);
  });
});
