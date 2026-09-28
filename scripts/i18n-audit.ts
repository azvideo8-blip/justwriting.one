import { readFileSync, readdirSync } from 'fs';
import { globSync } from 'glob';
import { fileURLToPath } from 'url';
import ts from 'typescript';

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

  console.log(`\nTotal defined: ${definedKeys.size}`);
  console.log(`Total used: ${usedKeys.size}`);
  console.log(`Missing: ${missing.length}, Unused: ${unused.length}, Incomplete: ${missingLocale.length}, ` +
    `Hardcoded Dialogs: ${hardcodedConfirmDialogs.length}, Hardcoded JSX: ${hardcodedJsxTotal}`);

  if (isBlind(srcFiles.length, tsxFiles.length)) {
    console.error('смёржено 0 файлов — аудит не видит кода, результат не считается');
    process.exit(1);
  }

  if (
    missing.length > 0 || missingLocale.length > 0 || hardcodedConfirmDialogs.length > 0 ||
    unused.length > 0 || hardcodedJsxTotal > 0
  ) {
    process.exit(1);
  }
}

if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('i18n-audit.ts'))) {
  runAudit();
}


