// R7Q-025 (пунктуация диктовки, прод-жалобы низкого уровня):
// (а) две минуты речи ≈ 300 слов, а десять минут ≈ 2000 — и одна «починка»
//     модели удваивает цену выравнивания: n·m переваливает за MAX_CELLS, align
//     возвращает null, и ВЕСЬ расставленный текст выбрасывается как «слова
//     изменены». Знаки модель расставила правильно, человек получает сырой текст.
// (б) «ФСБ» → «фСБ»: регистр первой буквы переносится с модели, а внутри
//     аббревиатуры он не модельный, а исходный.
import { describe, it, expect } from 'vitest';
import { transferPunctuation } from '../transferPunctuation';
import { sameWords } from '../sameWords';

describe('R7Q-025: пределы выравнивания и регистр аббревиатуры', () => {
  const long = Array.from({ length: 2100 }, (_, i) => `слово${i}`);

  it('диктовка в 2100 слов с одной правкой модели не выбрасывается целой', () => {
    const raw = long.join(' ');
    // Модель: запятая после каждого 20-го слова, одно слово «починено».
    const modelWords = long.map((w, i) => (i === 1000 ? 'исправлено' : (i % 20 === 19 ? `${w},` : w)));
    const model = `Перед. ${modelWords.join(' ')}.`;

    const r = transferPunctuation(raw, model);
    expect(r, 'выравнивание не должно падать на длинной диктовке').not.toBeNull();
    expect(sameWords(raw, r!.text), 'слова исходника обязаны остаться исходными').toBe(true);
    expect(r!.coverage).toBeGreaterThan(0.99);
    expect(r!.text, 'знаки модели обязаны переехать на слова исходника').toContain('слово39,');
    expect(r!.text).toContain('слово1999,');
  });

  it('без правок длинная диктовка переносится целиком', () => {    const raw = long.join(' ');
    const model = long.map((w, i) => (i % 20 === 19 ? `${w},` : w)).join(' ');
    const r = transferPunctuation(raw, model);
    expect(r).not.toBeNull();
    expect(r!.coverage).toBe(1);
    // Начало фразы заглавной делает сам перенос (правило на конце функции),
    // поэтому сравниваем с модельным текстом с первой заглавной.
    expect(r!.text).toBe(model.charAt(0).toUpperCase() + model.slice(1));
  });

  it('аббревиатура исходника не теряет внутренний регистр, даже если модель написала её строчными', () => {
    const raw = 'я работал в ФСБ потом ушёл';
    const model = 'Я работал в фсб, потом ушёл.';

    const r = transferPunctuation(raw, model)!;
    expect(r.text, '«ФСБ» обязано остаться «ФСБ»: регистр внутри слова — не решение модели').toBe(
      'Я работал в ФСБ, потом ушёл.',
    );
    expect(sameWords(raw, r.text)).toBe(true);
  });

  it('обычное слово модельный регистр получает, как и раньше', () => {
    expect(transferPunctuation('привет миру', 'Привет миру.')?.text).toBe('Привет миру.');
    expect(transferPunctuation('Ёлка стоит', 'ёлка стоит.')?.text).toBe('Ёлка стоит.');
  });
});
