import { describe, it, expect } from 'vitest';
import { SUMMARY_SYSTEM_PROMPT, validateVerbatimQuote } from '../summarizeDocument';
import { extractVerbatimSentence } from '../../../../src/features/ai/services/AIThemeLedgerService';

describe('AG-EXTRACT-A — Summary Prompt v2 & Verbatim Guard Eval', () => {
  it('Requirement 1: SUMMARY_SYSTEM_PROMPT preserves required anchor substrings', () => {
    expect(SUMMARY_SYSTEM_PROMPT).toContain('insights: ключевые мысли');
    expect(SUMMARY_SYSTEM_PROMPT).toContain('extractedFacts: конкретные факты');
    expect(SUMMARY_SYSTEM_PROMPT).toContain('quotableSentence:');
    expect(SUMMARY_SYSTEM_PROMPT).toContain('authorPhrases:');
  });

  it('Requirement 2: Server-side Verbatim Guard accepts exact substring', () => {
    const text = 'Сегодня я долго гулял по парку и думал о будущем.';
    const exactQuote = 'Сегодня я долго гулял по парку';
    expect(validateVerbatimQuote(text, exactQuote)).toBe(exactQuote);
  });

  it('Requirement 3: Server-side Verbatim Guard accepts normalized tolerance (ё/е, typography quotes)', () => {
    const text = '«Всё пройдет», — повторил он тихо.';
    const candidateQuote = '"Все пройдет"';
    expect(validateVerbatimQuote(text, candidateQuote)).toBe(candidateQuote);
  });

  it('Requirement 4: Server-side Verbatim Guard drops paraphrased quotes', () => {
    const text = 'Сегодня я долго гулял по парку и думал о будущем.';
    const paraphraseQuote = 'Автор ходил по парку и размышлял об учебе';
    expect(validateVerbatimQuote(text, paraphraseQuote)).toBeUndefined();
  });

  it('Requirement 5: AIThemeLedgerService extractVerbatimSentence uses quotableSentence when exact match, else falls back', () => {
    const noteContent = 'Первое предложение. Второе предложение про работу и эта работа очень важная. Третье предложение.';
    const exactQuote = 'Второе предложение про работу и эта работа очень важная.';
    const invalidQuote = 'Несуществующая цитата';

    // Exact quote match succeeds
    expect(extractVerbatimSentence(noteContent, 'работа', exactQuote)).toBe(exactQuote);

    // Invalid quote falls back to sentence matching algorithm
    expect(extractVerbatimSentence(noteContent, 'работа', invalidQuote)).toBe(exactQuote);
  });
});
