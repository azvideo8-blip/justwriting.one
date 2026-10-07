import { describe, expect, it } from 'vitest';
import { diffPostAgainstNote, postBody } from '../editorDiff';

// DLG-Q10 (Fable T-15): «что изменил» от модели врёт, счёт ведёт код.
const NOTE = 'Утром позвонил Тимур, а Оля одолжила 54 000 и напомнила про 5:50.';

describe('Q-10: diffPostAgainstNote', () => {
  it('заменил имена ролями — видит и имена, и роли, и числа', () => {
    const post = 'Брат позвонил рано утром. Подруга выручила деньгами, и всё это висит над головой.';
    const d = diffPostAgainstNote(post, NOTE);
    expect(d.namesRemoved).toEqual(expect.arrayContaining(['Тимур', 'Оля']));
    expect(d.numbersRemoved).toEqual(expect.arrayContaining(['54 000', '5:50']));
    expect(d.rolesAdded).toEqual(expect.arrayContaining(['брат', 'подруга']));
  });

  it('имя в другом падеже — имя осталось в посте', () => {
    const post = 'Олю пришлось уговаривать полчаса, а она ведь только хотела помочь.';
    const d = diffPostAgainstNote(post, NOTE);
    expect(d.namesRemoved).not.toContain('Оля');
  });

  it('заглавное слово в начале предложения — не имя', () => {
    const d = diffPostAgainstNote('Разговор вышел тяжёлый, и я его отложила.', 'Сегодня был тяжёлый разговор, и я его отложила.');
    expect(d.namesRemoved).toEqual([]);
  });

  // R-4 (ревью 07.10): в дневнике имя стоит именно в начале фразы, и прежний
  // пропуск начала предложения терял почти все имена.
  it('имя в начале предложения считается и попадает в убранные', () => {
    const d = diffPostAgainstNote(
      'Подруга написала первой. Брат звонил рано.',
      'Оля написала первой. Тимур звонил в 5:50.',
    );
    expect(d.namesRemoved).toEqual(expect.arrayContaining(['Оля', 'Тимур']));
    expect(d.numbersRemoved).toEqual(expect.arrayContaining(['5:50']));
    expect(d.rolesAdded).toEqual(expect.arrayContaining(['подруга', 'брат']));
  });

  it('«Анализ» — не форма имени «Аня»', () => {
    expect(diffPostAgainstNote('Анализ показал что-то.', 'Аня пришла.').namesRemoved).toContain('Аня');
  });

  it('строчные слова поста именем не считаются', () => {
    expect(diffPostAgainstNote('Было только олень и лето.', 'Оля, Лев и Аня пришли.').namesRemoved)
      .toEqual(expect.arrayContaining(['Оля', 'Лев', 'Аня']));
  });

  it('частые начала фразы именами не становятся, а настоящее имя видно', () => {
    const d = diffPostAgainstNote('Было тихо. Пришла Оля.', 'Сегодня было тихо. Потом пришла Оля.');
    expect(d.namesRemoved).toEqual([]);
  });

  it('слово, которое в источнике хоть раз пишется со строчной, — не имя', () => {
    const d = diffPostAgainstNote('Всё решили завтра.', 'Маму звали вечером. Мы говорили про маму.');
    expect(d.namesRemoved).toEqual([]);
  });

  it('ничего не убрано — пустые списки, без ложных срабатываний', () => {
    const d = diffPostAgainstNote(NOTE, NOTE);
    expect(d).toEqual({ namesRemoved: [], rolesAdded: [], numbersRemoved: [] });
  });

  it('суммы с «тыс» и «₽» считаются числами источника', () => {
    const d = diffPostAgainstNote('Копила долго, а потом всё потратила.', 'Копила 120 тыс, а потом потратила 45 000 ₽.');
    expect(d.numbersRemoved.join(' ')).toMatch(/120|45 000/);
  });

  it('пост — всё до строки «— — —»', () => {
    const answer = 'Первая строка поста.\n\n— — —\nИз заметок: [#local_a]';
    expect(postBody(answer)).toBe('Первая строка поста.\n\n');
    expect(postBody('без разделителя')).toBe('без разделителя');
  });
});
