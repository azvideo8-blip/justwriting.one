// TI-1: поведение самого конструктора, включая ветку без вопроса — через
// useAIPageData её не послать (заметка без вопроса возвращается до отправки),
// поэтому она закреплена здесь.
import { describe, it, expect } from 'vitest';
import { attachedTurn, refHead, formatRefTag } from '../attachedNoteFormat';

const DAY = new Date('2026-09-29T12:00:00').getTime();
const note = { documentId: 'local_a', title: 'Утро', lastSessionAt: DAY, content: 'ТЕЛО' };

describe('TI-1: писатель хода', () => {
  it('без вопроса и с пустым вопросом — разделителя нет', () => {
    const plain = '[#local_a · 2026-09-29]\n[Прикреплена заметка: "Утро"]\nТЕЛО';
    expect(attachedTurn([note])).toBe(plain);
    expect(attachedTurn([note], '')).toBe(plain);
  });

  it('с вопросом — вопрос после разделителя', () => {
    expect(attachedTurn([note], 'что важно?')).toBe(
      '[#local_a · 2026-09-29]\n[Прикреплена заметка: "Утро"]\nТЕЛО\n\n— — —\nВопрос: что важно?',
    );
  });

  it('тело не влезло — только шапка, у нескольких заметок шапки через перевод строки', () => {
    expect(attachedTurn([{ ...note, content: undefined }], 'q')).toBe(
      '[#local_a · 2026-09-29]\n[Прикреплена заметка: "Утро"]\n\n— — —\nВопрос: q',
    );
    expect(attachedTurn([
      { documentId: 'local_a', title: 'Утро', lastSessionAt: DAY },
      { documentId: 'local_b', title: 'Вечер', lastSessionAt: DAY },
    ], 'q')).toBe(
      '[#local_a · 2026-09-29]\n[Прикреплена заметка: "Утро"]\n'
      + '[#local_b · 2026-09-29]\n[Прикреплена заметка: "Вечер"]\n\n— — —\nВопрос: q',
    );
  });

  it('название чистится как раньше: кавычки → апострофы, перевод строки → пробел', () => {
    expect(refHead({ documentId: 'x', lastSessionAt: DAY, title: 'Мой "дневник"\nи ещё' })).toBe(
      '[#x · 2026-09-29]\n[Прикреплена заметка: "Мой \'дневник\' и ещё"]',
    );
    expect(formatRefTag(note)).toBe('[#local_a · 2026-09-29]\n[Прикреплена заметка: "Утро"]\nТЕЛО');
  });
});
