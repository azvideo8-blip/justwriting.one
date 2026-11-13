// MD-2 (0.9.37): аудит ответа на сервере. Фикстуры синтетические: выдуманные
// заметки выдуманной авторки, никаких строк из живого архива.
import { describe, expect, it } from 'vitest';
import { auditAnswer } from '../answerAudit';

const ATTACHED_DOC = '[#local_v102 · 20261009]\n[Прикрепленная заметка]\n'
  + 'Вера записала: репетиция в четверг, струна лопнула на втором прогоне.';

const RESULTS_DOC = ATTACHED_DOC + '\n\nРезультаты поиска по архиву заметок (запрос: "скрипка"). '
  + 'Искал по ВСЕЙ базе: 128 заметок, 2024-03-02 — 2026-10-09. Найдено заметок: 2 (отобрано 2 по релевантности). '
  + '\n\n[#local_k07 · 20260928]\nЗаметка 1: "Прокат"\nВзяли инструмент напрокат.';

const NO_RESULTS_DOC = '[#local_v102 · 20261009]\n[Прикрепленная заметка]\nВера записала: струна лопнула.\n\n'
  + '[Поиск по ВСЕЙ базе (128 заметок) по запросу "концерт" не нашёл подходящих заметок. '
  + 'Скажи, что по этому запросу в базе ничего не нашлось (НЕ «нет доступа»), предложи переформулировать.]';

describe('MD-2: «текста заметки нет» при приложенной заметке', () => {
  it('три формы утверждения считаются', () => {
    const claims = [
      'Похоже, эта заметка — скорее заголовок без текста.',
      'Текста заметки у меня нет, вижу только название.',
      'В заметке нет содержания, только дата.',
    ];
    for (const answer of claims) {
      expect(auditAnswer(answer, ATTACHED_DOC), answer).toMatchObject({ note_text_denied: true });
    }
  });

  it('без блока приложенной заметки утверждение не считается', () => {
    // Ход без вложения: модель вправе сказать, что у найденной записи текста нет,
    // — приложенной заметки в материалах нет вовсе.
    const doc = 'Результаты поиска по архиву заметок (запрос: "скрипка"). Найдено заметок: 1 (отобрано 1).\n\n'
      + '[#local_k07 · 20260928]\nЗаметка 1: "Прокат"\nВзяли инструмент напрокат.';
    expect(auditAnswer('Эта запись — только заголовок, без текста.', doc))
      .toMatchObject({ note_text_denied: false });
  });

  it('регистр и ё не важны', () => {
    expect(auditAnswer('ТЕКСТА ЗАМЕТКИ НЕТ.', ATTACHED_DOC)).toMatchObject({ note_text_denied: true });
  });
});

describe('MD-2: «ничего не нашлось» при найденных результатах', () => {
  it('счёт при непустом блоке результатов', () => {
    expect(auditAnswer('По этому запросу ничего не нашлось.', RESULTS_DOC))
      .toMatchObject({ empty_claim_with_results: true });
  });

  it('законное «ничего не нашлось» при пустом блоке не считается', () => {
    expect(auditAnswer('По этому запросу в базе ничего не нашлось.', NO_RESULTS_DOC))
      .toMatchObject({ empty_claim_with_results: false });
  });

  it('пустой блок результатов без строки поиска тоже не считается', () => {
    const doc = RESULTS_DOC.replace('Найдено заметок: 2 (отобрано 2 по релевантности).', 'Найдено заметок: 0 (отобрано 0 по релевантности).')
      .replace('[#local_k07 · 20260928]\nЗаметка 1: "Прокат"\nВзяли инструмент напрокат.', '');
    expect(auditAnswer('Ничего не нашлось.', doc)).toMatchObject({ empty_claim_with_results: false });
  });
});

describe('MD-2: ссылки, которых нет в материалах', () => {
  it('номер из материалов не является выдуманным', () => {
    expect(auditAnswer('Смотри [#local_v102] и [#local_k07].', RESULTS_DOC)).toMatchObject({ foreign_ids: 0 });
  });

  it('выдуманный номер засчитывается, повтор не удваивает', () => {
    expect(auditAnswer('Ищи [#5742], потом [#5742] снова.', ATTACHED_DOC)).toMatchObject({ foreign_ids: 1 });
    expect(auditAnswer('Ищи [#5742] и [#note-7].', ATTACHED_DOC)).toMatchObject({ foreign_ids: 2 });
  });

  it('скопка с шапочной датой сверяется по номеру, а не по строке целиком', () => {
    expect(auditAnswer('Как в [#local_v102 · 20261009].', ATTACHED_DOC)).toMatchObject({ foreign_ids: 0 });
  });
});

describe('MD-2: когда аудита нет', () => {
  it('без материалов — null', () => {
    expect(auditAnswer('Текста заметки нет.', '')).toBeNull();
    expect(auditAnswer('Текста заметки нет.', null)).toBeNull();
    expect(auditAnswer('Текста заметки нет.', undefined)).toBeNull();
  });

  it('пустой ответ — null (считать нечего)', () => {
    expect(auditAnswer('   ', ATTACHED_DOC)).toBeNull();
  });

  it('результат — только булевы и числа', () => {
    const audit = auditAnswer('Заголовок без текста, [#5742]', ATTACHED_DOC);
    expect(audit).toEqual({ note_text_denied: true, empty_claim_with_results: false, foreign_ids: 1, quote_unquoted: 0, notes_claim_no_ref: 0, weak_ref: 0, date_off_header: 0, question_run: 0, either_or_end: 0 });
  });

  // MD-3: тот же счётчик, что снимает кавычки на клиенте.
  it('quote_unquoted считает кавычки вне материалов хода', () => {
    const answer = 'Соня сказала «я не хочу ехать на этот концерт», и замолчала.';
    expect(auditAnswer(answer, ATTACHED_DOC)).toMatchObject({ quote_unquoted: 1 });
    // сверка идёт по расширенным материалам (память и реплики хода), как у клиента
    expect(auditAnswer(answer, ATTACHED_DOC, `${ATTACHED_DOC}\n${answer}`)).toMatchObject({ quote_unquoted: 0 });
  });
});
