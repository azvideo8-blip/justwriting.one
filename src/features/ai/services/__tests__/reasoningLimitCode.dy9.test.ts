// Дейлик 29.10 запуск 2, Н-4 (DY9-12): серверный отказ «Reasoning limit reached.»
// (resource-exhausted, 429) mapAIError читал как RATE_LIMIT — человек видел
// «подождите немного» вместо «лимит рассуждений исчерпан до завтра».
// Мутация: убрать ветку 'reasoning' → красный.
import { describe, it, expect } from 'vitest';
import { mapAIError } from '../AIService';

describe('DY9-12: лимит рассуждений различается', () => {
  it('«Reasoning limit reached.» → REASONING_LIMIT', () => {
    const e = Object.assign(new Error('Reasoning limit reached.'), { code: 'resource-exhausted', status: 429 });
    expect(mapAIError(e)).toBe('REASONING_LIMIT');
  });
  it('контроль: дневной лимит и частота — как раньше', () => {
    expect(mapAIError(Object.assign(new Error('Daily limit reached.'), { code: 'resource-exhausted', status: 429 }))).toBe('DAILY_LIMIT');
    expect(mapAIError(Object.assign(new Error('Too many requests. Please wait 5 seconds.'), { code: 'resource-exhausted', status: 429 }))).toBe('RATE_LIMIT');
  });
});
