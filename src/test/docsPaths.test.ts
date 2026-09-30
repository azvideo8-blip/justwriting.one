import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// L-13: пути, названные в живой документации, обязаны существовать. Прежний
// runbook называл src/core/services/featureFlags.ts — файла нет, а раздел
// рапортовал «kill switches». Тест красится на любом вымершем пути.
const DOCS = [
  resolve(__dirname, '../../docs/security-invariants.md'),
  resolve(__dirname, '../../docs/ops/runbook.md'),
];

// Путь в бэктиках; `supabase/scripts/...` не должен давать ложный
// `scripts/...`. После `src/`/`scripts/` не бывает конца слова.
const PATH_RE = /(?<![\w/])(?:src|scripts)\/[A-Za-z0-9_.\-/]+[A-Za-z0-9]/g;

describe('paths named in docs exist (L-13)', () => {
  for (const doc of DOCS) {
    it(`${doc.split('/').slice(-2).join('/')} names only existing src/scripts paths`, () => {
      const text = readFileSync(doc, 'utf-8');
      const named = [...new Set(text.match(PATH_RE) ?? [])];
      expect(named.length, 'тест обязан реально сканировать пути').toBeGreaterThan(0);
      const missing = named.filter(p => !existsSync(resolve(__dirname, '../..', p)));
      expect(missing, `вымершие пути в ${doc}`).toEqual([]);
    });
  }
});
