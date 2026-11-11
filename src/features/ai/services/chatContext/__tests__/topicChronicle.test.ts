// Хроника по вопросу (стенд ai-memory-base-fable-2026-11).
//
// Вопрос о прошлом получал три куска лёгкого поиска. На стенде (52 вопроса, 326
// заметок) эталонная заметка доходила до хода в 60 % случаев; с хроникой — в 89 %.
//
// Мутации, на которых тесты краснеют:
//  - убрать `.sort((a, b) => a.n.at - b.n.at)` у ленты → «лента идёт по датам»;
//  - убрать `isExcludedFromAI(d)` в `buildTopicChronicleBlock` → «скрытая и корзинная»;
//  - заменить `CHRONICLE_FLOOR` на 0 → «далёкая заметка не попадает»;
//  - убрать `forcedIds` из ленты → «заметка с именем входит при низкой близости»;
//  - вернуть `[]` из `dates` → «даты ленты разрешены стражу дат»;
//  - вернуть `QUESTION_RE.test(text) ? 'fact' : null` в chronicleModeOf → «совет
//    без вопроса о записях хронику не поднимает»;
//  - вернуть суть из разбора в строку ленты → «в строке только дата и дословный отрывок».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  chronicleModeOf, pickExcerpt, queryStems, buildTopicChronicle, buildTopicChronicleBlock,
  CHRONICLE_MAX_LINES, FOCUS_NOTES, CHRONICLE_V2, type ChronicleNote,
} from '../topicChronicle';
import { ARCHIVE_TURN_MARK } from '../../../../../shared/ai/archiveAnswerRule';
import { AIEmbeddingService } from '../../AIEmbeddingService';
import { getLocalDb } from '../../../../../core/storage/localDb';

vi.mock('../../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const TURN = [1, 0, 0];
const vec = (c: number): number[] => [c, Math.sqrt(Math.max(0, 1 - c * c)), 0];
const day = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
const CORPUS = { total: 300, from: '2025-06-01', to: '2026-10-06' };

const note = (id: string, iso: string, cos: number, text: string): ChronicleNote =>
  ({ id, at: day(iso), title: `Заметка ${id}`, chunks: [text], vectors: [vec(cos)] });

describe('chronicleModeOf', () => {
  it.each([
    ['когда я впервые начал думать о смене работы', 'first'],
    ['когда Оля в первый раз заговорила про бег?', 'first'],
    ['как менялось моё отношение к терапии за осень', 'evolution'],
    ['что я решила насчёт переезда', 'decision'],
    ['что я пообещала себе после разговора', 'decision'],
    ['к какому сроку я решила определиться?', 'decision'],
    ['что я писала про маму', 'all'],
    ['все записи про брата', 'all'],
    ['какой торт я везла к брату', 'fact'],
  ])('«%s» → %s', (text, mode) => {
    expect(chronicleModeOf(text)).toBe(mode);
  });

  it('рассказ и просьба без вопроса хронику не поднимают', () => {
    expect(chronicleModeOf('сегодня поругалась с мамой, тяжело')).toBeNull();
    expect(chronicleModeOf('помоги составить план на неделю')).toBeNull();
  });

  it('совет и вопрос в настоящем времени без человека и периода хронику не поднимают', () => {
    expect(chronicleModeOf('что мне делать с этой тревогой?')).toBeNull();
    expect(chronicleModeOf('как справиться с тревогой перед собеседованием?')).toBeNull();
    expect(chronicleModeOf('что говорит брат про переезд?')).toBeNull();
    // Ревью 0.11.10: существительное на -ли/-ла — не прошедшее время.
    expect(chronicleModeOf('какие у меня цели?')).toBeNull();
    expect(chronicleModeOf('как наладить дела?')).toBeNull();
    expect(chronicleModeOf('что мне делать, если я не могу уснуть?')).toBeNull();
    expect(chronicleModeOf('что я вчера ела?')).toBe('fact');
    // «в июне» ход распознаёт как период — он и включает хронику.
    expect(chronicleModeOf('сколько весил пёс в июне?')).toBeNull();
    expect(chronicleModeOf('сколько весил пёс в июне?', { period: true })).toBe('fact');
  });

  it('названный человек или период открывают режим fact и без прошедшего времени', () => {
    expect(chronicleModeOf('что говорит брат про переезд?', { person: true })).toBe('fact');
    expect(chronicleModeOf('какая сумма на счёте в конце сентября?', { period: true })).toBe('fact');
    expect(chronicleModeOf('какая сумма на счёте в конце сентября?')).toBeNull();
  });
});

describe('pickExcerpt', () => {
  it('берёт предложение со словами вопроса, а не начало куска', () => {
    const chunk = 'Утром шёл дождь. На работе тихо. Вечером решила: до нового года определяюсь с переездом. Потом спала.';
    const out = pickExcerpt(chunk, queryStems('что я решила насчёт переезда'));
    expect(out.startsWith('Вечером решила: до нового года определяюсь с переездом.')).toBe(true);
  });

  it('отрывок дословный и не длиннее предела', () => {
    const chunk = `${'Длинное предложение про переезд и всё остальное. '.repeat(20)}`;
    const out = pickExcerpt(chunk, queryStems('переезд'));
    expect(out.length).toBeLessThanOrEqual(241);
    expect(chunk.includes(out.replace(/…$/, ''))).toBe(true);
  });
});

describe('buildTopicChronicle', () => {
  it('лента идёт по датам, а не по близости; даты ленты отдаются стражу', () => {
    const notes = [
      note('late', '2026-09-01', 0.9, 'Снова думаю про смену работы.'),
      note('early', '2025-07-03', 0.5, 'Впервые подумала про смену работы.'),
      note('mid', '2026-02-10', 0.7, 'Смена работы отложена.'),
    ];
    const r = buildTopicChronicle({ text: 'когда я впервые начала думать о смене работы', mode: 'first', turnEmb: TURN, notes, corpus: CORPUS, withFocus: true });
    const timeline = r!.block.slice(r!.block.indexOf('[Хроника по вопросу'));
    expect(timeline.indexOf('#early')).toBeLessThan(timeline.indexOf('#mid'));
    expect(timeline.indexOf('#mid')).toBeLessThan(timeline.indexOf('#late'));
    expect(timeline).toContain('[#early · 2025-07-03]');
    expect(r!.dates).toEqual(['2025-07-03', '2026-02-10', '2026-09-01']);
  });

  it('далёкая по смыслу заметка не попадает ни в куски, ни в ленту', () => {
    const notes = [note('near', '2026-01-01', 0.6, 'Про переезд.'), note('far', '2026-01-02', 0.2, 'Про погоду.')];
    const r = buildTopicChronicle({ text: 'что я решила насчёт переезда', mode: 'decision', turnEmb: TURN, notes, corpus: CORPUS, withFocus: true });
    expect(r!.ids).toEqual(['near']);
    expect(r!.block).not.toContain('#far');
  });

  it('заметка с именем человека входит в ленту при низкой близости', () => {
    const notes = [note('near', '2026-01-01', 0.6, 'Про брата.'), note('named', '2026-01-02', 0.1, 'Тимур привёз лекарства.')];
    const r = buildTopicChronicle({ text: 'все записи про брата', mode: 'all', turnEmb: TURN, notes, corpus: CORPUS, withFocus: true, forcedIds: new Set(['named']) });
    expect(r!.block).toContain('[#named · 2026-01-02]');
    expect(r!.block).toContain('дословно: Тимур привёз лекарства.');
  });

  it('лента ограничена и говорит, сколько не поместилось; список полным не называет', () => {
    const notes = Array.from({ length: CHRONICLE_MAX_LINES + 7 }, (_, i) => note(`n${i}`, `2026-01-${String(1 + (i % 28)).padStart(2, '0')}`, 0.6, `Запись ${i} про маму.`));
    const r = buildTopicChronicle({ text: 'что я писала про маму', mode: 'all', turnEmb: TURN, notes, corpus: CORPUS, withFocus: false });
    expect(r!.ids).toHaveLength(CHRONICLE_MAX_LINES);
    expect(r!.block).toContain('ещё 7 подходящих не поместились');
    expect(r!.block).toContain('не называй список полным');
  });

  it('«как менялось»: полным куском идёт запись каждого отрезка времени, а не шесть самых похожих', () => {
    // шесть самых близких — все из сентября; ранние этапы слабее по вектору
    const notes = [
      ...Array.from({ length: 8 }, (_, i) => note(`sep${i}`, `2026-09-${String(10 + i)}`, 0.9 - i * 0.01, `Сентябрь ${i}.`)),
      ...Array.from({ length: 8 }, (_, i) => note(`jan${i}`, `2026-01-${String(10 + i)}`, 0.5, `Январь ${i}.`)),
    ];
    const r = buildTopicChronicle({ text: 'как менялось моё отношение к терапии', mode: 'evolution', turnEmb: TURN, notes, corpus: CORPUS, withFocus: true });
    const focus = r!.block.slice(0, r!.block.indexOf('[Хроника по вопросу'));
    expect((focus.match(/#jan/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((focus.match(/\[#/g) ?? []).length).toBe(FOCUS_NOTES);
  });

  it('вопрос-факт: только куски, без ленты; при полном поиске блока нет', () => {
    const notes = [note('a', '2026-06-20', 0.7, 'В клинике Бусый весил 15,3.')];
    const r = buildTopicChronicle({ text: 'сколько весил пёс?', mode: 'fact', turnEmb: TURN, notes, corpus: CORPUS, withFocus: true });
    expect(r!.block).toContain('15,3');
    expect(r!.block).not.toContain('[Хроника по вопросу');
    expect(buildTopicChronicle({ text: 'сколько весил пёс?', mode: 'fact', turnEmb: TURN, notes, corpus: CORPUS, withFocus: false })).toBeNull();
  });
});

describe('buildTopicChronicleBlock (IndexedDB)', () => {
  async function seed(rows: Array<{ id: string; iso: string; cos: number; text: string; hidden?: boolean; trashed?: boolean }>) {
    const db = await getLocalDb();
    for (const s of ['documents', 'aiEmbeddings', 'aiSummaries'] as const) await db.clear(s);
    for (const r of rows) {
      await db.put('documents', {
        id: r.id, guestId: 'u1', title: `Заметка ${r.id}`, currentVersion: 1, totalWords: 30, totalDuration: 0, sessionsCount: 1,
        firstSessionAt: day(r.iso), lastSessionAt: day(r.iso), tags: [],
        ...(r.hidden ? { excludedFromAI: true } : {}), ...(r.trashed ? { trashedAt: 5 } : {}),
      } as never);
    }
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue(rows.map(r => ({
      documentId: r.id, vectors: [vec(r.cos)], chunkTexts: [r.text], contentHash: r.id, processedAt: 1, model: 'm', dim: 3,
    })) as never);
    return db;
  }
  const run = (db: Awaited<ReturnType<typeof getLocalDb>>, text: string, extra: Partial<Parameters<typeof buildTopicChronicleBlock>[0]> = {}) => {
    const injected: string[] = [];
    return buildTopicChronicleBlock({ text, turnEmb: TURN, db, minTime: undefined, maxTime: undefined, performedFullSearch: false, injectedDocumentIds: injected, ...extra })
      .then(r => ({ r, injected }));
  };

  beforeEach(() => { vi.restoreAllMocks(); });

  it('скрытая от ИИ и корзинная заметки не попадают в блок, даже с вектором и именем', async () => {
    const db = await seed([
      { id: 'ok', iso: '2026-03-01', cos: 0.7, text: 'Антон написал, я не ответила.' },
      { id: 'hidden', iso: '2026-03-02', cos: 0.9, text: 'Антон и тайное.', hidden: true },
      { id: 'trash', iso: '2026-03-03', cos: 0.9, text: 'Антон и выброшенное.', trashed: true },
    ]);
    const { r, injected } = await run(db, 'что я писала про Антона', { nameRegexes: [/Антон/] });
    expect(injected).toEqual(['ok']);
    expect(r!.block).not.toMatch(/тайное|выброшенное|#hidden|#trash/);
  });

  it('окно времени хода режет ленту', async () => {
    const db = await seed([
      { id: 'jun', iso: '2026-06-10', cos: 0.7, text: 'Июнь: мысль уехать.' },
      { id: 'jan', iso: '2026-01-10', cos: 0.7, text: 'Январь: мысль уехать.' },
    ]);
    const { injected } = await run(db, 'как с июня менялись мои мысли об отъезде', { minTime: day('2026-06-01'), maxTime: day('2026-10-07') });
    expect(injected).toEqual(['jun']);
  });

  it('в строке ленты только дата и дословный отрывок: суть из разбора не подставляется', async () => {
    const db = await seed([{ id: 'a', iso: '2026-03-01', cos: 0.7, text: 'Решила остаться в квартире.' }]);
    await db.put('aiSummaries', { documentId: 'a', summary: 'Автор решает не переезжать.', tone: '', frequentWords: [], insights: [], themes: [], extractedFacts: [], processedAt: 1 } as never);
    const { r } = await run(db, 'что я решила насчёт квартиры');
    expect(r!.block).toContain('дословно: Решила остаться в квартире.');
    expect(r!.block).not.toContain('Автор решает не переезжать');
    expect(r!.block).not.toContain('суть');
  });

  it('совет без вопроса о записях блока не строит', async () => {
    const db = await seed([{ id: 'a', iso: '2026-03-01', cos: 0.7, text: 'Тревога перед переездом.' }]);
    expect((await run(db, 'что мне делать с этой тревогой?')).r).toBeNull();
  });

  it('названный человек открывает fact даже в настоящем времени', async () => {
    const db = await seed([{ id: 'a', iso: '2026-03-01', cos: 0.7, text: 'Брат советует не спешить с переездом.' }]);
    const { r } = await run(db, 'что говорит брат про переезд?', { nameRegexes: [/брат/i] });
    expect(r!.block).toContain('Брат советует не спешить с переездом.');
  });

  it('не вопрос и ход без вектора реплики блока не строят', async () => {
    const db = await seed([{ id: 'a', iso: '2026-03-01', cos: 0.7, text: 'Текст.' }]);
    expect((await run(db, 'сегодня устала')).r).toBeNull();
    expect((await run(db, 'что я решила?', { turnEmb: undefined })).r).toBeNull();
  });
});

// Вторая версия подачи (флаг answer_chronicle_v2, стенд ai-answer-chronicle-fable-2026-11).
//
// Мутации, на которых тесты краснеют:
//  - `twoChunks` всегда пуст → «длинная заметка отдаёт два лучших куска»;
//  - убрать сортировку пары кусков по порядку заметки → там же (куски задом наперёд);
//  - убрать `parts.unshift(ARCHIVE_TURN_MARK)` → «блок открывается меткой»;
//  - `shown` всегда undefined → «строка ленты не повторяет показанный кусок»;
//  - `v2Enabled().catch(() => false)` → `.catch(() => true)` → «сбой чтения флага — прежний блок».
describe('вторая версия подачи (v2)', () => {
  const long: ChronicleNote = {
    id: 'L', at: day('2026-03-10'), title: 'Длинная',
    // лучший кусок — третий, второй по близости — первый: между ними пропуск
    chunks: ['Начало: решила про переезд до ноября.', 'Середина про погоду.', 'Конец: переезд обсуждали с мамой.', 'Хвост про ужин.'],
    vectors: [vec(0.7), vec(0.1), vec(0.8), vec(0.2)],
  };
  const short = note('S', '2026-01-01', 0.6, 'Короткая запись про переезд.');
  const base = { text: 'что я решила насчёт переезда', mode: 'decision' as const, turnEmb: TURN, corpus: CORPUS, withFocus: true };

  it('без v2 блок прежний: один кусок, без метки, правила в шапке', () => {
    const off = buildTopicChronicle({ ...base, notes: [long, short] })!;
    expect(off.block).toBe(buildTopicChronicle({ ...base, notes: [long, short], v2: false })!.block);
    expect(off.block).not.toContain(ARCHIVE_TURN_MARK);
    expect(off.block).not.toContain('Начало: решила про переезд до ноября.\n[…]');
    expect(off.block).toContain('Дату называй по шапке строки');
  });

  it('блок открывается меткой, правила ответа из шапки ушли', () => {
    const on = buildTopicChronicle({ ...base, notes: [long, short], v2: true })!;
    expect(on.block.startsWith(`${ARCHIVE_TURN_MARK}\n\n[Возможно релевантные заметки]`)).toBe(true);
    expect(on.block).toContain('не называй список полным');
    expect(on.block).not.toContain('Дату называй по шапке строки');
  });

  it('длинная заметка отдаёт два лучших куска в порядке заметки, с пропуском между несоседними', () => {
    const on = buildTopicChronicle({ ...base, notes: [long, short], v2: true })!;
    expect(on.block).toContain('Заметка 2: "Длинная"\nНачало: решила про переезд до ноября.\n[…]\nКонец: переезд обсуждали с мамой.');
    // пропущенный кусок полным текстом не идёт (в ленте от него — только отрывок)
    expect(on.block.slice(0, on.block.indexOf('[Хроника по вопросу'))).not.toContain('Середина про погоду.');
  });

  it('соседние куски идут без знака пропуска; заметка из одного куска не меняется', () => {
    const adjacent: ChronicleNote = { ...long, vectors: [vec(0.1), vec(0.7), vec(0.8), vec(0.2)] };
    const on = buildTopicChronicle({ ...base, notes: [adjacent, short], v2: true })!;
    expect(on.block).toContain('Середина про погоду.\nКонец: переезд обсуждали с мамой.');
    expect(on.block).toContain('Заметка 1: "Заметка S"\nКороткая запись про переезд.\n');
  });

  it('второй кусок получают только CHRONICLE_V2.secondChunkNotes лучших длинных заметок', () => {
    const longs = Array.from({ length: CHRONICLE_V2.secondChunkNotes + 1 }, (_, i): ChronicleNote => ({
      id: `L${i}`, at: day(`2026-0${i + 1}-10`), title: `Длинная ${i}`,
      chunks: [`первый кусок ${i}`, `второй кусок ${i}`], vectors: [vec(0.9 - i * 0.05), vec(0.5)],
    }));
    const on = buildTopicChronicle({ ...base, notes: longs, v2: true })!;
    const focus = on.block.slice(0, on.block.indexOf('[Хроника по вопросу'));
    for (let i = 0; i < CHRONICLE_V2.secondChunkNotes; i++) expect(focus).toContain(`второй кусок ${i}`);
    expect(focus).not.toContain(`второй кусок ${CHRONICLE_V2.secondChunkNotes}`);
  });

  it('строка ленты не повторяет показанный кусок: отрывок берётся из остальных', () => {
    const on = buildTopicChronicle({ ...base, notes: [long, short], v2: true })!;
    const line = on.block.split('\n').find(l => l.startsWith('[#L ·') && l.includes('дословно:'))!;
    expect(line).not.toContain('Начало: решила');
    expect(line).not.toContain('Конец: переезд');
    expect(line).toMatch(/Середина про погоду|Хвост про ужин/);
    // заметка из одного куска показана выше целиком — строка ленты её текст не повторяет
    const shortLine = on.block.split('\n').find(l => l.startsWith('[#S ·') && l.includes('«Заметка S»'))!;
    expect(shortLine).toBe('[#S · 2026-01-01] «Заметка S»: текст выше.');
    expect(on.dates).toContain('2026-01-01');
  });

  it('обвязка: флаг включён — v2; сбой чтения флага — прежний блок', async () => {
    const db = await getLocalDb();
    await db.clear('documents');
    await db.put('documents', { id: 'L', guestId: 'guest', title: 'Длинная', currentVersion: 1, totalWords: 9, totalDuration: 0, sessionsCount: 1, firstSessionAt: long.at, lastSessionAt: long.at, tags: [] } as never);
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([{ documentId: 'L', vectors: long.vectors, chunkTexts: long.chunks, contentHash: 'L', processedAt: 1, model: 'm', dim: 3 }] as never);
    const deps = { text: base.text, turnEmb: TURN, db, minTime: undefined, maxTime: undefined, performedFullSearch: false };
    const on = await buildTopicChronicleBlock({ ...deps, injectedDocumentIds: [], v2Enabled: async () => true });
    const failed = await buildTopicChronicleBlock({ ...deps, injectedDocumentIds: [], v2Enabled: async () => { throw new Error('сеть'); } });
    const absent = await buildTopicChronicleBlock({ ...deps, injectedDocumentIds: [] });
    expect(on!.block).toContain(ARCHIVE_TURN_MARK);
    expect(failed!.block).not.toContain(ARCHIVE_TURN_MARK);
    expect(failed!.block).toBe(absent!.block);
  });
});
