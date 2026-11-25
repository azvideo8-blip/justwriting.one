#!/usr/bin/env node
// Храповик «итог операции прочитан». Класс дейликов: функция вернула отказ полем
// (`cloudSynced: false`, `skippedVersions: 2`), вызывающий поле не прочитал и
// показал успех. Здесь: каждый вызов функции из src/ с результатом-объектом, в
// котором есть поле-итог из OUTCOME_FIELDS, — если вызывающий поле не читает,
// это находка. Находки старых мест лежат в scripts/outcome-read-baseline.json
// (ключ `файл|функция|вызов|поле` → число); список только убывает: новое место
// и исправленное место, оставшееся в списке, — расхождение.
//
// Только TypeChecker (не имена и не регулярки): тип результата берётся у
// `getAwaitedType`, объявление функции — у `getResolvedSignature`.
// Не видит: потерю поля по дороге (функция прочитала `cloudSynced` и вернула
// объект без него); `Promise.all([f(), g()])` без `.map`; `() => f()` в
// forEach (форма 8 — «прочитано дальше»); чтение через `any`/динамический ключ.
// Разрешение: `// намеренно: <причина ≥ 10 знаков>` в строке вызова или строкой
// выше (отдельной строкой-комментарием).
// Запуск: node scripts/check-outcome-read.mjs [корень] [--print]; --print печатает
// базу (counts) для scripts/outcome-read-baseline.json.
import { readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { isMainRun, toPosixPath } from './gate-paths.mjs';

/**
 * Поля-итоги. Тип поля любой. Не добавлять `ok`, `success`, `error`, `reason`:
 * их читать заставляет сам тип объединения.
 */
export const OUTCOME_FIELDS = [
  // «применено ли»: false = итог не наступил, а вызов не бросил
  'applied',
  // облако: записано / не записано / чтение не удалось / ok
  'cloudSynced', 'cloudSyncFailed', 'cloudLoadFailed', 'cloudOk',
  // отдельные стороны операции: локально, на сервере, производные данные
  'localOk', 'remoteOk', 'derivativesOk',
  // «не всё сделано» и счётчики/метки отказа по частям
  'incomplete', 'failed', 'failCount', 'localFailed', 'digestFailed', 'facetsFailed',
  'portraitFailed', 'statusesFailed', 'sectionFailed', 'totalFailed',
  // пропущенное: версии, id, причина, заблокированное, слишком большое, облако
  'skipped', 'skippedVersions', 'skippedIds', 'skippedReason', 'skippedLocked',
  'skippedOversized', 'cloudSkipped',
  // «прочиталось не до конца»: битое, частичное, нечитаемое, обрезанное, ждёт
  'corrupted', 'partial', 'unreadable', 'analysisJournalUnreadable', 'truncated',
  'cloudPending', 'hasUnknown',
  // состояния: заблокировано, развилка, причина деградации
  'locked', 'forked', 'degradedReason',
];

/** true — расхождения с базой только предупреждения. 25.11 владелец: «блокировку включай». */
export const OBSERVE_ONLY = false;

const OUTCOME_SET = new Set(OUTCOME_FIELDS);
const MIN_REASON = 10;

/**
 * @typedef {{ file: string, line: number, fn: string, call: string, fields: string[] }} Miss
 */

/** Что прочитано: all — всё (не находка), иначе множество названных полей. */
const ALL = Object.freeze({ all: true });
const NONE = () => ({ all: false, names: new Set() });

/** Путь относительно корня (posix) или null, если файл вне корня. */
function makeRel(root) {
  const roots = [resolve(root)];
  try { roots.push(realpathSync(root)); } catch { /* корня нет — останется resolve */ }
  return fileName => {
    for (const r of roots) {
      const rel = toPosixPath(relative(r, fileName));
      if (!rel.startsWith('..') && !rel.startsWith('/')) return rel;
    }
    return null;
  };
}

const isTestPath = rel => /(^|\/)__tests__\/|\.test\.|^src\/test\/|^src\/testing\//.test(rel);

/** Выражение-обёртка, прозрачная для «что сделали с результатом». */
function isTransparentParent(p) {
  return ts.isParenthesizedExpression(p) || ts.isAwaitExpression(p) || ts.isNonNullExpression(p)
    || ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isTypeAssertionExpression(p);
}

/** Подняться через (…), await, `!`, `as` и `.catch()/.finally()` (форма 6). */
function climb(call) {
  let e = call;
  for (;;) {
    const p = e.parent;
    if (!p) return e;
    if (isTransparentParent(p)) e = p;
    else if (
      ts.isPropertyAccessExpression(p) && p.expression === e
      && (p.name.text === 'catch' || p.name.text === 'finally')
      && ts.isCallExpression(p.parent) && p.parent.expression === p
    ) e = p.parent;
    else return e;
  }
}

function nearestFunction(node) {
  let n = node.parent;
  while (n && !ts.isFunctionLike(n)) n = n.parent;
  return n;
}

/** Ближайшая функция-область или файл (для поиска чтений переменной). */
function scopeOf(node) {
  let n = node.parent;
  while (n && !ts.isFunctionLike(n) && !ts.isSourceFile(n)) n = n.parent;
  return n;
}

function propName(el) {
  const n = el.propertyName ?? el.name;
  return ts.isIdentifier(n) || ts.isStringLiteral(n) ? n.text : null;
}

function createScanner(program, root) {
  const checker = program.getTypeChecker();
  const rel = makeRel(root);

  const symbolOf = id => (
    ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id
      ? checker.getShorthandAssignmentValueSymbol(id.parent)
      : checker.getSymbolAtLocation(id)
  );

  /** Имена из `{ a, b: c }`; есть `...rest` — всё. */
  function bindingReads(pattern) {
    if (!ts.isObjectBindingPattern(pattern)) return ALL;
    const names = new Set();
    for (const el of pattern.elements) {
      if (el.dotDotDotToken) return ALL;
      const n = propName(el);
      if (n === null) return ALL;
      names.add(n);
    }
    return { all: false, names };
  }

  const isNullish = n => n.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(n) && n.text === 'undefined');

  /** Использование переменной `m`: что оно читает (или null — просто проверка/запись). */
  function classifyUse(m) {
    let e = m;
    while (e.parent && (ts.isParenthesizedExpression(e.parent) || ts.isNonNullExpression(e.parent)
      || ts.isAsExpression(e.parent) || ts.isSatisfiesExpression(e.parent) || ts.isTypeAssertionExpression(e.parent))) e = e.parent;
    const p = e.parent;
    if (ts.isPropertyAccessExpression(p) && p.expression === e) return { names: [p.name.text] };
    if (ts.isElementAccessExpression(p) && p.expression === e) {
      const a = p.argumentExpression;
      return ts.isStringLiteralLike(a) ? { names: [a.text] } : ALL;
    }
    if (ts.isVariableDeclaration(p) && p.initializer === e && ts.isObjectBindingPattern(p.name)) {
      const b = bindingReads(p.name);
      return b.all ? ALL : { names: [...b.names] };
    }
    // запись `r = …` — не чтение; проверка `!r`, `if (r)`, `r && …`, `r == null` — не чтение полей
    if (ts.isBinaryExpression(p)) {
      const op = p.operatorToken.kind;
      if (op === ts.SyntaxKind.EqualsToken && p.left === e) return { names: [] };
      if (op === ts.SyntaxKind.AmpersandAmpersandToken && p.left === e) return { names: [] };
      if ([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
        ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(op)
        && isNullish(p.left === e ? p.right : p.left)) return { names: [] };
    }
    if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) return { names: [] };
    if (ts.isIfStatement(p) && p.expression === e) return { names: [] };
    if (ts.isConditionalExpression(p) && p.condition === e) return { names: [] };
    return ALL;
  }

  /** Что читает код со ссылками на переменную `sym` внутри `scope` (форма 2). */
  function variableReads(sym, scope, skipNode) {
    const names = new Set();
    let whole = false;
    const visit = n => {
      if (whole) return;
      if (ts.isIdentifier(n) && n !== skipNode && symbolOf(n) === sym) {
        const u = classifyUse(n);
        if (u.all) whole = true;
        else for (const x of u.names) names.add(x);
      }
      ts.forEachChild(n, visit);
    };
    visit(scope);
    return whole ? ALL : { all: false, names };
  }

  /** Результат `Promise.all` в переменной: поле где угодно ниже как `….поле` (форма 7). */
  function collectionReads(sym, scope, skipNode, declEnd) {
    const names = new Set();
    let whole = false;
    const visit = n => {
      if (whole) return;
      if (n.getStart() >= declEnd) {
        if (ts.isPropertyAccessExpression(n)) names.add(n.name.text);
        else if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) names.add(n.argumentExpression.text);
      }
      if (ts.isIdentifier(n) && n !== skipNode && symbolOf(n) === sym) {
        const p = n.parent;
        const passive = (ts.isPropertyAccessExpression(p) && p.expression === n)
          || (ts.isElementAccessExpression(p) && p.expression === n)
          || (ts.isForOfStatement(p) && p.expression === n)
          || (ts.isVariableDeclaration(p) && p.initializer === n && ts.isArrayBindingPattern(p.name))
          || (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.left === n)
          || (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken)
          || (ts.isIfStatement(p) && p.expression === n);
        if (!passive) whole = true;
      }
      ts.forEachChild(n, visit);
    };
    visit(scope);
    return whole ? ALL : { all: false, names };
  }

  function thenReads(thenCall) {
    const cb = thenCall.arguments[0];
    if (!cb) return NONE();
    if (!(ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) return ALL; // `.then(named)`
    const param = cb.parameters[0];
    if (!param) return NONE();
    if (ts.isIdentifier(param.name)) {
      const sym = checker.getSymbolAtLocation(param.name);
      return sym ? variableReads(sym, cb, param.name) : ALL;
    }
    return bindingReads(param.name);
  }

  /** `xs.map(x => f(x))` внутри `Promise.all/allSettled(...)` → этот вызов Promise.* или null. */
  function promiseCombinatorOf(e) {
    const p = e.parent;
    let fn = null;
    if (ts.isArrowFunction(p) && p.body === e) fn = p;
    else if (ts.isReturnStatement(p)) fn = nearestFunction(p);
    if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return null;
    const map = fn.parent;
    if (!ts.isCallExpression(map) || map.arguments[0] !== fn) return null;
    if (!ts.isPropertyAccessExpression(map.expression) || map.expression.name.text !== 'map') return null;
    const all = climb(map);
    const pc = all.parent;
    if (!ts.isCallExpression(pc) || pc.arguments[0] !== all) return null;
    const callee = pc.expression;
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
      && callee.expression.text === 'Promise' && ['all', 'allSettled'].includes(callee.name.text)) return pc;
    return null;
  }

  /** Что прочитано у результата вызова `call` (формы 1–8). */
  function readsOf(call, collection = false) {
    const e = climb(call);
    const p = e.parent;
    if (ts.isExpressionStatement(p) || ts.isVoidExpression(p)) return NONE(); // форма 1
    if (ts.isVariableDeclaration(p) && p.initializer === e) {
      if (collection) {
        if (!ts.isIdentifier(p.name)) return ALL;
        const sym = checker.getSymbolAtLocation(p.name);
        return sym ? collectionReads(sym, scopeOf(p), p.name, p.getEnd()) : ALL;
      }
      if (ts.isIdentifier(p.name)) {
        const sym = checker.getSymbolAtLocation(p.name);
        return sym ? variableReads(sym, scopeOf(p), p.name) : ALL; // форма 2
      }
      return bindingReads(p.name); // форма 3
    }
    if (collection) return ALL;
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right === e && ts.isIdentifier(p.left)) {
      const sym = checker.getSymbolAtLocation(p.left);
      return sym ? variableReads(sym, scopeOf(p), p.left) : ALL;
    }
    if (ts.isPropertyAccessExpression(p) && p.expression === e) {
      if (p.name.text === 'then' && ts.isCallExpression(p.parent) && p.parent.expression === p) return thenReads(p.parent); // форма 5
      return { all: false, names: new Set([p.name.text]) }; // форма 4
    }
    if (ts.isElementAccessExpression(p) && p.expression === e) {
      return ts.isStringLiteralLike(p.argumentExpression) ? { all: false, names: new Set([p.argumentExpression.text]) } : ALL;
    }
    const pc = promiseCombinatorOf(e); // форма 7
    if (pc) return readsOf(pc, true);
    return ALL; // форма 8 и всё, что не перечислено: прочитано дальше
  }

  /** Поля-итоги в типе результата вызова; [] — не наш случай. */
  function outcomeFields(call) {
    const decl = checker.getResolvedSignature(call)?.declaration;
    if (!decl) return [];
    const declFile = decl.getSourceFile();
    const declRel = rel(declFile.fileName);
    if (declFile.isDeclarationFile || declRel === null || !declRel.startsWith('src/')) return [];
    for (let a = decl.parent; a; a = a.parent) {
      if (ts.isModuleDeclaration(a) && ts.isStringLiteral(a.name)) return []; // declare module 'pkg'
    }
    const raw = checker.getTypeAtLocation(call);
    const type = checker.getAwaitedType(raw) ?? raw;
    const found = new Set();
    for (const t of type.isUnion() ? type.types : [type]) {
      if (!(t.flags & ts.TypeFlags.Object) && !t.isIntersection()) continue;
      for (const prop of checker.getPropertiesOfType(t)) if (OUTCOME_SET.has(prop.name)) found.add(prop.name);
    }
    return OUTCOME_FIELDS.filter(f => found.has(f));
  }

  function fnName(node) {
    for (let n = node.parent; n; n = n.parent) {
      if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n)) && n.name) return n.name.getText();
      if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
        const holder = n.parent;
        if (holder && (ts.isVariableDeclaration(holder) || ts.isPropertyAssignment(holder) || ts.isPropertyDeclaration(holder)) && holder.initializer === n) return holder.name.getText();
        if (ts.isFunctionExpression(n) && n.name) return n.name.text;
      }
    }
    return '<module>';
  }

  /** Комментарий `// намеренно:` у вызова: null — нет, '' — без причины, иначе причина. */
  function intentionalReason(sf, call) {
    const lines = sf.text.split('\n');
    const lineOf = pos => sf.getLineAndCharacterOfPosition(pos).line;
    let stmt = call;
    while (stmt.parent && !ts.isStatement(stmt)) stmt = stmt.parent;
    const own = new Set([lineOf(call.getStart()), lineOf(stmt.getStart())]);
    const candidates = [...own, ...[...own].map(l => l - 1)];
    let bad = false;
    for (const l of candidates) {
      const text = lines[l];
      if (text === undefined) continue;
      const m = /\/\/\s*намеренно:(.*)$/.exec(text);
      if (!m) continue;
      // строкой выше — только отдельная строка-комментарий, не хвост чужого оператора
      if (!own.has(l) && !text.trim().startsWith('//')) continue;
      if (m[1].trim().length >= MIN_REASON) return m[1].trim();
      bad = true;
    }
    return bad ? '' : null;
  }

  return { rel, outcomeFields, readsOf, fnName, intentionalReason };
}

/**
 * Найти вызовы функций из src/ с полем-итогом, где поле не прочитано.
 * @param {string} root
 * @returns {{ calls: number, misses: Miss[], badReasons: string[] }}
 */
export function scanOutcomeRead(root = process.cwd()) {
  const configPath = join(resolve(root), 'tsconfig.json');
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} });
  if (!parsed) throw new Error(`outcome-read: не прочитался ${configPath}`);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const scanner = createScanner(program, root);
  let calls = 0;
  /** @type {Miss[]} */
  const misses = [];
  /** @type {string[]} */
  const badReasons = [];

  for (const sf of program.getSourceFiles()) {
    const file = scanner.rel(sf.fileName);
    if (sf.isDeclarationFile || file === null || !file.startsWith('src/') || isTestPath(file)) continue;
    const visit = n => {
      if (ts.isCallExpression(n)) {
        const fields = scanner.outcomeFields(n);
        if (fields.length) {
          calls++;
          const reads = scanner.readsOf(n);
          const unread = reads.all ? [] : fields.filter(f => !reads.names.has(f));
          if (unread.length) {
            const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
            const reason = scanner.intentionalReason(sf, n);
            if (reason === '') badReasons.push(`${file}:${line}: «намеренно:» без причины (нужно ≥ ${MIN_REASON} знаков)`);
            if (reason === null || reason === '') {
              misses.push({ file, line, fn: scanner.fnName(n), call: n.expression.getText().replace(/\s+/g, ' '), fields: unread });
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { calls, misses, badReasons };
}

/**
 * Находки → счётчики по ключу `файл|функция|вызов|поле` (строка в ключ не входит).
 * @param {Miss[]} misses
 * @returns {Record<string, number>}
 */
export function toCounts(misses) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const m of misses) {
    for (const field of m.fields) {
      const key = `${m.file}|${m.fn}|${m.call}|${field}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Сравнить счётчики с базой: больше — новое место, меньше — исправлено (убери из базы).
 * @param {Record<string, number>} counts
 * @param {Record<string, number>} baseline
 * @returns {string[]}
 */
export function compareWithBaseline(counts, baseline) {
  const messages = [];
  for (const key of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
    const now = counts[key] ?? 0;
    const base = baseline[key] ?? 0;
    if (now > base) messages.push(`новое место: ${key} (в базе ${base}, стало ${now}) — прочти поле итога или впиши «// намеренно: <причина>»`);
    if (now < base) messages.push(`исправлено — убери из scripts/outcome-read-baseline.json: ${key} (в базе ${base}, стало ${now})`);
  }
  return messages;
}

if (isMainRun(process.argv[1], import.meta.url)) {
  const root = process.argv.slice(2).find(a => !a.startsWith('--')) ?? process.cwd();
  const { calls, misses, badReasons } = scanOutcomeRead(root);
  const counts = toCounts(misses);
  if (process.argv.includes('--print')) {
    const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    console.log(JSON.stringify(sorted, null, 2));
    process.exit(0);
  }
  const baseline = JSON.parse(readFileSync(join(resolve(root), 'scripts/outcome-read-baseline.json'), 'utf8'));
  const messages = compareWithBaseline(counts, baseline);
  for (const line of messages) console.log(OBSERVE_ONLY ? `::warning::outcome-read (наблюдение) ${line}` : `::error::outcome-read ${line}`);
  for (const line of badReasons) console.log(`::error::outcome-read ${line}`);
  const failed = badReasons.length > 0 || (!OBSERVE_ONLY && messages.length > 0);
  console.log(`outcome-read: ${failed ? 'ошибки' : 'ok'}, вызовов ${calls}, находок ${misses.length}${messages.length ? `, расхождений с базой ${messages.length}` : ''}`);
  process.exit(failed ? 1 : 0);
}
