#!/usr/bin/env node
// G-2 / F-050: храповик мёртвого кода. knip сам по себе тут не годится как
// гейт: он краснеет на всём, что уже написано, и такой гейт выключают в тот же
// день. Поэтому список нарушений лежит в scripts/knip-baseline.txt, а скрипт
// краснеет только на НОВОЕ нарушение — и подсказывает, когда список можно
// укоротить.
//
// Запуск: node scripts/knip-check.mjs       (шаг в CI)
//         node scripts/knip-check.mjs --update   (после того как долг реально сократили)
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASELINE = path.join(ROOT, 'scripts/knip-baseline.txt');

function knipIssues() {
  let out;
  try {
    out = execFileSync('npx', ['knip', '--reporter', 'json'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch (err) {
    // Код 1 для knip означает «найдены нарушения» и JSON при этом на stdout —
    // это штатный результат, а не поломка. Всё остальное (2 — битый конфиг) —
    // ошибка: молча зелёным прогон от этого не станет.
    if (err.status !== 1 || !err.stdout) {
      console.error(`::error::knip не выполнился (${err.status ?? err.message})`);
      process.exit(1);
    }
    out = err.stdout;
  }
  const parsed = JSON.parse(out || '{}');
  if (!Array.isArray(parsed.issues)) {
    console.error('::error::knip вернул пустой/непонятный отчёт — проверять нечего');
    process.exit(1);
  }
  return parsed.issues;
}

const TYPES = ['files', 'exports', 'types', 'enumMembers', 'duplicates', 'dependencies', 'devDependencies'];

// Мёртвый файл knip описывает самой записью (файл == предмет), у остального
// предмет — элемент с именем. Дублирующиеся экспорты идут списком списков: там
// имена — у вложенных элементов, а не у внешнего.
function currentKeys(issues) {
  const keys = [];
  for (const entry of issues) {
    const file = path.relative(ROOT, entry.file).replaceAll(path.sep, '/');
    for (const type of TYPES) {
      const items = (entry[type] ?? []).flatMap(item => (Array.isArray(item) ? item : [item]));
      for (const item of items) {
        if (type === 'files') {
          keys.push(`files\t${file}`);
          continue;
        }
        const name = typeof item === 'string' ? item : (item?.name ?? item?.symbol ?? '');
        if (!name) {
          console.error(`::error::knip выдал ${type} без имени в ${file} — ключ не построить`);
          process.exit(1);
        }
        keys.push(`${type}\t${file}:${name}`);
      }
    }
  }
  return keys.sort();
}

function readBaseline() {
  try {
    return readFileSync(BASELINE, 'utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

const issues = knipIssues();
const current = currentKeys(issues);
const baseline = readBaseline();

if (process.argv.includes('--update')) {
  const header = [
    '# G-2: известный долг по мёртвому коду (knip). Строка = тип + файл[:имя].',
    '# Убирать строку — когда код стал живым; добавлять — только вместе с тикетом.',
  ].join('\n');
  writeFileSync(BASELINE, header + '\n' + current.join('\n') + '\n');
  console.log(`knip-baseline: записано ${current.length} строк`);
  process.exit(0);
}

const set = new Set(baseline);
const fresh = current.filter(key => !set.has(key));
const resolved = baseline.filter(key => !new Set(current).has(key));

console.log(`knip: нарушений ${current.length}, в baseline ${baseline.length}`);

if (fresh.length > 0) {
  console.error(`::error::новый мёртвый код (${fresh.length}):`);
  fresh.forEach(key => console.error(`  ${key.replace('\t', '  ')}`));
  console.error('Удалите экспорт/файл или используйте его. Вписать в baseline нельзя: он только укорачивается.');
  process.exit(1);
}

if (resolved.length > 0) {
  console.log(`можно вычеркнуть из baseline (${resolved.length}) — этих нарушений больше нет:`);
  resolved.forEach(key => console.log(`  ${key.replace('\t', '  ')}`));
  console.log(`node scripts/knip-check.mjs --update`);
}

console.log('knip: новых нарушений нет');
