#!/usr/bin/env node
// A-8: три вида спиннера. Самописный `rounded-full animate-spin border-*`
// дублирует LoadingSpinner и красится мимо токенов (на светлой теме белая
// дуга невидима). Разрешены только LoadingSpinner и `<Button isLoading>`.
// Запуск: node scripts/check-self-spinners.mjs [корень]; выход 1 при находке.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isMainRun, toPosixPath } from './gate-paths.mjs';

const ALLOWED = new Set(['src/shared/components/LoadingSpinner.tsx']);
const SELF_SPINNER = /animate-spin[^"'`]*rounded-full|rounded-full[^"'`]*animate-spin/;

export function findSelfWrittenSpinners(root = process.cwd()) {
  const files = readdirSync(join(root, 'src'), { recursive: true })
    .map(entry => toPosixPath(String(entry)))
    .filter(file => /\.tsx$/.test(file) && !/(__tests__|\.test\.)/.test(file))
    .filter(file => !ALLOWED.has(`src/${file}`));
  const found = [];
  for (const file of files) {
    const full = join(root, 'src', file);
    readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
      if (SELF_SPINNER.test(line)) found.push(`${relative(root, full)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  return found;
}

if (isMainRun(process.argv[1], import.meta.url)) {
  const found = findSelfWrittenSpinners(process.argv[2] ?? process.cwd());
  for (const line of found) console.log(`::error::self-written spinner ${line}`);
  console.log(`self-spinners: ${found.length ? 'ошибки' : 'ok'}`);
  process.exit(found.length ? 1 : 0);
}
