// FX-2: храповик формата ошибок в серверных логах.
//
// Правило: `console.error` и `console.warn` в `api/ai/*.ts` не имеют права печатать
// пойманную ошибку как есть. Текст ошибки провайдера строится в api/ai/provider.ts
// (`OpenRouter {status}: {до 300 знаков тела ответа}`), а тело отказа 4xx иногда
// эхом возвращает фрагмент запроса — то есть текст заметок человека. Форму ошибки
// даёт `safeErrorShape` (src/shared/ai/errorShape.ts): статус, имя, код — без сообщения.
//
// Что ловит регулярка: аргумент — голое имя пойманной ошибки (`e`, `err`, `error`,
// `e1`…), или интерполяция `${e}` / `${err.message}` / `${error.cause}` внутри строки,
// и (R7Q-016) то же после переименования: `const msg = String(e.message)` и затем
// `console.error(…, msg)` / `${msg}`. По-прежнему вне покрытия — spread-аргументы.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const AI_DIR = join(__dirname, '..', 'ai');
const BARE_ARG = /^\s*(?:e|err|error|e\d+|error\d+)\s*$/;
const INTERP = /\$\{\s*(?:e|err|error|e\d+|error\d+)(?:\.[\w$]+)*(?:\s*\?\?\s*[^}]*)?\s*\}/;

/** Аргументы одного вызова, разбитые по запятым верхнего уровня. */
function splitArgs(source: string, openIdx: number): string[] {
  let depth = 0; const args: string[] = []; let cur = '';
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (depth === 0 && ch === ')') { args.push(cur); return args; }
    if (depth === 1 && ch === ',') { args.push(cur); cur = ''; continue; }
    cur += ch;
  }
  return args;
}

/** Имена переменных, в которые предварительно сохранена пойманная ошибка. */
function errorDerivedVars(source: string): Set<string> {
  const names = new Set<string>();
  const decl = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*)/g;
  for (const m of source.matchAll(decl)) {
    const init = m[2] ?? '';
    if (!/(?:^|[^.\w$])(?:e|err|error|e\d+|error\d+)(?:[^.\w$]|$)/.test(init)) continue;
    if (!/\.message\b|String\s*\(/.test(init)) continue;
    names.add(m[1]!);
  }
  return names;
}

function findOffenders(file: string, source: string): string[] {
  const out: string[] = [];
  const derived = errorDerivedVars(source);
  const call = /console\.(?:error|warn)\s*\(/g;
  for (const m of source.matchAll(call)) {
    const openIdx = (m.index ?? 0) + m[0].length - 1;
    const args = splitArgs(source, openIdx);
    if (args.some(a => /safeErrorShape\s*\(/.test(a))) continue;
    const bare = args.some(a => BARE_ARG.test(a));
    const interp = args.some(a => INTERP.test(a));
    // R7Q-016: прежняя слепая зона — ошибка, переименованная в `msg` (или
    // извлечённая через `String(e.message)`), и напечатанная уже под другим именем:
    // и как отдельный аргумент, и внутри конкатенации/шаблонной строки.
    const derivedRe = derived.size > 0
      ? new RegExp(`\\b(?:${[...derived].map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`)
      : null;
    const derivedArg = derivedRe !== null && args.some(a => derivedRe.test(a));
    if (!bare && !interp && !derivedArg) continue;
    const line = source.slice(0, m.index).split('\n').length;
    out.push(`api/ai/${file}:${line}: ${source.split('\n')[line - 1]?.trim().slice(0, 100)}`);
  }
  return out;
}

describe('FX-2: храповик формата ошибок в api/ai', () => {
  it('ни один console.error/console.warn не печатает пойманную ошибку как есть', () => {
    const files = readdirSync(AI_DIR).filter(f => f.endsWith('.ts') && !f.includes('.test.'));
    const offenders = files.flatMap(f => findOffenders(f, readFileSync(join(AI_DIR, f), 'utf8')));
    // 1 — список печатается в сообщении падения, чтобы его можно было сверить с тикетом.
    expect(offenders, `мест, печатающих сырую ошибку: ${offenders.length}\n${offenders.join('\n')}`).toEqual([]);
  });

  it('ловит ошибку, сохранённую в переменную (пояс тикета: `msg`)', () => {
    const src = [
      'try { await x() } catch (e) {',
      '  const msg = String((e as { message?: string })?.message ?? e);',
      "  console.warn('[AI judge] soft failure:', msg);",
      '}',
    ].join('\n');
    expect(findOffenders('judge.logic.ts', src)).toHaveLength(1);
  });

  it('ловит интерполяцию `${msg}` внутри строки', () => {
    const src = [
      'catch (e) {',
      '  const msg = (e as Error).message;',
      "  console.error('[t] failed: ' + msg);",
      '}',
    ].join('\n');
    expect(findOffenders('t.logic.ts', src)).toHaveLength(1);
  });

  it('не ловит safeErrorShape(msg) и служебные строки без ошибки', () => {
    const src = [
      'catch (e) {',
      '  const msg = String((e as { message?: string })?.message ?? e);',
      "  if (/quota/i.test(msg)) throw new AiError('resource-exhausted', 'x');",
      "  console.warn('[AI judge] soft failure:', safeErrorShape(e));",
      "  console.log('[AI judge] verdicts:', verdicts.length);",
      '}',
    ].join('\n');
    expect(findOffenders('clean.logic.ts', src)).toEqual([]);
  });
});
