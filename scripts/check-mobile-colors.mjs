#!/usr/bin/env node
// MF-24 (SA-14): в мобильных компонентах — только слоты темы. `white/…`,
// `black/…`, `rgba(` и `#hex` ломаются в трёх темах из четырёх (DESIGN.md, The
// Slot Rule). Исключение — строка с комментарием `color-ok: <причина>` (или он
// строкой выше): затемнение под листом и тени одинаковы в любой теме.
// R7Q-032: относительные пути с `\` (Windows) нормализуются до `/` — иначе
// отбор `Mobile…tsx` не находит ни одного файла, и гейт зелёный, ничего не
// проверив.
// Запуск: node scripts/check-mobile-colors.mjs [корень]; выход 1 при находке.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isMainRun, toPosixPath } from './gate-paths.mjs';

const FIXED = ['src/shared/components/ModalShell.tsx', 'src/features/navigation/components/BottomNav.tsx'];
const BAD = /\b(?:white|black)\/|rgba\(|#[0-9a-fA-F]{3,8}\b/;

/** Мобильный компонент: имя файла `Mobile….tsx`, не тест и не `__tests__`. */
export function isMobileSourceFile(path) {
  return /(^|\/)Mobile[^/]*\.tsx$/.test(path) && !/(__tests__|\.test\.)/.test(path);
}

/** Отбор по тому, что отдал `readdirSync(…, {recursive:true})`: на Windows это пути с `\`. */
export function selectMobileFiles(entries) {
  return entries
    .map(e => toPosixPath(join('src', String(e))))
    .filter(isMobileSourceFile);
}

/** Файлы, которые гейт обязан посмотреть: мобильные компоненты + два «фиксированных». */
export function mobileSourceFiles(root) {
  return selectMobileFiles(readdirSync(join(root, 'src'), { recursive: true }))
    .concat(FIXED.filter(f => { try { readFileSync(join(root, f)); return true; } catch { return false; } }));
}

export function findHardcodedColors(root) {
  const files = mobileSourceFiles(root);
  const found = [];
  for (const f of files) {
    const lines = readFileSync(join(root, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!BAD.test(line) || /^\s*(\/\/|\*|\{\/\*)/.test(line)) return;
      if (/color-ok:/.test(line) || /color-ok:/.test(lines[i - 1] ?? '')) return;
      found.push(`${toPosixPath(relative(root, join(root, f)))}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  return found;
}

if (isMainRun(process.argv[1], import.meta.url)) {
  const found = findHardcodedColors(process.argv[2] ?? process.cwd());
  for (const line of found) console.log(`::error::hard-coded colour ${line}`);
  process.exit(found.length ? 1 : 0);
}
