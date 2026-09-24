import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { translations } from '../index';

function collectLiteralTKeys(dir: string, acc: Map<string, string[]>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectLiteralTKeys(p, acc);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) continue;
    const src = readFileSync(p, 'utf-8');
    for (const m of src.matchAll(/\bt\(\s*['"]([a-zA-Z0-9_]+)['"]/g)) {
      const key = m[1];
      if (key) {
        if (!acc.has(key)) acc.set(key, []);
        acc.get(key)!.push(p);
      }
    }
  }
}

describe('AU-2: сканер литеральных ключей перевода', () => {
  it('все литеральные t("...") в src/ (не тесты) есть в translations', () => {
    const keysMap = new Map<string, string[]>();
    collectLiteralTKeys(join(process.cwd(), 'src'), keysMap);

    expect(keysMap.size).toBeGreaterThan(0);

    const missing: { key: string; files: string[] }[] = [];
    for (const [key, files] of keysMap.entries()) {
      const trans = translations[key];
      if (!trans || !trans.ru || !trans.en) {
        missing.push({ key, files });
      }
    }

    expect(
      missing,
      `Найдены вызовы t('...'), для которых нет перевода в translations: ${JSON.stringify(missing, null, 2)}`,
    ).toEqual([]);
  });
});
