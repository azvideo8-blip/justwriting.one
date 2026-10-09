// W-6: о языке решения по вопросу, а не по ходу целиком. Ход с вложением —
// «маркер заметки + её тело + разделитель + вопрос», и первые две части на
// кириллице переворачивали решение для английского вопроса.
import { describe, it, expect } from 'vitest';
import { ATTACHED_QUESTION_SEP, needsEnglishNudge, questionPart } from '../languageNudge';

// Синтетика: выдуманные названия и тексты.
const NOTE_TITLE = 'Кухня и ремонт';
const NOTE_BODY = 'Отложили кухню на осень, подрядчик обещал в четверг, я не настаивала.';
const QUESTION = 'what do you think about postponing the kitchen repair?';

const attached = (title: string, body: string, question: string): string =>
  `[Прикреплена заметка: "${title}"]\n\n${body}${ATTACHED_QUESTION_SEP}${question}`;

describe('W-6: questionPart', () => {
  it('ход с разделителем: остаётся только вопрос', () => {
    const text = attached(NOTE_TITLE, NOTE_BODY, QUESTION);
    expect(questionPart(text)).toBe(QUESTION);
    expect(needsEnglishNudge(questionPart(text))).toBe(true);
    // Именно это и ломалось: по ходу целиком кириллица выигрывала.
    expect(needsEnglishNudge(text)).toBe(false);
  });

  it('разделитель берётся после последнего вхождения', () => {
    const text = `первый вопрос${ATTACHED_QUESTION_SEP}older${ATTACHED_QUESTION_SEP}${QUESTION}`;
    expect(questionPart(text)).toBe(QUESTION);
  });

  it('ход без вопроса: маркер вырезается, тело остаётся', () => {
    const text = `[Прикреплена заметка: "${NOTE_TITLE}"]\n\n${NOTE_BODY}`;
    const part = questionPart(text);
    expect(part).not.toContain(NOTE_TITLE);
    expect(part.trim()).toBe(NOTE_BODY);
  });

  it('обычная реплика не меняется', () => {
    expect(questionPart('хочу бегать по утрам, с чего начать?')).toBe('хочу бегать по утрам, с чего начать?');
    expect(questionPart('how do I start running in the morning?')).toBe('how do I start running in the morning?');
  });

  it('пустой вопрос: возвращается исходный текст, а не пустая строка', () => {
    const text = `[Прикреплена заметка: "${NOTE_TITLE}"]\n\n${NOTE_BODY}${ATTACHED_QUESTION_SEP}`;
    expect(questionPart(text)).toBe(text);
    expect(needsEnglishNudge(questionPart(text))).toBe(false);
  });

  it('русский вопрос про английскую заметку — без подсказки', () => {
    const text = attached('Kitchen and repair', 'We postponed the kitchen refurb, the contractor promised Thursday.', 'что я думала про откладку ремонта?');
    expect(needsEnglishNudge(questionPart(text))).toBe(false);
  });
});
