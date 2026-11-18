// Ход с осторожной гипотезой (флаг chat_hypotheses): какая реплика годится и
// какие записи идут в ход.
//
// Мутации, на которых тесты краснеют:
//  - убрать SELF_RE из `hypothesisAskOf` → «почему небо синее» становится ходом гипотезы;
//  - убрать STUCK_RE → отчёт о дне становится ходом гипотезы;
//  - убрать GREY_ZONE_RE → «не хочу больше просыпаться» становится ходом гипотезы;
//  - убрать порог кандидата (`candidateFloor`) → далёкая запись уходит служебному вызову;
//  - убрать проверку близости в `diverseAnchors` → три записи про один предмет идут опорами;
//  - `buildAnchorBlock` не проверяет «два разных дня» → одна запись выдаётся за материал.
import { describe, expect, it } from 'vitest';
import { buildAnchorBlock, diverseAnchors, hypothesisAskOf, hypothesisCandidates, HYPOTHESIS_MATERIAL, type HypothesisNote } from '../hypothesisTurn';
import { HYPOTHESIS_TURN_MARK } from '../../../../../shared/ai/hypothesisRule';

describe('hypothesisAskOf', () => {
  const yes: Array<[string, 'why' | 'reflect']> = [
    ['Почему я никак не могу сесть за круг? Я же сама его хотела. Что я тут не вижу?', 'why'],
    ['Разбери подробно, почему у меня с кругом так выходит. Я хочу понять, что со мной.', 'why'],
    ['Хочу понять, что мне мешает поговорить с Олегом.', 'why'],
    ['Опять суббота прошла, а я к гончарному кругу так и не подошла. Весь день что-то доделывала, и теперь злюсь на себя.', 'reflect'],
    ['У меня всё время один расклад: либо я в деле и кофейни держатся, либо я расслабляюсь и всё разваливается.', 'reflect'],
    ['Глина сохнет на балконе третий месяц, а я опять ничего не сделала. Я просто ленивая и неорганизованная.', 'reflect'],
    ['опять весь вечер просидела над чертежами, а к глине так и не подошла, и злюсь на себя', 'reflect'], // без «я»
  ];
  it.each(yes)('годится: %s', (text, kind) => {
    expect(hypothesisAskOf(text, 'coach')).toBe(kind);
  });

  const no = [
    'привет, как дела',
    'почему небо синее?',
    'почему Олег вчера молчал на планёрке?',
    'что приготовить Соне на завтрак, если остался творог?',
    'сколько я заплатила стоматологу в мае?',
    'Сегодня ездили с Соней в парк, кормили уток, потом зашли за мороженым, а вечером я посмотрела с ней мультик. Хороший был день.',
    'опять не могу', // короткая реплика без вопроса
    'Опять дождь весь день, никак не кончится, в который раз за неделю заливает двор и парковку.', // не о себе
    'Помоги мне составить план, я опять ничего не успеваю и злюсь на себя из-за этого.', // просьба
    'Я опять не отправила главу и злюсь — что мне теперь делать?', // совет, не «почему»
  ];
  it.each(no)('не годится: %s', (text) => {
    expect(hypothesisAskOf(text, 'coach')).toBeNull();
  });

  // Детектор риска на этих фразах молчит (серая зона), а ход не для гипотезы.
  const grey = [
    'Опять ничего не сделала, круг так и стоит. Я вообще не хочу больше просыпаться, всем без меня будет проще.',
    'Опять всё сорвал. Думаю, что девочкам и Диане было бы лучше без меня, и не хочу больше просыпаться.',
    'Опять не отправила главу. Иногда думаю, что проще было бы исчезнуть совсем, чем объясняться. Не хочу жить в этом.',
    'Почему я такая? Иногда кажется, что лучше бы меня вообще не было.',
    'Опять не подошла к глине, злюсь на себя, думаю наглотаться таблеток и больше ничего не чувствовать.',
    'Опять не сплю и злюсь на себя, устала жить в этом круге, никак не могу остановиться.',
  ];
  it.each(grey)('серая зона кризиса — не ход гипотезы: %s', (text) => {
    expect(hypothesisAskOf(text, 'coach')).toBeNull();
  });

  it('только у четырёх характеров', () => {
    const text = 'Почему я всё время откладываю то, чего мне самой хочется?';
    for (const p of ['coach', 'parts', 'cbt', 'group_psychology']) expect(hypothesisAskOf(text, p)).toBe('why');
    for (const p of ['editor', 'custom', 'my-persona-id']) expect(hypothesisAskOf(text, p)).toBeNull();
  });
});

describe('подбор опор', () => {
  const day = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
  // Двумерные векторы: реплика — [1,0]; косинус записи с репликой = её первая координата.
  const v = (c: number, sign = 1): number[] => [c, sign * Math.sqrt(1 - c * c)];
  const note = (id: string, iso: string, vec: number[], text = `Текст ${id}.`): HypothesisNote => ({ id, at: day(iso), title: `Запись ${id}`, chunks: [text], vectors: [vec] });
  const turn = [1, 0];

  it('кандидаты — ближайшие к реплике выше порога, по убыванию близости, не больше двенадцати', () => {
    const notes = [note('far', '2026-01-05', v(0.1)), note('b', '2026-09-02', v(0.5)), note('a', '2026-10-30', v(0.8)), note('c', '2026-07-08', v(0.36))];
    expect(hypothesisCandidates(turn, notes).map(c => c.documentId)).toEqual(['a', 'b', 'c']);
    expect(hypothesisCandidates(turn, notes)[0]).toEqual({ documentId: 'a', date: '2026-10-30', title: 'Запись a', text: 'Текст a.' });
    const many = Array.from({ length: 20 }, (_, i) => note(`n${i}`, `2026-03-${String(i + 1).padStart(2, '0')}`, v(0.9 - i * 0.01)));
    expect(hypothesisCandidates(turn, many)).toHaveLength(12);
  });

  it('опоры об одном предмете не дублируются: вторая близкая запись не берётся', () => {
    // clay1 и clay2 почти совпадают (один предмет), scene смотрит в другую сторону.
    const notes = [note('clay1', '2026-10-30', v(0.8)), note('clay2', '2026-10-03', v(0.78)), note('scene', '2026-04-12', v(0.4, -1))];
    const picked = [{ documentId: 'clay1', quote: 'q1' }, { documentId: 'clay2', quote: 'q2' }, { documentId: 'scene', quote: 'q3' }];
    expect(diverseAnchors(picked, notes).map(a => a.documentId)).toEqual(['clay1', 'scene']);
    // Порядок служебного вызова сохраняется; не больше maxAnchors.
    const spread = Array.from({ length: 6 }, (_, i) => note(`s${i}`, `2026-0${i + 1}-01`, [Math.cos(i), Math.sin(i)]));
    const kept = diverseAnchors(spread.map(n => ({ documentId: n.id, quote: 'q' })), spread);
    expect(kept.length).toBeLessThanOrEqual(HYPOTHESIS_MATERIAL.maxAnchors);
    expect(kept[0]?.documentId).toBe('s0');
  });

  it('блок: записи целиком от ранней к поздней, в каждой отмечен отрывок', () => {
    const cands = [
      { documentId: 'a', date: '2026-10-30', title: 'Глина', text: 'Глина лежит. Сначала антресоль.' },
      { documentId: 'b', date: '2026-04-12', title: 'Пианино', text: 'Гаммы до ужина. Во двор — после.' },
    ];
    const r = buildAnchorBlock(cands, [{ documentId: 'a', quote: 'Сначала антресоль.' }, { documentId: 'b', quote: 'Во двор —\nпосле.' }]);
    expect(r?.block.startsWith(HYPOTHESIS_TURN_MARK)).toBe(true);
    expect(r?.block).toContain('[#b · 2026-04-12]\nЗаметка 1: "Пианино"\nГаммы до ужина. Во двор — после.\nГлавное здесь — дословно: Во двор — после.\n\n[#a · 2026-10-30]\nЗаметка 2: "Глина"');
    expect(r?.ids).toEqual(['b', 'a']);
    expect(r?.dates).toEqual(['2026-04-12', '2026-10-30']);
  });

  it('меньше двух записей разных дней — блока нет', () => {
    const cands = [
      { documentId: 'a', date: '2026-10-30', title: 'А', text: 'Текст а.' },
      { documentId: 'a2', date: '2026-10-30', title: 'А2', text: 'Текст а2.' },
    ];
    expect(buildAnchorBlock(cands, [{ documentId: 'a', quote: 'Текст а.' }])).toBeNull();
    expect(buildAnchorBlock(cands, [{ documentId: 'a', quote: 'Текст а.' }, { documentId: 'a2', quote: 'Текст а2.' }])).toBeNull();
    expect(buildAnchorBlock(cands, [])).toBeNull();
    // Опора, которой нет среди кандидатов, не считается.
    expect(buildAnchorBlock(cands, [{ documentId: 'a', quote: 'Текст а.' }, { documentId: 'zzz', quote: 'чужое' }])).toBeNull();
  });
});
