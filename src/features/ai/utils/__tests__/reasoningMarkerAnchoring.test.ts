import { describe, it, expect } from 'vitest';

// Регрессия: маркеры разделения ищутся только как отдельные строки.
// Фраза «интересный ход мысли… ответ: попробуй» в разговоре с психологом —
// обычное дело, и поиск по вхождению обрезал бы человеку начало реплики.
describe('разделение ответа по маркерам', () => {
  const MD_REASONING_LINE = /^ХОД МЫСЛИ:\s*$/im;
  const MD_ANSWER_LINE = /^ОТВЕТ:\s*$/im;

  it('не срабатывает на словах внутри предложения', () => {
    const text = 'Мне нравится твой ход мысли. Ответ: попробуй начать с малого.';
    expect(MD_REASONING_LINE.test(text)).toBe(false);
    expect(MD_ANSWER_LINE.test(text)).toBe(false);
  });

  it('срабатывает на маркерах, которые пишет сервер', () => {
    const text = 'ХОД МЫСЛИ:\nнадо подумать\n\nОТВЕТ:\nвот ответ';
    expect(MD_REASONING_LINE.test(text)).toBe(true);
    expect(MD_ANSWER_LINE.test(text)).toBe(true);
  });
});
