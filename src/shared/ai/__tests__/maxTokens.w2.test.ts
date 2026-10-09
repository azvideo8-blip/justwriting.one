// W-2: потолок ответа должен следовать за выбранной человеком длиной. До правки
// getMaxTokens возвращал 8 192 для любого не-служебного хода, и в живом прогоне
// §4.7 два ответа из 372 разрослись до 7–16 тыс. знаков.
//
// Мутация, на которой тест краснеет: вернуть `reasoning ? 16384 : 8192` —
// то есть игнорировать responseLength.
import { describe, it, expect } from 'vitest';
import { getMaxTokens } from '../aiPolicy';

describe('W-2: потолок вывода по длине ответа', () => {
  it('внешний ход без рассуждения получает потолок по выбранной длине', () => {
    expect(getMaxTokens(false, false, undefined, 'short')).toBe(700);
    expect(getMaxTokens(false, false, undefined, 'standard')).toBe(1500);
    expect(getMaxTokens(false, false, undefined, 'detailed')).toBe(3000);
    expect(getMaxTokens(false, false, undefined, undefined)).toBe(3000);
  });

  it('пустое и неизвестное поле длины не поднимают потолок выше detailed', () => {
    expect(getMaxTokens(false, false, undefined, null)).toBe(3000);
    expect(getMaxTokens(false, null, undefined, 'short')).toBe(700);
  });

  it('рассуждение остаётся на 16 384 при любой длине', () => {
    for (const len of ['short', 'standard', 'detailed', undefined] as const) {
      expect(getMaxTokens(false, true, undefined, len)).toBe(16384);
    }
  });

  it('служебные вызовы не меняются', () => {
    expect(getMaxTokens(true, false, 'auto_name', 'short')).toBe(256);
    expect(getMaxTokens(true, false, 'query_expand', 'detailed')).toBe(256);
    expect(getMaxTokens(true, false, 'system_task', 'detailed')).toBe(2048);
    expect(getMaxTokens(true, false, undefined)).toBe(256);
  });
});
