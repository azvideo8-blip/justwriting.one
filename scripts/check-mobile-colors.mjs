#!/usr/bin/env node
// MF-24 (SA-14): в мобильных компонентах — только слоты темы. `white/…`,
// `black/…`, `rgba(` и `#hex` ломаются в трёх темах из четырёх (DESIGN.md, The
// Slot Rule). Исключение — строка с комментарием `color-ok: <причина>` (или он
// строкой выше): затемнение под листом и тени одинаковы в любой теме.
// Запуск: node scripts/check-mobile-colors.mjs [корень]; выход 1 при находке.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const FIXED = ['src/shared/components/ModalShell.tsx', 'src/features/navigation/components/BottomNav.tsx'];
const BAD = /\b(?:white|black)\/|rgba\(|#[0-9a-fA-F]{3,8}\b/;

export function findHardcodedColors(root) {
  const files = readdirSync(join(root, 'src'), { recursive: true })
    .map(f => join('src', String(f)))
    .filter(f => /(^|\/)Mobile[^/]*\.tsx$/.test(f) && !/(__tests__|\.test\.)/.test(f))
    .concat(FIXED.filter(f => { try { readFileSync(join(root, f)); return true; } catch { return false; } }));
  const found = [];
  for (const f of files) {
    const lines = readFileSync(join(root, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!BAD.test(line) || /^\s*(\/\/|\*|\{\/\*)/.test(line)) return;
      if (/color-ok:/.test(line) || /color-ok:/.test(lines[i - 1] ?? '')) return;
      found.push(`${relative(root, join(root, f))}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  return found;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = findHardcodedColors(process.argv[2] ?? process.cwd());
  for (const line of found) console.log(`::error::hard-coded colour ${line}`);
  process.exit(found.length ? 1 : 0);
}
