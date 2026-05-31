import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('AI prompt sources stay in sync', () => {
  it('functions/src/shared/prompts.ts matches src/shared/ai/prompts.ts', () => {
    const canonical = readFileSync(resolve(__dirname, '../../shared/ai/prompts.ts'), 'utf8');
    const fnCopy = readFileSync(resolve(__dirname, '../../../functions/src/shared/prompts.ts'), 'utf8');
    expect(fnCopy.trim()).toBe(canonical.trim());
  });
});
