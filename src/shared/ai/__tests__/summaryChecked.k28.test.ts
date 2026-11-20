// К28-2: признак «ответ дал итог с проверкой» для метки summary в [chat-end].
// Мутации: убрать требование собрать сказанное (SUMMARY_GATHER_RE) → красный «только вопрос»;
// убрать требование проверочного вопроса → красный «собрал без вопроса».
import { describe, it, expect } from 'vitest';
import { summaryChecked } from '../summaryTurn';

describe('summaryChecked', () => {
  it('итог и «верно ли собрано?» → да', () => {
    expect(summaryChecked('Соберу, к чему мы пришли: правило сильнее срока. Верно ли собрано?')).toBe(true);
    expect(summaryChecked('Если коротко: отдых по правилу. Так?')).toBe(true);
    expect(summaryChecked('Вот как я это собрала: усталость настоящая. Или что-то важное я упустила?')).toBe(true);
  });
  it('только вопрос без итога → нет', () => {
    expect(summaryChecked('А откуда, как думаешь, взялось это правило?')).toBe(false);
    expect(summaryChecked('Верно ли я понимаю, что тебе тяжело?')).toBe(false);
  });
  it('собрал без проверочного вопроса → нет', () => {
    expect(summaryChecked('Соберу, к чему мы пришли: правило сильнее срока. Что будешь делать дальше?')).toBe(false);
    expect(summaryChecked('Подведу итог: правило сильнее срока.')).toBe(false);
  });
});
