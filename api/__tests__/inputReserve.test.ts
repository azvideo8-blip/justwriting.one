// AUD-19: EFFECTIVE_TOKEN_LIMIT резервируется против ответа; вход не покрыт.
// Оценка входа должна расти вместе с размером заметки, иначе длинный документ
// проходит под резервом, который покрывает только ответ.
import { describe, expect, it } from 'vitest';
import { estimateInputTokens } from '../../src/shared/ai/aiPolicy.js';

describe('estimateInputTokens (AUD-19)', () => {
  it('counts every provided part', () => {
    expect(estimateInputTokens(['abcdef', 'gh'])).toBe(Math.ceil(8 / 3));
  });

  it('ignores null and undefined parts', () => {
    expect(estimateInputTokens([null, undefined, 'abc'])).toBe(1);
  });

  it('grows with a long note instead of staying at the output budget', () => {
    const longNote = 'x'.repeat(30_000);
    const estimate = estimateInputTokens([longNote]);
    // 10k tokens of input — far above any output-only allowance.
    expect(estimate).toBeGreaterThan(9_000);
  });
});
