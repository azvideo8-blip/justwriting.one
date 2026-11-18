// Шаг «найди опоры» (флаг chat_hypotheses): в ход идёт только отрывок, который
// дословно стоит в тексте названной записи.
//
// Мутации, на которых тесты краснеют:
//  - убрать сверку отрывка с текстом записи → красный «выдуманный отрывок»;
//  - сверять со ВСЕМИ записями, а не с названной → красный «отрывок из другой записи»;
//  - убрать «меньше двух — пусто» → красный «одна опора»;
//  - убрать проверку дня → красный «две записи одного дня».
import { describe, expect, it } from 'vitest';
import { buildAnchorPickUserMessage, parseAnchorPick, type AnchorCandidate } from '../anchorPickPrompt';

const C: AnchorCandidate[] = [
  { documentId: 'clay', date: '2026-10-30', title: 'Глина', text: 'Глина так и лежит на балконе. Сказала: сначала надо разобрать антресоль.' },
  { documentId: 'piano', date: '2026-04-12', title: 'Пианино', text: 'Бабушка говорила: «Сделал дело — гуляй смело». Только к тому времени уже темнело.' },
  { documentId: 'coffee', date: '2026-05-20', title: 'Утро', text: 'Кофе налила только после почты и посуды. Остыл.' },
  { documentId: 'same', date: '2026-05-20', title: 'Вечер', text: 'Вечером дошла до магазина, купила хлеб и молоко.' },
];
const json = (anchors: unknown) => JSON.stringify({ anchors });

describe('parseAnchorPick', () => {
  it('дословные отрывки проходят; пробелы, «ё» и вид кавычек не важны', () => {
    const got = parseAnchorPick(json([
      { n: 1, quote: 'Сказала: сначала надо разобрать антресоль.' },
      { n: 2, quote: 'Бабушка говорила:  "Сделал дело — гуляй смело".' },
      { n: 3, quote: '«Кофе налила только после почты и посуды. Остыл.»' },
    ]), C);
    expect(got.map(a => a.documentId)).toEqual(['clay', 'piano', 'coffee']);
    expect(got[2]?.quote).toBe('Кофе налила только после почты и посуды. Остыл.');
  });

  it('выдуманный отрывок отбрасывается', () => {
    const got = parseAnchorPick(json([
      { n: 1, quote: 'Сказала: сначала надо разобрать антресоль.' },
      { n: 2, quote: 'Бабушка запрещала мне гулять с ребятами.' },
      { n: 3, quote: 'Кофе налила только после почты и посуды.' },
    ]), C);
    expect(got.map(a => a.documentId)).toEqual(['clay', 'coffee']);
  });

  it('отрывок из другой записи не засчитывается названной', () => {
    const got = parseAnchorPick(json([
      { n: 1, quote: 'Кофе налила только после почты и посуды.' },
      { n: 2, quote: 'Только к тому времени уже темнело.' },
      { n: 3, quote: 'Кофе налила только после почты и посуды.' },
    ]), C);
    expect(got.map(a => a.documentId)).toEqual(['piano', 'coffee']);
  });

  it('одна опора — пустой список: связывать нечего', () => {
    expect(parseAnchorPick(json([{ n: 1, quote: 'Сказала: сначала надо разобрать антресоль.' }]), C)).toEqual([]);
    expect(parseAnchorPick(json([]), C)).toEqual([]);
  });

  it('две записи одного дня — это один день', () => {
    expect(parseAnchorPick(json([
      { n: 3, quote: 'Кофе налила только после почты и посуды.' },
      { n: 4, quote: 'Вечером дошла до магазина, купила хлеб и молоко.' },
    ]), C)).toEqual([]);
  });

  it('не JSON, чужой номер, мусор в полях — пустой список, не исключение', () => {
    expect(parseAnchorPick('Вот записи: 1 и 2.', C)).toEqual([]);
    expect(parseAnchorPick('', C)).toEqual([]);
    expect(parseAnchorPick(json([{ n: 9, quote: 'Сказала: сначала надо разобрать антресоль.' }, { n: '2', quote: 5 }]), C)).toEqual([]);
    expect(parseAnchorPick('```json\n' + json([
      { n: 1, quote: 'Сказала: сначала надо разобрать антресоль.' },
      { n: 2, quote: 'Только к тому времени уже темнело.' },
    ]) + '\n```', C)).toHaveLength(2);
  });

  it('сообщение модели: реплика и пронумерованные записи с датой и названием', () => {
    const m = buildAnchorPickUserMessage('опять не подошла', C.slice(0, 2));
    expect(m).toContain('Реплика человека: "опять не подошла"');
    expect(m).toContain('[1] 2026-10-30 · Глина\nГлина так и лежит');
    expect(m).toContain('[2] 2026-04-12 · Пианино\n');
  });
});
