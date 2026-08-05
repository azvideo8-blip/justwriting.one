import { describe, it, expect } from 'vitest';
import { REFLECTION_GUIDE, NOTES_GUARD } from '../prompts';

// Эти правила — продуктовое решение, а не формулировка «на вкус». Тест не
// проверяет текст дословно (его будут править), он проверяет, что правило не
// исчезло целиком: так уже терялась половина NOTES_GUARD при переписывании.
describe('REFLECTION_GUIDE keeps the honesty rules', () => {
  it('requires naming the gap between what was said and what was done', () => {
    expect(REFLECTION_GUIDE).toMatch(/РАЗРЫВ МЕЖДУ СКАЗАННЫМ И СДЕЛАННЫМ/);
    // Оговорка про «нет материала — молчи» существенна: без неё модель
    // изобретает разрыв, чтобы выполнить инструкцию.
    expect(REFLECTION_GUIDE).toMatch(/не выдумывай разрыв/i);
  });

  it('bans evaluative labels and names replacements', () => {
    expect(REFLECTION_GUIDE).toMatch(/БЕЗ ОЦЕНОЧНЫХ ЯРЛЫКОВ/);
    for (const word of ['кульминация', 'главный инсайт', 'замкнул круг']) {
      expect(REFLECTION_GUIDE).toContain(word);
    }
  });

  it('caps quoting', () => {
    expect(REFLECTION_GUIDE).toMatch(/ЦИТИРУЙ СКУПО/);
  });

  it('no longer tells the model to prefer quoting', () => {
    // R3.2: прямое противоречие с «цитируй скупо».
    expect(NOTES_GUARD).not.toMatch(/предпочитай дословную цитату/);
  });
});
