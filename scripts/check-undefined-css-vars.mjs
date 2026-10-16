#!/usr/bin/env node
// MF-18 (SA-1): `var(--x)` без запасного значения, где `--x` не объявлена в
// src/index.css, вычисляется в «ничего» — так степпер первого входа стал
// прозрачным (`bg-[var(--surface-base)]`, а объявлена `--color-surface-base`).
// R7F-027: «объявлена» считает так, как считает браузер — строка вида
// `--x:` внутри комментария объявлением не является, а объявление только в одной
// из четырёх `.theme-*` не делает переменную существующей в остальных темах.
// Запуск: node scripts/check-undefined-css-vars.mjs [корень]; выход 1 при находке.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainRun, toPosixPath } from './gate-paths.mjs';

// Имя → почему его пока не трогаем. Каждое исключение — с причиной.
const ALLOW = new Map([
  // Десктопные разделители дней в ArchiveNoteList.tsx: сегодня невидимы, а
  // починка покажет их на десктопе, который этот пакет не меняет. Решает владелец.
  ['--border-subtle', 'desktop day dividers, owner decides'],
]);

export function stripCssComments(css) {
  // Блочный комментарий CSS; строки с `/*` внутри значения не рассматриваем —
  // в index.css их нет, а экранирование строк в CSS выглядит как `content: "/*"`,
  // чего гейт и не должен ловить.
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Тело блока, начинающегося с `{` после позиции `at` (скобки считаются вложенно). */
function blockBody(src, at) {
  const open = src.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

const varNames = (text) => new Set([...text.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));

/** Все блоки CSS: текст селектора перед `{` и сбалансированное тело. */
function* iterateBlocks(clean) {
  for (let open = clean.indexOf('{'); open >= 0; open = clean.indexOf('{', open + 1)) {
    const boundary = Math.max(clean.lastIndexOf('}', open - 1), clean.lastIndexOf('{', open - 1)) + 1;
    const body = blockBody(clean, open);
    if (body === null) continue;
    yield { selector: clean.slice(boundary, open), body };
  }
}

/**
 * Что гейт считает объявленным (R7F-027):
 * `global`  — `:root` или `@theme` (живёт при любой теме);
 * `everyTheme` — переменная, которую называет КАЖДЫЙ блок `.theme-*`: тогда она
 * определена при любой выбранной теме, даже если её нет в `:root`.
 *
 * Темы группируются по имени: `.theme-a` в двух блоках (и `.theme-a .card`) —
 * одна тема, а не две. Иначе «есть во всех темах» зависело бы от того, сколько
 * раз автор написал селектор.
 */
export function collectDeclarations(css) {
  const clean = stripCssComments(css);
  const global = new Set();
  const themes = new Map();
  for (const { selector, body } of iterateBlocks(clean)) {
    const vars = varNames(body);
    if (/(^|[,\s])@theme(\s|$)/.test(selector) || /(^|[,\s]):root(\s|$|,)/.test(selector)) {
      for (const name of vars) global.add(name);
    }
    for (const m of selector.matchAll(/\.theme-[a-z0-9-]+/g)) {
      const set = themes.get(m[0]) ?? new Set();
      for (const name of vars) set.add(name);
      themes.set(m[0], set);
    }
  }
  const sets = [...themes.values()];
  const everyTheme = sets.length === 0
    ? new Set()
    : new Set([...sets[0]].filter(name => sets.every(set => set.has(name))));
  return { global, everyTheme, themeCount: sets.length };
}

export function isDeclared(name, decl) {
  return decl.global.has(name) || decl.everyTheme.has(name);
}

export function findUndefinedVars(root) {
  const css = readFileSync(join(root, 'src/index.css'), 'utf8');
  const decl = collectDeclarations(css);
  const files = readdirSync(join(root, 'src'), { recursive: true })
    .map(f => toPosixPath(join('src', String(f))))
    .filter(f => /\.(tsx?|css)$/.test(f) && !/(__tests__|\.test\.)/.test(f));
  const found = [];
  for (const f of files) {
    readFileSync(join(root, f), 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/var\((--[\w-]+)(\s*,)?/g)) {
        if (m[2] || isDeclared(m[1], decl) || ALLOW.has(m[1]) || /^--(tw|radix)/.test(m[1])) continue;
        found.push(`${toPosixPath(relative(root, join(root, f)))}:${i + 1} ${m[1]}`);
      }
    });
  }
  return found;
}

if (isMainRun(process.argv[1], import.meta.url)) {
  const found = findUndefinedVars(process.argv[2] ?? process.cwd());
  for (const line of found) console.log(`::error::undeclared CSS variable ${line}`);
  process.exit(found.length ? 1 : 0);
}
