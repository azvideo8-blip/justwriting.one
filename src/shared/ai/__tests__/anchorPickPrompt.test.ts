// Шаг «найди опоры» (флаг chat_hypotheses): служебный вызов возвращает только
// номера выбранных записей; отрывок выбирает код (quoteOf), здесь его нет.
//
// Мутации, на которых тесты краснеют:
//  - убрать проверку дня (days.has) → красный «две записи одного дня»;
//  - убрать проверку повтора (out.some) → красный «повтор номера»;
//  - убрать «меньше двух — пусто» → красный «одна опора»;
//  - не читать старый вид {n,…} → красный «старый вид тоже читается».
import { describe, expect, it } from 'vitest';
import { buildAnchorPickUserMessage, parseAnchorPick, type AnchorCandidate } from '../anchorPickPrompt';

const C: AnchorCandidate[] = [
  { documentId: 'clay', date: '2026-10-30', title: 'Глина', gist: 'Глина лежит на балконе, сначала антресоль.', text: 'Глина так и лежит на балконе. Сказала: сначала надо разобрать антресоль.' },
  { documentId: 'piano', date: '2026-04-12', title: 'Пианино', gist: 'Бабушка: сделал дело — гуляй смело.', text: 'Бабушка говорила: «Сделал дело — гуляй смело». Только к тому времени уже темнело.' },
  { documentId: 'coffee', date: '2026-05-20', title: 'Утро', gist: 'Кофе после почты и посуды.', text: 'Кофе налила только после почты и посуды. Остыл.' },
  { documentId: 'same', date: '2026-05-20', title: 'Вечер', gist: 'Дошла до магазина за хлебом.', text: 'Вечером дошла до магазина, купила хлеб и молоко.' },
];
const json = (anchors: unknown) => JSON.stringify({ anchors });

describe('parseAnchorPick', () => {
  it('номера записей → id, порядок сохранён', () => {
    expect(parseAnchorPick(json([1, 2, 3]), C)).toEqual([{ documentId: 'clay' }, { documentId: 'piano' }, { documentId: 'coffee' }]);
  });

  it('старый вид {n,quote} тоже читается — отрывок игнорируется, его выбирает код', () => {
    expect(parseAnchorPick(json([{ n: 1, quote: 'что угодно' }, { n: 2, quote: 'не важно' }]), C)).toEqual([{ documentId: 'clay' }, { documentId: 'piano' }]);
  });

  it('повтор номера не даёт вторую опору', () => {
    expect(parseAnchorPick(json([1, 1, 2]), C)).toEqual([{ documentId: 'clay' }, { documentId: 'piano' }]);
  });

  it('две записи одного дня — это один день: меньше двух → пусто', () => {
    expect(parseAnchorPick(json([3, 4]), C)).toEqual([]);
  });

  it('одна опора или пусто — пустой список: связывать нечего', () => {
    expect(parseAnchorPick(json([1]), C)).toEqual([]);
    expect(parseAnchorPick(json([]), C)).toEqual([]);
  });

  it('не больше шести опор', () => {
    const many: AnchorCandidate[] = Array.from({ length: 8 }, (_, i) => ({ documentId: `d${i}`, date: `2026-01-${String(i + 1).padStart(2, '0')}`, title: `З${i}`, gist: `суть ${i}` }));
    expect(parseAnchorPick(json([1, 2, 3, 4, 5, 6, 7, 8]), many)).toHaveLength(6);
  });

  it('не JSON, чужой номер, мусор в полях — пустой список, не исключение', () => {
    expect(parseAnchorPick('Вот записи: 1 и 2.', C)).toEqual([]);
    expect(parseAnchorPick('', C)).toEqual([]);
    expect(parseAnchorPick(json([{ n: 9 }, { n: '2' }]), C)).toEqual([]);
    expect(parseAnchorPick('```json\n' + json([1, 2]) + '\n```', C)).toHaveLength(2);
  });

  it('сообщение модели: реплика и пронумерованные записи с сутью, у первых — полный текст', () => {
    const m = buildAnchorPickUserMessage('опять не подошла', C.slice(0, 2));
    expect(m).toContain('Реплика человека: "опять не подошла"');
    expect(m).toContain('[1] 2026-10-30 · Глина\nСуть: Глина лежит на балконе, сначала антресоль.\nТекст: Глина так и лежит');
    expect(m).toContain('[2] 2026-04-12 · Пианино\nСуть: Бабушка: сделал дело — гуляй смело.');
    // Запись без полного текста идёт только с сутью.
    const gistOnly = buildAnchorPickUserMessage('опять', [{ date: '2026-05-20', title: 'Утро', gist: 'Кофе после почты.' }]);
    expect(gistOnly).toContain('Суть: Кофе после почты.');
    expect(gistOnly).not.toContain('Текст:');
  });
});