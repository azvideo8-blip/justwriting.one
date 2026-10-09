// FX-2: храповик формата ошибок в серверных логах.
//
// Правило: `console.error` и `console.warn` в `api/ai/*.ts` не имеют права печатать
// пойманную ошибку как есть. Текст ошибки провайдера строится в api/ai/provider.ts
// (`OpenRouter {status}: {до 300 знаков тела ответа}`), а тело отказа 4xx иногда
// эхом возвращает фрагмент запроса — то есть текст заметок человека. Форму ошибки
// даёт `safeErrorShape` (src/shared/ai/errorShape.ts): статус, имя, код — без сообщения.
//
// Что ловит регулярка: аргумент — голое имя пойманной ошибки (`e`, `err`, `error`,
// `e1`…), или интерполяция `${e}` / `${err.message}` / `${error.cause}` внутри строки.
// Известная слепая зона: ошибка, предварительно сохранённая в переменную с другим
// именем (`const m = String(e)` и затем `console.error(…, m)`), и вызовы, собранные
// через spread. Тогда сторожит только поведение (serverLogsPrivacy.audit42.test.ts).
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

function findOffenders(file: string, source: string): string[] {
  const out: string[] = [];
  const call = /console\.(?:error|warn)\s*\(/g;
  for (const m of source.matchAll(call)) {
    const openIdx = (m.index ?? 0) + m[0].length - 1;
    const args = splitArgs(source, openIdx);
    if (args.some(a => /safeErrorShape\s*\(/.test(a))) continue;
    const bare = args.some(a => BARE_ARG.test(a));
    const interp = args.some(a => INTERP.test(a));
    if (!bare && !interp) continue;
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
});
