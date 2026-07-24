import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INJECTION_PATTERNS as clientPatterns } from '../../shared/ai/injectionPatterns';

// The Cloud Functions copy is read as TEXT, not imported: importing it would pull
// functions/src/shared/aiUtils.ts (and its langfuse / isomorphic-dompurify deps)
// into the root TypeScript program, which resolves locally but not in CI, where
// only the root package's dependencies are installed. Same approach as
// promptsParity.test.ts.
// Line-based on purpose: both copies declare one regex literal per line. Parsing
// the array blocks instead would truncate at the first `]`, which occurs *inside*
// patterns like /\[INST\]/i and /[её]/.
function extractPatternSources(source: string): string[] {
  return source
    .split('\n')
    .map(line => line.trim())
    .filter(line => !line.startsWith('//') && /^\/.*\/[a-z]*,$/.test(line))
    .map(line => line.replace(/,$/, '').replace(/\/[a-z]*$/, '').replace(/^\//, ''));
}

describe('SEC-52 Injection Pattern Parity', () => {
  it('asserts that client and Cloud Functions injection pattern lists are identical', () => {
    const functionsSource = readFileSync(
      resolve(__dirname, '../../../functions/src/shared/aiUtils.ts'),
      'utf8',
    );

    const fromFunctions = extractPatternSources(functionsSource).sort();
    const fromClient = clientPatterns.map(p => p.source).sort();

    // Guard against the extractor silently matching nothing and passing vacuously.
    expect(fromFunctions.length).toBe(clientPatterns.length);
    expect(fromClient).toEqual(fromFunctions);
  });
});
