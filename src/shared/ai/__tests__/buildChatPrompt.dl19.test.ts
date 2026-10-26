// DL-19 (19.1, 19.8): при длинном приложенном тексте в промпте появляется строка
// о проходе по частям. Порог решает код, не модель. Мутации: вернуть `return null`
// в longNoteRule (краснеет первая проверка) и снять gate Редактора (краснеет
// третья).
import { describe, it, expect } from 'vitest';
import { LONG_NOTE_CHARS, LONG_NOTE_RULE, buildChatSystemPrompt, longNoteRule } from '../buildChatPrompt';

const LONG = 'Вера: реплика расшифровки, которая длинная и повторяется.\n'.repeat(500);
const SHORT = 'Вера: короткая заметка.';

function prompt(documentContent: string, personaId = 'group_psychology', responseLength: 'short' | 'standard' | 'detailed' = 'detailed'): string {
  return buildChatSystemPrompt({
    personaId, responseLength, documentContent, noteScope: { mode: 'note', title: 'Расшифровка', date: '18 октября 2026' },
  });
}

describe('DL-19: правило прохода по частям для длинного вложения', () => {
  it('длиннее порога — строка в промпте и она дословна', () => {
    expect(LONG.length).toBeGreaterThan(LONG_NOTE_CHARS);
    const p = prompt(LONG);
    expect(p).toContain(LONG_NOTE_RULE);
    expect(p).toContain('пройди текст по порядку, по частям: начало, середина, конец; ни одну часть не пропускай');
    // статичная часть: правило стоит до подборки примеров и до фенса данных,
    // иначе оно каждый ход рвало бы кэш префикса. Строка примеров ищется с
    // хвоста: на неё ссылается REFLECTION_GUIDE, стоящий раньше.
    expect(p.indexOf(LONG_NOTE_RULE)).toBeLessThan(p.lastIndexOf('ПРИМЕРЫ ОТКРЫТЫХ ВОПРОСОВ (меняются'));
    expect(p.indexOf(LONG_NOTE_RULE)).toBeLessThan(p.indexOf('DATA_CONTEXT_BEGIN'));
  });

  it('короче порога — строки нет', () => {
    expect(longNoteRule(SHORT, 'group_psychology', 'detailed')).toBeNull();
    expect(prompt(SHORT)).not.toContain(LONG_NOTE_RULE);
  });

  it('Редактор — строки нет: он пишет пост, а не пересказывает весь текст', () => {
    expect(longNoteRule(LONG, 'editor', 'detailed')).toBeNull();
  });

  it('короткий ответ — строки нет: она противоречила бы правилу длины', () => {
    expect(longNoteRule(LONG, 'group_psychology', 'short')).toBeNull();
  });

  it('порог — ровно 15 000 знаков, граница включительно-исключающая', () => {
    expect(longNoteRule('а'.repeat(LONG_NOTE_CHARS), 'coach', 'detailed')).toBeNull();
    expect(longNoteRule('а'.repeat(LONG_NOTE_CHARS + 1), 'coach', 'detailed')).toBe(LONG_NOTE_RULE);
  });
});
