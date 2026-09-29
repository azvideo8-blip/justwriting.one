#!/usr/bin/env node
// G-2 / F-050: храповик мёртвого кода. knip сам по себе тут не годится как
// гейт: он краснеет на всём, что уже написано, и такой гейт выключают в тот же
// день. Поэтому список нарушений лежит в scripts/knip-baseline.txt, а скрипт
// краснеет только на НОВОЕ нарушение — и подсказывает, когда список можно
// укоротить.
//
// R2-020: раньше --update писал что угодно и выходил зелёным, то есть один
// прогон легализовал любой новый долг. Теперь --update обязан краснеть на
// любом ключе вне старого baseline; рост — только через явный --grow.
//
// Запуск: node scripts/knip-check.mjs       (шаг в CI)
//         node scripts/knip-check.mjs --update   (после того как долг реально сократили)
//         node scripts/knip-check.mjs --grow     (долг осознанно вырос — вместе с тикетом)
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { planBaseline } from './knip-ratchet.mjs';

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
const grow = process.argv.includes('--grow');
const update = process.argv.includes('--update');
const plan = planBaseline(baseline, current, { grow });

if (update || grow) {
  if (!plan.mayWrite) {
    console.error(`::error::--update не расширяет baseline: новых нарушений ${plan.added.length}`);
    plan.added.forEach(key => console.error(`  ${key.replace('\t', '  ')}`));
    console.error('Долг уменьшается, а не растёт: удалите экспорт/файл или используйте его.');
    console.error('Если рост осознанный (новый мёртвый код под тикет) — перезапустите с --grow.');
    process.exit(1);
  }
  writeFileSync(BASELINE, plan.contents);
  console.log(`knip-baseline: записано ${current.length} строк (было ${baseline.length}, вычеркнуто ${plan.removed.length}, добавлено ${plan.added.length})`);
  if (plan.added.length > 0) {
    console.log('добавлено в baseline (--grow):');
    plan.added.forEach(key => console.log(`  ${key.replace('\t', '  ')}`));
  }
  process.exit(0);
}

console.log(`knip: нарушений ${current.length}, в baseline ${baseline.length}`);

if (plan.added.length > 0) {
  console.error(`::error::новый мёртвый код (${plan.added.length}):`);
  plan.added.forEach(key => console.error(`  ${key.replace('\t', '  ')}`));
  console.error('Удалите экспорт/файл или используйте его. Вписать в baseline нельзя: он только укорачивается.');
  process.exit(1);
}

if (plan.removed.length > 0) {
  console.log(`можно вычеркнуть из baseline (${plan.removed.length}) — этих нарушений больше нет:`);
  plan.removed.forEach(key => console.log(`  ${key.replace('\t', '  ')}`));
  console.log(`node scripts/knip-check.mjs --update`);
}

console.log('knip: новых нарушений нет');
