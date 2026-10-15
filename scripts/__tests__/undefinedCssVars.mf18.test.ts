// MF-18 (SA-1): гейт «var(--x) без объявления». Степпер первого входа был
// прозрачным из-за `var(--surface-base)` — переменной нет в index.css.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findUndefinedVars } from '../check-undefined-css-vars.mjs';

const SCRIPT = join(process.cwd(), 'scripts/check-undefined-css-vars.mjs');

describe('MF-18: undeclared CSS variables gate', () => {
  it('the repo has none (outside the commented allow-list)', () => {
    expect(findUndefinedVars(process.cwd())).toEqual([]);
  });

  it('exits non-zero on a probe file with var(--does-not-exist)', () => {
    const root = mkdtempSync(join(tmpdir(), 'mf18-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/index.css'), ':root { --declared: 1px; }');
    writeFileSync(join(root, 'src/probe.tsx'), 'const a = "bg-[var(--declared)] w-[var(--does-not-exist)] h-[var(--fallback,1px)]";');
    const run = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('src/probe.tsx:1 --does-not-exist');
    expect(run.stdout).not.toContain('--declared');
    expect(run.stdout).not.toContain('--fallback');
  });
});
