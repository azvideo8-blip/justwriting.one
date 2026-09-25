import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DB_VERSION } from '../localDb';

describe('AU-4: IndexedDB версия в localDb.ts', () => {
  // Ветки миграций — числа, не константа: `oldVersion < DB_VERSION` при
  // следующем подъёме заново запустил бы старую ветку на уже обновлённых базах.
  it('последняя ветка oldVersion < N — число, равное DB_VERSION', () => {
    const src = readFileSync(join(process.cwd(), 'src/core/storage/localDb.ts'), 'utf-8');
    const branches = [...src.matchAll(/if\s*\(\s*oldVersion\s*<\s*([A-Za-z0-9_]+)\s*\)/g)].map(m => m[1]);
    expect(branches.every(b => /^\d+$/.test(b!))).toBe(true);
    expect(Number(branches[branches.length - 1])).toBe(DB_VERSION);
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
