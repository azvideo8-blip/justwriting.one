import { describe, it, expect } from 'vitest';
import {
  RERANK_SYSTEM_PROMPT,
  buildRerankUserMessage,
  parseRerankSelection,
  RerankResponseError,
} from '../rerankPrompt.js';

/**
 * SA-7: промпт, форма сообщения и разбор ответа ранжирования живут в одном
 * модуле, откуда их берут и прод, и харнес.
 *
 * Разбор — единственное место, где «модель ответила пусто» отличается от
 * «модель молчала / прислала мусор». Первое — вердикт, второе — ошибка
 * харнеса. Раньше харнес сваливал и то, и другое в `failed`, и пустой ответ
 * транспорта попадал в точность ранжирования.
 */

const CANDIDATES = ['doc_kofe', 'doc_chay', 'doc_gory'];

describe('rerankPrompt: разбор продового контракта', () => {
  it('idx → идентификаторы кандидатов в порядке релевантности', () => {
    expect(parseRerankSelection('{"idx":[3,1]}', CANDIDATES, 5)).toEqual(['doc_gory', 'doc_kofe']);
  });

  it('номер вне диапазона и дубли отбрасываются', () => {
    expect(parseRerankSelection('{"idx":[1,9,1,"2"]}', CANDIDATES, 5)).toEqual(['doc_kofe', 'doc_chay']);
  });

  it('maxResults обрезает хвост', () => {
    expect(parseRerankSelection('{"idx":[3,2,1]}', CANDIDATES, 2)).toEqual(['doc_gory', 'doc_chay']);
  });

  it('ответ в блоке кода разбирается', () => {
    expect(parseRerankSelection('```json\n{"idx":[2]}\n```', CANDIDATES, 5)).toEqual(['doc_chay']);
  });

  it('старое поле ids принимается, неизвестные идентификаторы отбрасываются', () => {
    expect(parseRerankSelection('{"ids":["doc_chay","doc_нет_такого"]}', CANDIDATES, 5))
      .toEqual(['doc_chay']);
  });

  it('валидный JSON без выбора — пустой список, а не ошибка', () => {
    expect(parseRerankSelection('{"idx":[]}', CANDIDATES, 5)).toEqual([]);
    expect(parseRerankSelection('{"note":"нет релевантных"}', CANDIDATES, 5)).toEqual([]);
  });

  it('пустой ответ — ошибка разбора, а не «ничего не нашлось»', () => {
    expect(() => parseRerankSelection('', CANDIDATES, 5)).toThrow(RerankResponseError);
    expect(() => parseRerankSelection('   \n ', CANDIDATES, 5)).toThrow('Rerank response was empty.');
  });

  it('не-JSON — ошибка разбора', () => {
    expect(() => parseRerankSelection('Вот ваши заметки: 1, 2, 3', CANDIDATES, 5))
      .toThrow('Rerank response was not valid JSON.');
  });
});

describe('rerankPrompt: форма запроса', () => {
  it('системный промпт требует номера кандидатов, а не идентификаторы', () => {
    expect(RERANK_SYSTEM_PROMPT).toContain('{"idx":[1,2]}');
    expect(RERANK_SYSTEM_PROMPT).not.toContain('"ids"');
  });

  it('user-сообщение содержит запрос, карточки и потолок выбора', () => {
    expect(buildRerankUserMessage('кофе утром', '[1]\nРецепт', 3)).toBe(
      'Запрос пользователя: "кофе утром"\n\nКандидаты-заметки:\n[1]\nРецепт\n\nВыбери до 3 самых релевантных.'
    );
  });
});
