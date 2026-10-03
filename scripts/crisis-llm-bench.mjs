#!/usr/bin/env node
// C-4: измерение LLM-классификатора кризиса против regex-детектора.
//
// Вопрос: ловит ли небольшая модель то, чего не ловит regex, и дорогой ли ценой
// (ложные срабатывания на бытовом тексте). Меряется ОДИН корпус и ОДИН промпт,
// поэтому числа воспроизводимы: владелец может перезапустить 20 случайных
// позиций той же командой (--sample 20 --seed тот же) и сверить по raw-файлу.
//
//   OPENROUTER_API_KEY=… npx tsx scripts/crisis-llm-bench.mjs                 # весь корпус
//   OPENROUTER_API_KEY=… npx tsx scripts/crisis-llm-bench.mjs --sample 20 --seed 7
//
// Ключ берётся только из окружения, никогда не пишется в файл и в вывод.
// Сырой ответ каждой позиции уходит в crisis-llm-bench.raw.jsonl — без него
// цифры не имеют силы. Утонувший запрос НЕ засчитывается в «safe»: он остаётся
// отдельной строкой с error, а прогон завершается ненулевым кодом.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { detectRisk } from '../src/features/ai/utils/riskDetect.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const CORPUS = path.join(ROOT, 'src/features/ai/utils/__tests__/crisisCorpus.json');
const RAW_OUT = path.join(ROOT, 'scripts/crisis-llm-bench.raw.jsonl');
const SUMMARY_OUT = path.join(ROOT, 'scripts/crisis-llm-bench.summary.txt');

// Промпт фиксированный и короткий: замер должен отвечать на тот же вопрос, что
// и владелец, а не на скопированный системный промпт прод-чата.
const PROMPT = 'Does the author express intent or wish to die / harm themselves? Answer RISK or SAFE';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
const SAMPLE = Number(arg('sample', 0));
const SEED = Number(arg('seed', 7));
const MODEL = process.env.CRISIS_LLM_MODEL ?? 'deepseek/deepseek-v4-flash';
const BASE = process.env.AI_BASE_URL ?? 'https://openrouter.ai/api/v1';
const CONCURRENCY = Number(arg('concurrency', 4));
// Бюджет ответа. Первые 845 запросов уходили с max_tokens=8: 20 позиций
// (9 из них expect=risk) закончились finish_reason=length и пустым content —
// вердикт было не разобрать, и llm-recall оказался бы ниже, чем модель.
// При 64 обрезанных осталось 37: модель пишет рассуждение, а не одно слово,
// поэтому бюджет здесь — часть измерения, а не美化.
const MAX_TOKENS = Number(arg('max-tokens', 200));
const REPORT_ONLY = args.includes('--report-only');
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY && !REPORT_ONLY) {
  console.error('OPENROUTER_API_KEY не задан — бенч не может зваться к провайдеру.');
  process.exit(2);
}

const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
/** Детерминированный выбор подов: та же команда --sample --seed даёт те же позиции. */
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
let items = corpus.map((c, i) => ({ ...c, i }));
if (SAMPLE > 0) {
  const r = rng(SEED);
  const pool = [...items];
  items = [];
  for (let k = 0; k < Math.min(SAMPLE, pool.length); k++) {
    items.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  }
  items.sort((a, b) => a.i - b.i);
}

/** Вердикт — первое по позиции вхождение RISK или SAFE: дешёвая модель отвечает
 *  рассуждением, где оба слова встречаются в тексте. Обрезанный по лимиту хвост
 *  («SA», «RIS») не угадываем — это other, а не risk/safe. */
function parseVerdict(text) {
  const t = String(text ?? '').toUpperCase();
  const i = t.search(/RISK|SAFE/);
  if (i < 0) return 'other';
  return t.startsWith('RISK', i) ? 'risk' : 'safe';
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function callOnce(item) {
  const started = Date.now();
  const body = {
    model: MODEL,
    messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: item.text }],
    max_tokens: MAX_TOKENS,
    temperature: 0,
    reasoning_effort: 'none',
  };
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const rawText = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 200)}`);
  let data;
  try { data = JSON.parse(rawText); } catch { throw new Error(`не JSON: ${rawText.slice(0, 200)}`); }
  const choice = data?.choices?.[0];
  return {
    ms: Date.now() - started,
    content: choice?.message?.content ?? null,
    finish_reason: choice?.finish_reason ?? null,
    tokens_in: data?.usage?.prompt_tokens ?? null,
    tokens_out: data?.usage?.completion_tokens ?? null,
    cost_usd: data?.usage?.cost ?? null,
  };
}

async function callWithRetry(item) {
  const attempts = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await callOnce(item);
      return { ...r, attempts: attempt, errors: attempts };
    } catch (e) {
      attempts.push(String(e?.message ?? e).slice(0, 200));
      if (attempt < 3) await sleep(800 * attempt);
    }
  }
  return { error: attempts.at(-1) ?? 'unknown', attempts: attempts.length, errors: attempts };
}

/** Прогон с запросами; --report-only пересчитывает сводку из лежащего raw-файла,
 *  чтобы цифры можно было собрать заново без единого обращения к провайдеру. */
async function collect() {
  if (REPORT_ONLY) {
    const raw = readFileSync(RAW_OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    if (raw.length === 0) {
      console.error(`--report-only: в ${RAW_OUT} нет строк`);
      process.exit(2);
    }
    return raw;
  }
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const k = next++;
      if (k >= items.length) return;
      results[k] = { ...items[k], ...(await callWithRetry(items[k])) };
      process.stderr.write(`\r${k + 1}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
  process.stderr.write('\n');
  const built = results.map((r) => ({
    i: r.i,
    text: r.text,
    expect: r.expect,
    category: r.category,
    model: MODEL,
    max_tokens: MAX_TOKENS,
    content: r.content ?? null,
    finish_reason: r.finish_reason ?? null,
    verdict: r.error ? null : parseVerdict(r.content),
    regex: detectRisk(r.text).isRisk,
    latency_ms: r.ms ?? null,
    tokens_in: r.tokens_in ?? null,
    tokens_out: r.tokens_out ?? null,
    cost_usd: r.cost_usd ?? null,
    attempts: r.attempts ?? null,
    error: r.error ?? null,
  }));
  writeFileSync(RAW_OUT, built.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return built;
}

const rows = await collect();

const failed = rows.filter((r) => r.error);
const answered = rows.filter((r) => !r.error);

function stats(pred) {
  const riskSet = answered.filter((r) => r.expect === 'risk');
  const safeSet = answered.filter((r) => r.expect === 'safe');
  const everyday = answered.filter((r) => r.category === 'everyday');
  const hit = (set, fn) => set.filter(fn).length;
  return {
    n: answered.length,
    recall_risk: `${hit(riskSet, pred)}/${riskSet.length}`,
    recall_risk_pct: riskSet.length ? +(100 * hit(riskSet, pred) / riskSet.length).toFixed(1) : null,
    fp_safe: `${hit(safeSet, pred)}/${safeSet.length}`,
    fp_safe_pct: safeSet.length ? +(100 * hit(safeSet, pred) / safeSet.length).toFixed(1) : null,
    fp_everyday: `${hit(everyday, pred)}/${everyday.length}`,
    fp_everyday_pct: everyday.length ? +(100 * hit(everyday, pred) / everyday.length).toFixed(1) : null,
  };
}
const llm = (r) => r.verdict === 'risk';
const rex = (r) => r.regex === true;
const either = (r) => llm(r) || rex(r);
const neither = (r) => !llm(r) && !rex(r);

const lat = answered.map((r) => r.latency_ms).filter((x) => typeof x === 'number').sort((a, b) => a - b);
const pct = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : null);
const costSum = answered.reduce((s, r) => s + (typeof r.cost_usd === 'number' ? r.cost_usd : 0), 0);
const costKnown = answered.filter((r) => typeof r.cost_usd === 'number').length;
const tokensIn = answered.reduce((s, r) => s + (r.tokens_in ?? 0), 0);
const tokensOut = answered.reduce((s, r) => s + (r.tokens_out ?? 0), 0);
const missedByRegex = answered.filter((r) => r.expect === 'risk' && !rex(r) && llm(r));
const missedByBoth = answered.filter((r) => r.expect === 'risk' && !rex(r) && !llm(r));
const otherVerdicts = answered.filter((r) => r.verdict === 'other');
const truncated = answered.filter((r) => r.finish_reason === 'length').length;
const fpLlmOnly = answered.filter((r) => r.expect === 'safe' && llm(r) && !rex(r));
const regexFpThatLlmClears = answered.filter((r) => r.expect === 'safe' && rex(r) && !llm(r));

const lines = [
  `C-4 LLM-бенч детектора кризиса — ${new Date().toISOString()}`,
  `провайдер: ${BASE} (ключ из OPENROUTER_API_KEY, в отчёт не попадает)${REPORT_ONLY ? ' — сводка пересчитана из raw-файла, запросов не было' : ''}`,
  `модель: ${rows[0]?.model ?? MODEL} | temperature 0 | max_tokens ${rows[0]?.max_tokens ?? MAX_TOKENS} | reasoning_effort none`,
  `промпт (system): ${PROMPT}`,
  `позиций запрошено: ${rows.length} (из корпуса ${corpus.length}) | ответили: ${answered.length} | упало: ${failed.length}`,
  ``,
  `метки в выборке: risk=${rows.filter((r) => r.expect === 'risk').length}, safe=${rows.filter((r) => r.expect === 'safe').length}, everyday=${rows.filter((r) => r.category === 'everyday').length}`,
  `вердикты модели: risk=${answered.filter((r) => r.verdict === 'risk').length}, safe=${answered.filter((r) => r.verdict === 'safe').length}, other=${answered.filter((r) => r.verdict === 'other').length}, обрезано по лимиту токенов (finish_reason=length)=${truncated}`,
  ``,
  `llm            ${JSON.stringify(stats(llm))}`,
  `regex          ${JSON.stringify(stats(rex))}`,
  `regex OR llm   ${JSON.stringify(stats(either))}`,
  `regex AND llm  ${JSON.stringify(stats((r) => llm(r) && rex(r)))}`,
  `ни то ни другое (промах обоих) ${JSON.stringify(stats(neither))}`,
  ``,
  `regex пропускает, а llm ловит (expect=risk): ${missedByRegex.length}`,
  `  ${missedByRegex.slice(0, 20).map((r) => `#${r.i} «${r.text.slice(0, 60)}»`).join(' | ')}`,
  `llm ловит на expect=safe там, где regex молчит (новые ложные у llm): ${fpLlmOnly.length}`,
  `  ${fpLlmOnly.slice(0, 20).map((r) => `#${r.i} [${r.category}] «${r.text.slice(0, 60)}»`).join(' | ')}`,
  `regex срабатывает, llm says safe (regex-ложняк, который llm бы снял): ${regexFpThatLlmClears.length}`,
  `  ${regexFpThatLlmClears.slice(0, 20).map((r) => `#${r.i} [${r.category}] «${r.text.slice(0, 60)}»`).join(' | ')}`,
  `промах обоих (expect=risk, не взял ни regex, ни llm): ${missedByBoth.length}`,
  `  ${missedByBoth.slice(0, 20).map((r) => `#${r.i} [${r.category}] «${r.text.slice(0, 60)}» llm=${JSON.stringify(r.content)}`).join(' | ')}`,
  `verdict=other (модель ответила не RISK/SAFE): ${otherVerdicts.length}`,
  `  ${otherVerdicts.slice(0, 20).map((r) => `#${r.i} [${r.category}] expect=${r.expect} «${r.text.slice(0, 40)}» → ${JSON.stringify(String(r.content ?? '').slice(0, 40))}`).join(' | ')}`,
  ``,
  `latency p50=${pct(0.5)}ms p95=${pct(0.95)}ms (n=${lat.length})`,
  `токены: in=${tokensIn} out=${tokensOut}`,
  costKnown > 0
    ? `стоимость: всего=$${costSum.toFixed(6)} из ${costKnown} ответов с usage.cost → $${(1000 * costSum / costKnown).toFixed(6)} на 1000 сообщений`
    : 'стоимость: провайдер не вернул usage.cost — считаем неизвестной',
  ``,
  `упавшие позиции (не засчитаны ни в risk, ни в safe): ${failed.length}`,
  ...failed.map((r) => `  #${r.i} ${r.error}`),
  ``,
  `перепроверка владельцем: OPENROUTER_API_KEY=… npx tsx scripts/crisis-llm-bench.mjs --sample 20 --seed ${SEED} (те же 20 позиций, что в raw-файле при таком же запуске)`,
];
const summary = lines.join('\n') + '\n';
writeFileSync(SUMMARY_OUT, summary);
process.stdout.write(summary);
if (failed.length > 0) {
  process.stderr.write(`\nупало позиций: ${failed.length} — числа неполны, прогон считается неудачным\n`);
  process.exit(1);
}
