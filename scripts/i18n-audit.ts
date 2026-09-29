import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { globSync } from 'glob';
import { fileURLToPath } from 'url';
import path from 'node:path';
import ts from 'typescript';
import { planBaseline } from './knip-ratchet.mjs';

export function stripComments(code: string): string {
  let result = '';
  let inString: string | null = null;
  let isEscaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        result += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++; // skip '/'
      }
      continue;
    }

    if (inString) {
      result += ch;
      if (isEscaped) {
        isEscaped = false;
      } else if (ch === '\\') {
        isEscaped = true;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
      result += ch;
      continue;
    }

    result += ch;
  }
  return result;
}

export function findHardcodedDialogs(src: string, file: string = ''): { file: string; match: string }[] {
  const hardcodedConfirmDialogs: { file: string; match: string }[] = [];
  const dialogPattern = /\b(confirmDialog|alertDialog|promptDialog)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = dialogPattern.exec(src)) !== null) {
    const fnName = match[1];
    const startIndex = match.index + match[0].length;
    let depth = 1;
    let i = startIndex;
    let inString: string | null = null;
    let isEscaped = false;
    let inLineComment = false;
    let inBlockComment = false;

    while (i < src.length && depth > 0) {
      const ch = src[i];
      const next = src[i + 1];

      if (inLineComment) {
        if (ch === '\n') inLineComment = false;
        i++;
        continue;
      }

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          i += 2;
          continue;
        }
        i++;
        continue;
      }

      if (inString) {
        if (isEscaped) {
          isEscaped = false;
        } else if (ch === '\\') {
          isEscaped = true;
        } else if (ch === inString) {
          inString = null;
        }
      } else {
        if (ch === '/' && next === '/') {
          inLineComment = true;
          i += 2;
          continue;
        } else if (ch === '/' && next === '*') {
          inBlockComment = true;
          i += 2;
          continue;
        } else if (ch === "'" || ch === '"' || ch === '`') {
          inString = ch;
        } else if (ch === '(') {
          depth++;
        } else if (ch === ')') {
          depth--;
        }
      }
      i++;
    }

    const callContent = src.slice(startIndex, i - 1);
    const cleanedContent = stripComments(callContent);
    if (/[\u0400-\u04FF]/.test(cleanedContent)) {
      hardcodedConfirmDialogs.push({
        file,
        match: `${fnName}(${cleanedContent.replace(/\s+/g, ' ').trim().slice(0, 100)})`,
      });
    }
  }

  return hardcodedConfirmDialogs;
}

export interface JsxCyrillicReport {
  /** Русский прямо в JSX-тексте — то, что должно уезжать в t(). */
  text: { file: string; match: string }[];
  /** То же в placeholder / aria-label / title / alt. */
  attrs: { file: string; match: string }[];
  /** Кириллица внутри {…} в JSX (шаблоны, тернарники и т.д.). */
  expressions: { file: string; match: string }[];
  /** Для обратной совместимости: число строк с выражениями */
  expressionStrings: number;
}

const CYRILLIC = /[Ѐ-ӿ]/;
const UI_ATTRS = new Set(['placeholder', 'aria-label', 'title', 'alt']);

/**
 * G-1: аудит видел кириллицу только в аргументах confirmDialog/alertDialog/
 * promptDialog и рапортовал «0», пока весь остальной интерфейс оставался
 * невидимым. Разбор по AST, а не по регулярке: строка в комментарии или в
 * ключевом слове t() не должна попадать в отчёт.
 */
export function findHardcodedJsxCyrillic(src: string, file: string = ''): JsxCyrillicReport {
  const sourceFile = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const report: JsxCyrillicReport = { text: [], attrs: [], expressions: [], expressionStrings: 0 };

  const literalValue = (node: ts.Node): string | null => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return CYRILLIC.test(node.text) ? node.text : null;
    }
    // Шаблон с подстановками — тот же вшитый текст: `Поиск ${n}` не должен
    // проходить гейт только потому, что в нём есть ${}.
    if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map(span => span.literal.text)];
      return parts.some(part => CYRILLIC.test(part)) ? parts.join('${…}') : null;
    }
    return null;
  };

  const line = (node: ts.Node) => String(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
  const collapse = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 80);

  const walk = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const visible = node.text.replace(/&[^;\s]+;/g, ' ').trim();
      if (CYRILLIC.test(visible)) {
        report.text.push({ file, match: `:${line(node)} ${collapse(visible)}` });
      }
    }

    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sourceFile);
      if (UI_ATTRS.has(name)) {
        const init = node.initializer;
        const value = ts.isJsxExpression(init) && init.expression
          ? literalValue(init.expression)
          : literalValue(init);
        if (value) report.attrs.push({ file, match: `${name}="${collapse(value)}"` });
      }
    }

    const litVal = literalValue(node);
    if (litVal) {
      for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
        // Значение атрибута уже учтено выше — не двойным счётом.
        if (ts.isJsxAttribute(p)) break;
        if (ts.isJsxExpression(p)) {
          if (!ts.isJsxAttribute(p.parent)) {
            report.expressions.push({ file, match: `:${line(node)} ${collapse(litVal)}` });
            report.expressionStrings++;
          }
          break;
        }
      }
    }

    ts.forEachChild(node, walk);
  };

  walk(sourceFile);
  return report;
}

/**
 * Прогон без разобранных файлов — это не «чисто», это «ничего не видно».
 * Молча зелёный гейт ровно того и стоил этому репозиторию.
 */
export function isBlind(srcCount: number, tsxCount: number): boolean {
  return srcCount === 0 || tsxCount === 0;
}

// C-4 (R2-007): JSX — не единственный путь текста в рендер. showToast(...),
// сеттеры вида setError(...), addActivity(...) и поля currentStage/message/label
// уезжают в UI прямо из .ts, и в английском интерфейсе остаются русскими.
// Список стоков — из кода, а не из фантазии: собиратели промптов (profilePrompt,
// AIMemoryAssembler-ы), лог-вызовы (console.*, reportError) и поля text/content
// (в них живут тексты промптов) сюда сознательно не входят.
const UI_SINK_CALLEES = new Set(['showToast', 'addActivity', 'showDbOverlay', 'confirm', 'alert', 'prompt']);
const UI_SINK_SETTER = /^(set|show)[A-Za-z0-9_]*(Error|Message|Hint|Notice|Toast|Status|Stage|Overlay)$/;
const UI_TEXT_FIELDS = new Set(['currentStage', 'message', 'label', 'title', 'description', 'error', 'errors', 'hint', 'subtitle']);
// Аргументы этих вызовов — журнал или телеметрия, их никто не показывает юзеру.
const LOG_CALLEES = new Set(['reportError', 'addError', 'logEvent', 'track', 'captureException']);

export interface UiSinkHit {
  file: string;
  /** Имя стока: вызов (`showToast`) или поле (`currentStage`). */
  sink: string;
  /** Текст с подстановками, свёрнутый до одной строки — он же ключ храповика. */
  match: string;
}

export function findHardcodedUiText(src: string, file = ''): UiSinkHit[] {
  // ScriptKind не форсируется: в .ts стрелочная дженерик-функция (`<T>(x) => x`)
  // под TSX распарсилась бы как JSX.
  const sourceFile = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const seen = new Set<string>();
  const hits: UiSinkHit[] = [];

  const literalText = (node: ts.Node): string | null => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return CYRILLIC.test(node.text) ? node.text : null;
    }
    if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map(span => span.literal.text)];
      return parts.some(part => CYRILLIC.test(part)) ? parts.join('${…}') : null;
    }
    return null;
  };
  const collapse = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 80);

  const push = (sink: string, value: string) => {
    const match = collapse(value);
    const key = `${file}:${sink}:${match}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ file, sink, match });
  };

  const calleeName = (call: ts.CallExpression): string => {
    const expr = call.expression;
    if (ts.isPropertyAccessExpression(expr)) {
      // console.log / console.warn — журнал, чем бы ни был аргумент.
      return ts.isIdentifier(expr.expression) && expr.expression.text === 'console'
        ? 'console'
        : expr.name.text;
    }
    if (ts.isIdentifier(expr)) return expr.text;
    return '';
  };

  const uiSinkOf = (call: ts.CallExpression): string | null => {
    const name = calleeName(call);
    if (!name || LOG_CALLEES.has(name) || name === 'console') return null;
    return UI_SINK_CALLEES.has(name) || UI_SINK_SETTER.test(name) ? name : null;
  };

  const enclosingCall = (node: ts.Node): ts.CallExpression | null => {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isCallExpression(p)) return p;
      if (ts.isFunctionDeclaration(p) || ts.isSourceFile(p)) return null;
    }
    return null;
  };

  const isLogArg = (node: ts.Node): boolean => {
    const call = enclosingCall(node);
    if (!call) return false;
    const name = calleeName(call);
    return LOG_CALLEES.has(name) || name === 'console';
  };

  const collectFields = (obj: ts.ObjectLiteralExpression): void => {
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const name = prop.name.getText(sourceFile).replace(/['"]/g, '');
      if (!UI_TEXT_FIELDS.has(name)) continue;
      const lit = literalText(prop.initializer);
      if (lit) push(name, lit);
    }
  };

  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const sink = uiSinkOf(node);
      if (sink) {
        for (const arg of node.arguments) {
          const lit = literalText(arg);
          if (lit) push(sink, lit);
          else if (ts.isObjectLiteralExpression(arg)) collectFields(arg);
        }
      }
    }
    // Поля вне сток-вызовов — тоже кандидат в рендер: константы-контент
    // (секции политики, LIFE_DOMAINS), объекты в модалках. Лог-аргументы
    // пропускаем: их message никто пользователю не показывает.
    if (ts.isObjectLiteralExpression(node) && !isLogArg(node)) collectFields(node);
    ts.forEachChild(node, walk);
  };

  walk(sourceFile);
  return hits;
}

export const I18N_BASELINE_HEADER = [
  '# C-4 (R2-007): кириллица, уходящая в UI мимо JSX (showToast/сеттеры/addActivity и',
  '# поля title/label/currentStage/…). Строка = файл:сток:текст.',
  '# Убирать строку — когда текст переехал в t(); добавлять — только вместе с тикетом.',
].join('\n');

export function uiSinkKey(hit: UiSinkHit): string {
  return `${hit.file}:${hit.sink}:${hit.match}`;
}

const UI_BASELINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'i18n-baseline.txt');

function readUiBaseline(): string[] {
  try {
    return readFileSync(UI_BASELINE, 'utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}


export function runAudit() {
  const translationFiles = readdirSync('src/shared/i18n/translations')
    .filter(f => f.endsWith('.ts'));

  const definedKeys = new Set<string>();
  const missingLocale: { key: string; missing: 'ru' | 'en' }[] = [];

  for (const file of translationFiles) {
    const src = readFileSync(`src/shared/i18n/translations/${file}`, 'utf-8');
    const keyMatches = [...src.matchAll(/^\s{2}(\w+):\s*\{((?:[^}'"]|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")*)\}/gm)];
    for (const match of keyMatches) {
      const key = match[1];
      const body = match[2];
      if (!key || !body) continue;
      definedKeys.add(key);
      if (!body.includes("ru:")) missingLocale.push({ key, missing: 'ru' });
      if (!body.includes("en:")) missingLocale.push({ key, missing: 'en' });
    }
  }

  const srcFiles = globSync('src/**/*.{ts,tsx}', {
    ignore: ['src/shared/i18n/**', 'src/**/__tests__/**', 'node_modules/**']
  });

  const usedKeys = new Set<string>();
  for (const file of srcFiles) {
    const src = readFileSync(file, 'utf-8');
    const tMatches = [...src.matchAll(/\bt\(['"]([a-z][a-zA-Z_0-9]*)['"]/g)];
    for (const m of tMatches) {
      const key = m[1];
      if (key) usedKeys.add(key);
    }
    const tpMatches = [...src.matchAll(/\btp\(\s*['"]([a-z][a-zA-Z_0-9]*)['"]/g)];
    for (const m of tpMatches) {
      const key = m[1];
      if (key) {
        for (const sfx of ['_one', '_few', '_many']) {
          usedKeys.add(`${key}${sfx}`);
        }
        if (definedKeys.has(`${key}_other`)) {
          usedKeys.add(`${key}_other`);
        }
      }
    }
    const arrayMatches = [...src.matchAll(/['"]([a-z][a-zA-Z_0-9]+)['"]/g)];
    for (const m of arrayMatches) {
      const key = m[1];
      if (key && key.includes('_') && definedKeys.has(key)) usedKeys.add(key);
    }
    const templateMatches = [...src.matchAll(/t\(`([a-z][a-zA-Z_]*)_\$\{/g)];
    for (const m of templateMatches) {
      const key = m[1];
      if (!key) continue;
      const prefix = key + '_';
      for (const k of definedKeys) {
        if (k.startsWith(prefix)) usedKeys.add(k);
      }
    }
  }

  const hardcodedConfirmDialogs: { file: string; match: string }[] = [];
  for (const file of srcFiles) {
    const src = readFileSync(file, 'utf-8');
    hardcodedConfirmDialogs.push(...findHardcodedDialogs(src, file));
  }

  // G-1: «не видно» должно отличаться от «проверено и чисто», поэтому здесь
  // считается, сколько файлов реально разобрано, и сколько лежат под allowlist.
  const tsxFiles = srcFiles.filter(file => file.endsWith('.tsx'));
  const jsxText: { file: string; match: string }[] = [];
  const jsxAttr: { file: string; match: string }[] = [];
  const jsxExpr: { file: string; match: string }[] = [];

  for (const file of tsxFiles) {
    const found = findHardcodedJsxCyrillic(readFileSync(file, 'utf-8'), file);
    jsxText.push(...found.text);
    jsxAttr.push(...found.attrs);
    jsxExpr.push(...found.expressions);
  }

  const missing = [...usedKeys].filter(k => !definedKeys.has(k));
  const unused = [...definedKeys].filter(k => !usedKeys.has(k));

  // C-4: стоки ищутся и в .ts, и в .tsx — текст в UI попадает не только из JSX.
  const uiHits = srcFiles.flatMap(file => findHardcodedUiText(readFileSync(file, 'utf-8'), file));
  const uiKeys = [...new Set(uiHits.map(uiSinkKey))].sort();
  const uiBaseline = readUiBaseline();
  const uiPlan = planBaseline(uiBaseline, uiKeys, {
    grow: process.argv.includes('--grow-baseline'),
    header: I18N_BASELINE_HEADER,
  });

  if (process.argv.includes('--update-baseline') || process.argv.includes('--grow-baseline')) {
    if (!uiPlan.mayWrite) {
      console.error(`::error::i18n-baseline не записан: новых строк ${uiPlan.added.length}`);
      uiPlan.added.forEach(key => console.error(`  ${key}`));
      console.error('Долг уменьшается: перенесите текст в t() либо обновите осознанно — --grow-baseline.');
      process.exit(1);
    }
    writeFileSync(UI_BASELINE, uiPlan.contents);
    console.log(`i18n-baseline: записано ${uiKeys.length} строк (было ${uiBaseline.length}, вычеркнуто ${uiPlan.removed.length}, добавлено ${uiPlan.added.length})`);
    uiPlan.added.forEach(key => console.log(`  + ${key}`));
    process.exit(0);
  }

  console.log('\n=== MISSING KEYS (used in code, not in translations) ===');
  missing.forEach(k => console.log(`  ❌ ${k}`));

  console.log('\n=== UNUSED KEYS (in translations, not used in code) ===');
  unused.forEach(k => console.log(`  🗑️  ${k}`));

  console.log('\n=== MISSING LOCALE ===');
  missingLocale.forEach(({ key, missing }) => console.log(`  ⚠️  ${key} — missing [${missing}]`));

  if (hardcodedConfirmDialogs.length > 0) {
    console.log('\n=== HARDCODED CYRILLIC IN CONFIRM DIALOGS ===');
    hardcodedConfirmDialogs.forEach(({ file, match }) => console.log(`  ❌ ${file}: ${match}`));
  }

  console.log('\n=== CYRILLIC IN JSX (G-1) ===');
  console.log(`  файлов разобрано: ${tsxFiles.length} из ${srcFiles.length} (ts/tsx без i18n и тестов)`);
  if (jsxText.length > 0) {
    console.log('  ❌ JSX-текст вне t():');
    jsxText.forEach(({ file, match }) => console.log(`     ${file}${match}`));
  }
  if (jsxAttr.length > 0) {
    console.log('  ❌ placeholder/aria-label/title/alt вне t():');
    jsxAttr.forEach(({ file, match }) => console.log(`     ${file}: ${match}`));
  }
  if (jsxExpr.length > 0) {
    console.log('  ❌ кириллица внутри {…} в JSX вне t():');
    jsxExpr.forEach(({ file, match }) => console.log(`     ${file}${match}`));
  }

  const hardcodedJsxTotal = jsxText.length + jsxAttr.length + jsxExpr.length;

  console.log('\n=== CYRILLIC IN UI SINKS (C-4) ===');
  console.log(`  разобрано файлов: ${srcFiles.length} (ts+tsx без i18n и тестов), в baseline ${uiBaseline.length}`);
  if (uiPlan.added.length > 0) {
    console.log('  ❌ новое мимо t() (нет в baseline):');
    uiPlan.added.forEach(key => console.log(`     ${key}`));
    console.log(`  обновить долг нельзя: перенесите текст в t(); --update-baseline только укорачивает список`);
  }

  console.log(`\nTotal defined: ${definedKeys.size}`);
  console.log(`Total used: ${usedKeys.size}`);
  console.log(`Missing: ${missing.length}, Unused: ${unused.length}, Incomplete: ${missingLocale.length}, ` +
    `Hardcoded Dialogs: ${hardcodedConfirmDialogs.length}, Hardcoded JSX: ${hardcodedJsxTotal}, ` +
    `UI sinks: ${uiHits.length} (новых ${uiPlan.added.length})`);

  if (isBlind(srcFiles.length, tsxFiles.length)) {
    console.error('смёржено 0 файлов — аудит не видит кода, результат не считается');
    process.exit(1);
  }

  if (
    missing.length > 0 || missingLocale.length > 0 || hardcodedConfirmDialogs.length > 0 ||
    unused.length > 0 || hardcodedJsxTotal > 0 || uiPlan.added.length > 0
  ) {
    process.exit(1);
  }
}

if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('i18n-audit.ts'))) {
  runAudit();
}


