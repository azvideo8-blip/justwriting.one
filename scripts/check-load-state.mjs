#!/usr/bin/env node
// load-state-fable: храповики против трёх классов дейликов 03.11–19.11.
//  1. «Не прочиталось = пусто»   — своё `[loading, setLoading] = useState` в новом
//     файле (чтение обязано отдавать LoadState из src/shared/loadState.ts);
//     EmptyState мимо LoadStateView.
//  2. «Правка в одном из двух входов» — самодельная панель «Повторить» мимо
//     LoadNotice (у каждой копии свои ветки).
//  3. «Результат проглочен — показан успех» — сырой тост успеха
//     (`showToast(x)` / `showToast(x, 'success')`) мимо reportMutationResult.
// Старые места перечислены в scripts/load-state-baseline.json; список только
// убывает: новое место — красный, исправленное место, оставшееся в списке, —
// тоже красный (убери из списка).
// Блокируют: «Повторить» и EmptyState мимо разбора. Своё loading и сырые тосты
// успеха — с 19.11 неделю в наблюдении (OBSERVE_ONLY): пишут, что заблокировали
// бы, но не роняют. Включить блокировку — убрать ключ из OBSERVE_ONLY.
// Запуск: node scripts/check-load-state.mjs [корень]; выход 1 при блокирующей находке.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isMainRun, toPosixPath } from './gate-paths.mjs';

const SHARED = new Set([
  'src/shared/components/LoadStateView.tsx',
  'src/shared/mutationResult.ts',
  'src/shared/components/Toast.tsx',
]);

function sources(root) {
  return readdirSync(join(root, 'src'), { recursive: true })
    .map(entry => `src/${toPosixPath(String(entry))}`)
    .filter(file => /\.tsx?$/.test(file) && !/(__tests__|\.test\.|\/test\/|\/testing\/)/.test(file))
    .filter(file => !SHARED.has(file))
    .sort()
    .map(file => ({ file, text: readFileSync(join(root, file), 'utf8') }));
}

/** Аргументы вызова `showToast(` с позиции после скобки; null — скобки не сошлись. */
function callArgs(text, start) {
  const args = [];
  let depth = 0, quote = null, from = start;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) { args.push(text.slice(from, i).trim()); return args.filter(Boolean); }
      depth--;
    } else if (ch === ',' && depth === 0) { args.push(text.slice(from, i).trim()); from = i + 1; }
  }
  return null;
}

/** Сколько в тексте тостов успеха: тип не указан (по умолчанию success) или 'success'. */
export function countRawSuccessToasts(text) {
  let count = 0;
  for (const match of text.matchAll(/\bshowToast\(/g)) {
    const args = callArgs(text, match.index + match[0].length);
    if (!args || args.length === 0) continue;
    if (args.length === 1 || /^['"]success['"]$/.test(args[1])) count++;
  }
  return count;
}

export function scanLoadState(root = process.cwd()) {
  const found = { retryPanels: [], ownLoadingState: [], emptyStateOutsideView: [], rawSuccessToasts: {} };
  for (const { file, text } of sources(root)) {
    if (/\bt\(\s*['"]retry['"]\s*\)/.test(text)) found.retryPanels.push(file);
    if (/const \[\w*[lL]oading\w*, set\w+\] = useState/.test(text)) found.ownLoadingState.push(file);
    if (/<EmptyState\b/.test(text) && !/<LoadStateView\b/.test(text) && file !== 'src/shared/components/EmptyState.tsx') found.emptyStateOutsideView.push(file);
    const toasts = countRawSuccessToasts(text);
    if (toasts > 0) found.rawSuccessToasts[file] = toasts;
  }
  return found;
}

export const OBSERVE_ONLY = new Set(['ownLoadingState', 'rawSuccessToasts']);

/**
 * Сравнить находки с базой: `blocking` роняет ворота, `observed` — только
 * сообщается (правила из `observeOnly`).
 */
export function compareWithBaseline(found, baseline, observeOnly = OBSERVE_ONLY) {
  const blocking = [], observed = [];
  const into = key => (observeOnly.has(key) ? observed : blocking);
  const lists = [
    ['retryPanels', 'самодельное «Повторить» — возьми LoadNotice / LoadStateView (src/shared/components/LoadStateView.tsx)'],
    ['ownLoadingState', 'своё состояние loading — чтение отдаёт LoadState (src/shared/loadState.ts); для кнопки назови busy/saving'],
    ['emptyStateOutsideView', 'EmptyState мимо LoadStateView — «пусто» рисуется только веткой empty'],
  ];
  for (const [key, hint] of lists) {
    const base = new Set(baseline[key] ?? []);
    const now = new Set(found[key]);
    for (const file of now) if (!base.has(file)) into(key).push(`${file}: ${hint}`);
    for (const file of base) if (!now.has(file)) into(key).push(`${file}: исправлено — убери из ${key} в scripts/load-state-baseline.json`);
  }
  const baseToasts = baseline.rawSuccessToasts ?? {};
  for (const file of new Set([...Object.keys(found.rawSuccessToasts), ...Object.keys(baseToasts)])) {
    const now = found.rawSuccessToasts[file] ?? 0;
    const base = baseToasts[file] ?? 0;
    if (now > base) into('rawSuccessToasts').push(`${file}: тостов успеха ${now}, в базе ${base} — итог операции сообщает reportMutationResult / runMutation (src/shared/mutationResult.ts)`);
    if (now < base) into('rawSuccessToasts').push(`${file}: тостов успеха стало ${now} — уменьши rawSuccessToasts в scripts/load-state-baseline.json (было ${base})`);
  }
  return { blocking, observed };
}

if (isMainRun(process.argv[1], import.meta.url)) {
  const root = process.argv[2] ?? process.cwd();
  const found = scanLoadState(root);
  if (process.argv.includes('--print')) {
    console.log(JSON.stringify(found, null, 2));
    process.exit(0);
  }
  const baseline = JSON.parse(readFileSync(join(root, 'scripts/load-state-baseline.json'), 'utf8'));
  const { blocking, observed } = compareWithBaseline(found, baseline);
  for (const line of observed) console.log(`::warning::load-state (наблюдение, заблокировал бы) ${line}`);
  for (const line of blocking) console.log(`::error::load-state ${line}`);
  console.log(`load-state: ${blocking.length ? 'ошибки' : 'ok'}${observed.length ? `, в наблюдении ${observed.length}` : ''}`);
  process.exit(blocking.length ? 1 : 0);
}
