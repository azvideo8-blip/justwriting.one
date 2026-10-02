#!/usr/bin/env node
// S-50: отчёт о перекрасившихся фразах. Для каждой фразы корпуса (включая
// knownGap) сравнивает решение детектора на <old-ref> и в рабочем дереве и
// печатает те, у которых ответ изменился. Каждый тикет, трогающий
// riskDetect.ts, прикладывает этот отчёт: перекраска, не названная в тикете, —
// баг. Запуск руками, не в CI:
//   npx tsx scripts/crisis-flip-report.mjs <old-ref>     (например v0.9.28 или HEAD)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = 'src/features/ai/utils/riskDetect.ts';
const CORPUS = path.join(ROOT, 'src/features/ai/utils/__tests__/crisisCorpus.json');
const RELATIVE_IMPORT = "'../../../shared/ai/buildChatPrompt'";

const ref = process.argv[2];
if (!ref) {
  console.error('usage: npx tsx scripts/crisis-flip-report.mjs <old-ref>');
  process.exit(2);
}

const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
const tmp = mkdtempSync(path.join(tmpdir(), 'crisis-flip-'));

async function load(source, name) {
  const abs = JSON.stringify(path.join(ROOT, 'src/shared/ai/buildChatPrompt.ts'));
  if (!source.includes(RELATIVE_IMPORT)) throw new Error(`импорт ${RELATIVE_IMPORT} не найден в ${name} — скрипт устарел`);
  const file = path.join(tmp, `${name}.ts`);
  writeFileSync(file, source.replace(RELATIVE_IMPORT, abs));
  return (await import(pathToFileURL(file).href)).detectRisk;
}

try {
  const oldSrc = execFileSync('git', ['show', `${ref}:${SRC}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const newSrc = readFileSync(path.join(ROOT, SRC), 'utf8');
  const [oldDetect, newDetect] = await Promise.all([load(oldSrc, 'old'), load(newSrc, 'new')]);

  const flips = [];
  for (const c of corpus) {
    const before = oldDetect(c.text).isRisk;
    const after = newDetect(c.text).isRisk;
    if (before === after) continue;
    const ok = after === (c.expect === 'risk');
    flips.push({ ...c, before, after, ok });
  }
  console.log(`фраз в корпусе: ${corpus.length}; перекрасилось против ${ref}: ${flips.length}`);
  for (const f of flips) {
    const dir = `${f.before ? 'risk' : 'safe'} → ${f.after ? 'risk' : 'safe'}`;
    const verdict = f.knownGap ? 'knownGap' : f.ok ? 'починено' : 'СЛОМАНО';
    console.log(`  [${verdict}] ${dir}  ${f.category}: ${JSON.stringify(f.text)}`);
  }
  const broken = flips.filter(f => !f.ok && !f.knownGap);
  if (broken.length > 0) {
    console.error(`::error::${broken.length} перекраска(и) против метки корпуса`);
    process.exit(1);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
