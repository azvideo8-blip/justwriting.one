// Храповик «итог операции прочитан» (scripts/check-outcome-read.mjs).
// Б: каждый кейс — своя функция в одном временном дереве (один TypeChecker-проход);
//    вызываем `save(): Promise<{ cloudSynced; skipped }>` и смотрим, какие поля
//    остались непрочитанными.
// Мутации (поломать ветку в check-outcome-read.mjs → первый красный кейс):
//  ф1 `ExpressionStatement/Void → NONE`      — «await save();», «void save();»
//  ф2 `variableReads` без `classifyUse`/ALL — «const r … use(r.cloudSynced)», «use(r)», «return r», «{ ...r }»
//  ф3 `bindingReads`                         — «{ skipped: n }», «{ cloudSynced, ...rest }»
//  ф4 прозрачная `(…)` / `.name` в readsOf   — «use((await save()).skipped)»
//  ф5 `thenReads`                            — «.then(r => …)», «.then({…})», «.then(use)»
//  ф6 `.catch/.finally` в climb              — «await save().catch(() => null)»
//  ф7 `promiseCombinatorOf` / `collectionReads` — три кейса Promise.all / allSettled
//  ф8 return / стрелка / аргумент            — «return save()», «run(() => save())»
//  намеренно: `intentionalReason`            — кейсы с комментарием, без причины, строкой выше
// Конкретные красные кейсы каждой мутации — в отчёте 2026-11-25-outcome-ratchet.md.
import { beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OBSERVE_ONLY, OUTCOME_FIELDS, compareWithBaseline, scanOutcomeRead, toCounts } from '../../../scripts/check-outcome-read.mjs';

type Scan = ReturnType<typeof scanOutcomeRead>;

const SAVE = 'export async function save(): Promise<{ cloudSynced: boolean; skipped: number }> { return { cloudSynced: true, skipped: 0 }; }\n'
  + 'export async function saveUnion(): Promise<{ done: true } | { done: false; skipped: number }> { return { done: true }; }\n';
const HEAD = "import { save, saveUnion } from './save';\nimport { saveDts } from './ext';\ndeclare function use(...a: unknown[]): void;\ndeclare function run(f: () => unknown): void;\n";

/** [id, тело async-функции, непрочитанные поля]. */
const CASES: Array<[string, string, string[]]> = [
  ['await', 'await save();', ['cloudSynced', 'skipped']],
  ['void', 'void save();', ['cloudSynced', 'skipped']],
  ['stmt', 'save();', ['cloudSynced', 'skipped']],
  ['prop', 'const r = await save(); use(r.cloudSynced);', ['skipped']],
  ['whole-arg', 'const r = await save(); use(r);', []],
  ['whole-return', 'const r = await save(); return r;', []],
  ['whole-spread', 'const r = await save(); use({ ...r });', []],
  ['shorthand', 'const r = await save(); use({ r });', []],
  ['alias', 'const r = await save(); const q = r; use(q);', []],
  ['null-check-only', 'const r = await save(); if (!r) return; use(1);', ['cloudSynced', 'skipped']],
  ['nested-arrow', 'const r = await save(); [1].forEach(() => use(r.skipped));', ['cloudSynced']],
  ['optional', 'const r = await save(); use(r?.skipped, (r as { cloudSynced: boolean }).cloudSynced);', []],
  ['unused', 'const r = await save(); use(1); void r;', []],
  ['destructure-rename', 'const { skipped: n } = await save(); use(n);', ['cloudSynced']],
  ['destructure-rest', 'const { cloudSynced, ...rest } = await save(); use(cloudSynced, rest);', []],
  ['paren', 'use((await save()).skipped);', ['cloudSynced']],
  ['then-prop', 'save().then(r => use(r.skipped));', ['cloudSynced']],
  ['then-destructure', 'save().then(({ cloudSynced, skipped }) => use(cloudSynced, skipped));', []],
  ['then-destructure-one', 'save().then(({ skipped }) => use(skipped));', ['cloudSynced']],
  ['then-named', 'save().then(use);', []],
  ['then-none', 'save().then(() => use(1));', ['cloudSynced', 'skipped']],
  ['catch', 'const r = await save().catch(() => null); use(r?.skipped);', ['cloudSynced']],
  ['catch-stmt', 'await save().catch(() => null);', ['cloudSynced', 'skipped']],
  ['finally-stmt', 'await save().finally(() => use(1));', ['cloudSynced', 'skipped']],
  ['finally-var', 'const r = await save().finally(() => use(1)); use(r.skipped);', ['cloudSynced']],
  ['union', 'await saveUnion();', ['skipped']],
  ['dts-function', 'await saveDts();', []],
  ['allSettled', "const rs = await Promise.allSettled([1].map(() => save())); rs.forEach(r => { if (r.status === 'fulfilled') use(r.value.skipped); });", ['cloudSynced']],
  ['all-read', 'const rs = await Promise.all([1].map(() => save())); use(rs.filter(r => r.cloudSynced), rs.map(r => r.skipped));', []],
  ['all-whole', 'const rs = await Promise.all([1].map(() => save())); return rs;', []],
  ['all-thrown', 'await Promise.all([1].map(() => save()));', ['cloudSynced', 'skipped']],
  ['all-block-return', 'await Promise.all([1].map(async () => { return await save(); }));', ['cloudSynced', 'skipped']],
  ['return', 'return save();', []],
  ['return-await', 'return await save();', []],
  ['arrow', 'run(() => save());', []],
  ['arg', 'use(save());', []],
  ['same-line', 'await save(); // намеренно: фоновая досылка, повтор сам', []],
  ['reason-above', '// намеренно: фоновая досылка, повтор сам\n  await save();', []],
  ['no-reason', 'await save(); // намеренно:', ['cloudSynced', 'skipped']],
  ['short-reason', 'await save(); // намеренно: ок', ['cloudSynced', 'skipped']],
  ['tail-of-other', 'use(1); // намеренно: хвост чужого оператора\n  await save();', ['cloudSynced', 'skipped']],
  ['pkg-d-ts', "const { save: s } = await import('pkg'); await s();", []],
  ['pkg-ambient-ts', "const { save: s } = await import('pkg2'); await s();", []],
];

let root = '';
let scan: Scan;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'outcome-read-'));
  const put = (file: string, text: string) => {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  put('tsconfig.json', JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', noEmit: true, lib: ['ES2022'], types: [] },
  }));
  put('src/save.ts', SAVE);
  put('src/ext.d.ts', 'export declare function saveDts(): Promise<{ cloudSynced: boolean; skipped: number }>;\n');
  put('src/pkg.d.ts', "declare module 'pkg' { export function save(): Promise<{ cloudSynced: boolean; skipped: number }>; }\n");
  put('src/ambient.ts', "declare module 'pkg2' { export function save(): Promise<{ cloudSynced: boolean; skipped: number }>; }\n");
  for (const [id, body] of CASES) put(`src/c-${id}.ts`, `${HEAD}export async function c(): Promise<unknown> {\n  ${body}\n}\n`);
  // тесты и src/test/ не сканируются
  put('src/__tests__/skip.ts', `${HEAD}export async function c() { await save(); }\n`);
  put('src/a.test.ts', `${HEAD}export async function c() { await save(); }\n`);
  put('src/testing/skip.ts', `${HEAD}export async function c() { await save(); }\n`);
  scan = scanOutcomeRead(root);
}, 60_000);

const missesIn = (id: string) => scan.misses.filter(m => m.file === `src/c-${id}.ts`);

describe('outcome-read: настоящее дерево', () => {
  // Мутация: вернуть OBSERVE_ONLY = true; новый непрочитанный вызов в src/ — красный.
  it('вызовов > 120; расхождений с базой нет (блокирует); «намеренно:» без причины нет', () => {
    const baseline = JSON.parse(readFileSync(join(process.cwd(), 'scripts/outcome-read-baseline.json'), 'utf8'));
    const real = scanOutcomeRead(process.cwd());
    expect(real.calls).toBeGreaterThan(120);
    const messages = compareWithBaseline(toCounts(real.misses), baseline);
    expect(OBSERVE_ONLY).toBe(false);
    expect(messages).toEqual([]);
    expect(real.badReasons).toEqual([]);
  }, 60_000);

  it('набор полей: ровно из тикета, без ok/success/error/reason', () => {
    expect(OUTCOME_FIELDS).toHaveLength(35);
    expect(new Set(OUTCOME_FIELDS).size).toBe(35);
    for (const banned of ['ok', 'success', 'error', 'reason']) expect(OUTCOME_FIELDS).not.toContain(banned);
  });
});

describe('outcome-read: формы вызова на временном дереве', () => {
  it('каждый кейс находит ровно свои поля', () => {
    // собрано в один expect, чтобы красный показал все расходящиеся кейсы сразу
    const got = Object.fromEntries(CASES.map(([id]) => [id, missesIn(id).flatMap(m => m.fields)]));
    const want = Object.fromEntries(CASES.map(([id, , fields]) => [id, fields]));
    expect(got).toEqual(want);
  });

  for (const [id, body, fields] of CASES) {
    it(`${id}: ${body.replace(/\s+/g, ' ')} → ${fields.length ? fields.join(', ') : 'нет находок'}`, () => {
      const found = missesIn(id);
      expect(found.flatMap(m => m.fields)).toEqual(fields);
      for (const m of found) {
        expect(m.fn).toBe('c');
        expect(m.call).toMatch(/^save/);
      }
    });
  }

  it('«намеренно:» без причины — в badReasons (и находка остаётся); нормальная причина — нет', () => {
    expect(scan.badReasons.filter(r => r.startsWith('src/c-no-reason.ts:'))).toHaveLength(1);
    expect(scan.badReasons.filter(r => r.startsWith('src/c-short-reason.ts:'))).toHaveLength(1);
    expect(scan.badReasons.filter(r => r.startsWith('src/c-same-line.ts:') || r.startsWith('src/c-reason-above.ts:'))).toEqual([]);
    expect(scan.badReasons).toHaveLength(2);
  });

  it('тесты, src/test/ и src/testing/ не сканируются; ключ без номера строки', () => {
    expect(scan.misses.some(m => /__tests__|\.test\.|\/testing\//.test(m.file))).toBe(false);
    const counts = toCounts(missesIn('await'));
    expect(counts).toEqual({
      'src/c-await.ts|c|save|cloudSynced': 1,
      'src/c-await.ts|c|save|skipped': 1,
    });
  });

  it('calls считает все вызовы с полем-итогом, в том числе прочитанные', () => {
    // по одному вызову в каждом кейсе, кроме трёх (pkg, pkg2, .d.ts — функции не из src)
    expect(scan.calls).toBe(CASES.length - 3);
  });
});

describe('outcome-read: сравнение с базой', () => {
  const KEY = 'src/a.ts|f|save|skipped';
  it('больше базы — новое место', () => {
    expect(compareWithBaseline({ [KEY]: 2 }, { [KEY]: 1 })).toEqual([expect.stringContaining(`новое место: ${KEY}`)]);
    expect(compareWithBaseline({ [KEY]: 1 }, {})).toEqual([expect.stringContaining(`новое место: ${KEY}`)]);
  });
  it('меньше базы — исправлено, убери из базы', () => {
    expect(compareWithBaseline({ [KEY]: 1 }, { [KEY]: 2 })).toEqual([
      expect.stringContaining(`исправлено — убери из scripts/outcome-read-baseline.json: ${KEY}`),
    ]);
  });
  it('ключ исчез — исправлено', () => {
    expect(compareWithBaseline({}, { [KEY]: 1 })).toEqual([
      expect.stringContaining(`исправлено — убери из scripts/outcome-read-baseline.json: ${KEY}`),
    ]);
  });
  it('равно — тишина', () => {
    expect(compareWithBaseline({ [KEY]: 1 }, { [KEY]: 1 })).toEqual([]);
    expect(compareWithBaseline({}, {})).toEqual([]);
  });
});
