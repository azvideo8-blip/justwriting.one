import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DB_VERSION } from '../localDb';

describe('AU-4: IndexedDB версия в localDb.ts', () => {
  it('константа DB_VERSION экспортируется и равна 21', () => {
    expect(DB_VERSION).toBe(21);
  });

  it('константа совпадает с последней веткой oldVersion < N в upgradeJustWritingDB', () => {
    const src = readFileSync(join(process.cwd(), 'src/core/storage/localDb.ts'), 'utf-8');
    const matches = [...src.matchAll(/if\s*\(\s*oldVersion\s*<\s*([A-Za-z0-9_]+)\s*\)/g)];
    const lastMatch = matches[matches.length - 1];
    expect(lastMatch).toBeDefined();
    const lastBranch = lastMatch![1];
    if (lastBranch === 'DB_VERSION') {
      expect(lastBranch).toBe('DB_VERSION');
    } else {
      expect(Number(lastBranch)).toBe(DB_VERSION);
    }
  });

  it('все вызовы openDB в localDb.ts используют DB_VERSION вместо хардкода', () => {
    const src = readFileSync(join(process.cwd(), 'src/core/storage/localDb.ts'), 'utf-8');
    const openDbCalls = [...src.matchAll(/openDB(?:<[^>]+>)?\s*\([^,]+,\s*([^,)]+)/g)];
    expect(openDbCalls.length).toBeGreaterThanOrEqual(3);
    for (const m of openDbCalls) {
      expect(m[1]?.trim()).toBe('DB_VERSION');
    }
  });
});
