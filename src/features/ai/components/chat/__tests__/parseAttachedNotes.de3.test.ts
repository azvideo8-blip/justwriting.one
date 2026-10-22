// DE-3: шапка `[#id · дата]` следующей заметки (и разделитель блоков перед ней)
// попадала в тело карточки предыдущей; в «не влезшем» ходе с шапками тело,
// которого нет, стало бы самой шапкой. Мутация: убрать NEXT_NOTE_HEAD_RE → красный.
import { describe, expect, it } from 'vitest';
import { parseAttachedNotes } from '../AIChatMessages';

const SEP = '\n\n— — —\nВопрос: ';

describe('DE-3: карточки заметок хода', () => {
  it('влезший ход: тело первой без разделителя и шапки второй', () => {
    const { notes, question } = parseAttachedNotes(
      `[#local_a · 2026-10-18]\n[Прикреплена заметка: "Ящик"]\nтело A\n\n---\n\n[#local_b · 2026-10-19]\n[Прикреплена заметка: "Сон"]\nтело B${SEP}сравни`,
      'Без названия',
    );
    expect(notes).toEqual([{ title: 'Ящик', body: 'тело A' }, { title: 'Сон', body: 'тело B' }]);
    expect(question).toBe('сравни');
  });

  it('не влезший ход с шапками: тел нет, карточки — только названия', () => {
    const { notes } = parseAttachedNotes(
      `[#local_a · 2026-10-18]\n[Прикреплена заметка: "Ящик"]\n[#local_b · 2026-10-19]\n[Прикреплена заметка: "Сон"]${SEP}сравни`,
      'Без названия',
    );
    expect(notes).toEqual([{ title: 'Ящик', body: '' }, { title: 'Сон', body: '' }]);
  });
});
