#!/usr/bin/env node
// S-42.3: каждый паттерн детектора кризиса должен держаться хотя бы одной фразой
// корпуса. Скрипт по очереди выкидывает по одной записи из RISK_PATTERNS и
// FOREIGN_RISK_PATTERNS (src/features/ai/utils/riskDetect.ts) и прогоняет
// обязательную часть корпуса (crisisCorpus.json без knownGap): если корпус
// остался зелёным — паттерн ничем не защищён, прогон красный.
//
// Запуск: npx tsx scripts/crisis-pattern-coverage.mjs   (шаг в CI, ci.yml)
// tsx нужен для импорта .ts-мутантов; сам детектор не трогается — мутанты
// пишутся во временный каталог.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src/features/ai/utils/riskDetect.ts');
const CORPUS = path.join(ROOT, 'src/features/ai/utils/__tests__/crisisCorpus.json');
const RELATIVE_IMPORT = "'../../../shared/ai/buildChatPrompt'";

const lines = readFileSync(SRC, 'utf8').split('\n');
const corpus = JSON.parse(readFileSync(CORPUS, 'utf8')).filter((c) => !c.knownGap);

// Индексы строк-записей массива: по одной записи на строку, комментарии пропускаются.
// Любая другая форма строки — ошибка, а не молчаливый пропуск.
function entryLines(arrayName) {
  const open = lines.findIndex((l) => l.startsWith(`const ${arrayName}: RegExp[] = [`));
  if (open < 0) throw new Error(`${arrayName} не найден в ${SRC}`);
  const close = lines.indexOf('];', open);
  const out = [];
  for (let i = open + 1; i < close; i++) {
    const t = lines[i].trim();
    if (t === '' || t.startsWith('//')) continue;
    if (!/^(?:\/|new RegExp\().*,$/.test(t)) throw new Error(`${arrayName}: неожиданная строка ${i + 1}: ${t}`);
    out.push(i);
  }
  return out;
}

const tmp = mkdtempSync(path.join(tmpdir(), 'crisis-coverage-'));
let n = 0;
async function loadMutant(skipLine) {
  const abs = JSON.stringify(path.join(ROOT, 'src/shared/ai/buildChatPrompt.ts'));
  const src = lines
    .filter((_, i) => i !== skipLine)
    .join('\n')
    .replace(RELATIVE_IMPORT, abs);
  if (!src.includes(abs)) throw new Error(`импорт ${RELATIVE_IMPORT} не найден — скрипт устарел`);
  const file = path.join(tmp, `riskDetect.${n++}.ts`);
  writeFileSync(file, src);
  const mod = await import(pathToFileURL(file).href);
  return mod.detectRisk;
}

function failures(detectRisk) {
  return corpus.filter((c) => detectRisk(c.text).isRisk !== (c.expect === 'risk'));
}

try {
  const baseline = failures(await loadMutant(-1));
  if (baseline.length > 0) {
    console.error(`::error::корпус красный без мутаций (${baseline.length}): покрытие паттернов бессмысленно`);
    for (const f of baseline) console.error(`  ${f.category}: ${JSON.stringify(f.text)} -> ожидалось ${f.expect}`);
    process.exit(1);
  }

  const uncovered = [];
  let total = 0;
  for (const arrayName of ['STRONG_RISK_PATTERNS', 'RISK_PATTERNS', 'STRONG_FOREIGN_RISK_PATTERNS', 'FOREIGN_RISK_PATTERNS']) {
    for (const line of entryLines(arrayName)) {
      total++;
      const red = failures(await loadMutant(line));
      if (red.length === 0) uncovered.push(`${arrayName} строка ${line + 1}: ${lines[line].trim()}`);
    }
  }
  console.log(`паттернов проверено: ${total}, обязательных фраз: ${corpus.length}`);
  if (uncovered.length > 0) {
    console.error(`::error::${uncovered.length} паттерн(ов) без защищающей фразы в корпусе — удаление не красит корпус:`);
    for (const u of uncovered) console.error(`  ${u}`);
    process.exit(1);
  }
  console.log('каждый паттерн защищён хотя бы одной фразой корпуса');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
