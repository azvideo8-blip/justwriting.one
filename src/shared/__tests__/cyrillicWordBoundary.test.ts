import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * `\b` is defined as a transition between `[A-Za-z0-9_]` and anything else, so
 * beside a Cyrillic letter it never matches — not even with Latin neighbours:
 *
 *   /\b(найди|поищи)\b/i.test('найди про Сашу')  === false
 *   /\b(найди|поищи)\b/i.test('a найди b')       === false
 *
 * Every Russian pattern written with it was dead from the day it was written.
 * That silently disabled the whole search-verb alternation in
 * NOTE_SEARCH_PATTERNS: "просканируй всё" ran no archive search at all.
 *
 * Use the boundaries the date patterns already use:
 *   left:  (?:^|[^а-яёА-ЯЁa-zA-Z0-9])
 *   right: (?![а-яёА-ЯЁa-zA-Z0-9])
 */
const SRC = resolve(__dirname, '../..');
const CYRILLIC = /[а-яёА-ЯЁ]/;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

/** Strips line comments so a Russian note beside a Latin-only regex is not flagged. */
function stripComments(line: string): string {
  return line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
}

describe('no regex relies on \\b next to Cyrillic', () => {
  it('finds no ASCII word boundary in a pattern that contains Russian', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((raw, i) => {
        const line = stripComments(raw);
        if (!line.includes('\\b')) return;
        if (!CYRILLIC.test(line)) return;
        offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}  ${line.trim()}`);
      });
    }

    expect(offenders, `\\b never matches beside Cyrillic — use (?:^|[^а-яёА-ЯЁa-zA-Z0-9]) / (?![а-яёА-ЯЁa-zA-Z0-9]):\n${offenders.join('\n')}`).toEqual([]);
  });

  it('demonstrates why, so the rule is not taken on faith', () => {
    expect(/\b(найди|поищи)\b/i.test('найди про Сашу')).toBe(false);
    expect(/\b(найди|поищи)\b/i.test('a найди b')).toBe(false);
    expect(/(?:^|[^а-яёА-ЯЁa-zA-Z0-9])(найди|поищи)/i.test('найди про Сашу')).toBe(true);
    expect(/(?:^|[^а-яёА-ЯЁa-zA-Z0-9])(найди|поищи)/i.test('ну поищи там')).toBe(true);
  });
});
