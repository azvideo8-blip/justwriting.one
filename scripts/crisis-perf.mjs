#!/usr/bin/env node
// C-2: замер детектора на вырожденном вводе. Тот же вход, что в тестах
// (riskDetect.test.ts «вырожденный ввод 400k»), но медиана из трёх прогонов и
// построчный вывод — чтобы число из отчёта можно было перепроверить одной командой:
//   npx tsx scripts/crisis-perf.mjs            (медиана пишется в stdout)
// Сырой вывод лежит рядом в scripts/crisis-perf.raw.txt; корпус и вход синтетические.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { detectRisk } from '../src/features/ai/utils/riskDetect';

const ROOT = path.resolve(import.meta.dirname, '..');
const CORPUS = path.join(ROOT, 'src/features/ai/utils/__tests__/crisisCorpus.json');

const DEGENERATE = [
  ['никто не заметит если когда', 'никто не заметит если когда '.repeat(18_000)],
  ['нож', 'нож '.repeat(25_000)],
  ['суицид не вариант, ', 'суицид не вариант, '.repeat(10_527)],
  ['не хочу суицид ', 'не хочу суицид '.repeat(13_334)],
  ['i don\'t want to kill myself. ', "i don't want to kill myself. ".repeat(6_897)],
  ['а\\u200B', 'а\u200B'.repeat(100_000)],
  ['слово суицид в прошлом ', 'слово суицид в прошлом '.repeat(17_400)],
  ['хочу умереть. не хочу умереть. ', 'хочу умереть. не хочу умереть. '.repeat(12_000)],
];

const RUNS = 3;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

console.log(`замер: медиана из ${RUNS} прогонов, бюджет 1500 мс на строку`);
for (const [label, text] of DEGENERATE) {
  const times = [];
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    detectRisk(text);
    times.push(performance.now() - t0);
  }
  const med = median(times);
  console.log(`${med.toFixed(1).padStart(8)} мс  ${text.length} символов  «${label}»  прогоны: ${times.map((t) => t.toFixed(0)).join(' / ')}  ${med < 1500 ? 'OK' : 'ПРЕВЫШЕНИЕ'}`);
}

const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
const corpusTimes = [];
for (let r = 0; r < RUNS; r++) {
  const t0 = performance.now();
  for (const item of corpus) detectRisk(item.text);
  corpusTimes.push(performance.now() - t0);
}
console.log(`${median(corpusTimes).toFixed(1).padStart(8)} мс  весь корпус (${corpus.length} фраз)  прогоны: ${corpusTimes.map((t) => t.toFixed(0)).join(' / ')}`);
