import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scrubPii } from '../piiScrub';

// R4-4: темы и названия доменов выводятся из дневника. В журнале активности
// (localStorage, копируется в баг-репорт) им не место — ни в тексте
// action/impact, ни в полях контекста.
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe('R4-4: no diary-derived text in the activity log', () => {
  it('reportAIDegradation action/impact are fixed strings', () => {
    const offenders = walk('src').filter(f =>
      /reportAIDegradation\(\{[^}]*(action|impact):\s*`[^`]*\$\{/s.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('scrubPii drops themes', () => {
    expect(scrubPii({ action: 'x', themes: ['личное'] })).toEqual({ action: 'x' });
  });
});
