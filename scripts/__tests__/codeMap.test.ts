import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DESCRIPTIONS, listModules, renderMap } from '../code-map';

// HB-4: CODE_MAP.md не должен расходиться с деревом.
const ROOT = resolve(import.meta.dirname, '../..');

describe('code map', () => {
  it('every module on disk has a description', () => {
    const missing = listModules(ROOT).filter((m) => !DESCRIPTIONS[m]);
    expect(missing, `нет описания в scripts/code-map.ts для: ${missing.join(', ')}`).toEqual([]);
  });

  it('no description for a module that is gone', () => {
    const onDisk = new Set(listModules(ROOT));
    const stale = Object.keys(DESCRIPTIONS).filter((k) => !onDisk.has(k));
    expect(stale, `описание есть, а папки нет: ${stale.join(', ')}`).toEqual([]);
  });

  it('CODE_MAP.md is up to date', () => {
    const onDisk = readFileSync(resolve(ROOT, 'CODE_MAP.md'), 'utf8');
    expect(onDisk === renderMap(ROOT), 'CODE_MAP.md устарел — запустите npm run code-map').toBe(true);
  });
});
