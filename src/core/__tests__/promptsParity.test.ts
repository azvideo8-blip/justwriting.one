import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { sanitizeAiInputShared as clientSanitize } from '../../shared/ai/buildChatPrompt';
import { sanitizeAiInputShared as functionsSanitize } from '../../../functions/src/shared/buildChatPrompt';

describe('AI prompt sources stay in sync', () => {
  it('functions/src/shared/prompts.ts matches src/shared/ai/prompts.ts', () => {
    const canonical = readFileSync(resolve(__dirname, '../../shared/ai/prompts.ts'), 'utf8');
    const fnCopy = readFileSync(resolve(__dirname, '../../../functions/src/shared/prompts.ts'), 'utf8');
    expect(fnCopy.trim()).toBe(canonical.trim());
  });

  it('sanitizeAiInputShared has identical behavior on client and backend', () => {
    const testCases = [
      'Обычный текст без проблем.',
      'Текст с <|system|> и <|user|> и <|assistant|> токенами.',
      'Текст с <|im_start|> и <|im_end|> и [INST] и <developer> и <end_of_turn> тегами.',
      'Текст\u200B с\u200C невидимыми\u200D пробелами\uFEFF и\u00AD мягкими переносами.',
      'Смесь пробелов: \u2000 \u2001 \u2002 \u200A \u2028 \u2029 \u202F \u205F.',
      'A'.repeat(60_000), // Oversized input
    ];

    for (const testCase of testCases) {
      const clientOut = clientSanitize(testCase);
      const functionsOut = functionsSanitize(testCase);
      expect(clientOut).toBe(functionsOut);
      // Ensure length is capped at 50,000
      expect(clientOut.length).toBeLessThanOrEqual(50_000);
      expect(functionsOut.length).toBeLessThanOrEqual(50_000);
    }
  });
});
