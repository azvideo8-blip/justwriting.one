#!/usr/bin/env node
// MF-18 (SA-1): `var(--x)` без запасного значения, где `--x` не объявлена в
// src/index.css, вычисляется в «ничего» — так степпер первого входа стал
// прозрачным (`bg-[var(--surface-base)]`, а объявлена `--color-surface-base`).
// Запуск: node scripts/check-undefined-css-vars.mjs [корень]; выход 1 при находке.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// Имя → почему его пока не трогаем. Каждое исключение — с причиной.
const ALLOW = new Map([
  // Десктопные разделители дней в ArchiveNoteList.tsx: сегодня невидимы, а
  // починка покажет их на десктопе, который этот пакет не меняет. Решает владелец.
  ['--border-subtle', 'desktop day dividers, owner decides'],
]);

export function findUndefinedVars(root) {
  const css = readFileSync(join(root, 'src/index.css'), 'utf8');
  const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const files = readdirSync(join(root, 'src'), { recursive: true })
    .map(String)
    .filter((f) => /\.(tsx?|css)$/.test(f) && !/(__tests__|\.test\.)/.test(f));
  const found = [];
  for (const f of files) {
    readFileSync(join(root, 'src', f), 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/var\((--[\w-]+)(\s*,)?/g)) {
        if (m[2] || defined.has(m[1]) || ALLOW.has(m[1]) || /^--(tw|radix)/.test(m[1])) continue;
        found.push(`${relative(root, join(root, 'src', f))}:${i + 1} ${m[1]}`);
      }
    });
  }
  return found;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = findUndefinedVars(process.argv[2] ?? process.cwd());
  for (const line of found) console.log(`::error::undeclared CSS variable ${line}`);
  process.exit(found.length ? 1 : 0);
}
