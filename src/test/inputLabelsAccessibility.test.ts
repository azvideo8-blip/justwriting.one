/**
 * N-71: Сканер `<input>` без подписи.
 * Правила:
 *   – exempt: type="hidden", className/class содержит "hidden" или "sr-only",
 *             style={{ display: 'none' }}
 *   – labeled: aria-label, aria-labelledby, или элемент вложен в <label>
 *
 * Тест не слеп: падает, если не нашёл ни одного input-а в src/.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

const ROOT_DIR = path.resolve(__dirname, '../..');
const SCAN_DIR = path.resolve(ROOT_DIR, 'src');

/** Рекурсивно обходит директорию и возвращает все .tsx файлы (не __tests__, не .test.) */
function collectTsxFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      results.push(...collectTsxFiles(full));
    } else if (e.isFile() && e.name.endsWith('.tsx') && !e.name.includes('.test.')) {
      results.push(full);
    }
  }
  return results;
}

type UnlabeledInput = { file: string; line: number; snippet: string };

/**
 * Возвращает строковое значение атрибута JSX.
 * Поддерживает строковые литералы и JSX-выражения { "…" }.
 */
function attrStringValue(attr: ts.JsxAttribute, _sf: ts.SourceFile): string | undefined {
  const init = attr.initializer;
  if (!init) return '';
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(init.expression)) {
    return init.expression.text;
  }
  // для JSX-выражений типа {t('...')} возвращаем непустой маркер
  if (ts.isJsxExpression(init)) return '__expr__';
  return undefined;
}

/** true если input является спрятанным (exempt от требования label) */
function isExempt(attrs: readonly ts.JsxAttributeLike[]): boolean {
  for (const a of attrs) {
    if (!ts.isJsxAttribute(a)) continue;
    const name = a.name.getText();
    const val = attrStringValue(a, null as unknown as ts.SourceFile);
    if (name === 'type' && val === 'hidden') return true;
    if ((name === 'className' || name === 'class') && typeof val === 'string') {
      // className может быть выражением — тогда val === '__expr__'
      if (/\bhidden\b/.test(val) || /\bsr-only\b/.test(val)) return true;
    }
    if (name === 'style') {
      const init = a.initializer;
      if (init && ts.isJsxExpression(init) && init.expression) {
        const txt = init.expression.getText();
        if (/display\s*:\s*['"]none['"]/.test(txt)) return true;
      }
    }
  }
  return false;
}

/** true если input имеет aria-label или aria-labelledby */
function hasAriaLabel(attrs: readonly ts.JsxAttributeLike[]): boolean {
  for (const a of attrs) {
    if (!ts.isJsxAttribute(a)) continue;
    const name = a.name.getText();
    if (name === 'aria-label' || name === 'aria-labelledby') return true;
  }
  return false;
}

/** Проверяет, что какой-либо из предков (по стеку) является <label> */
function isInsideLabel(labelStack: string[]): boolean {
  return labelStack.includes('label');
}

function scanFile(filePath: string): UnlabeledInput[] {
  const src = fs.readFileSync(filePath, 'utf8');
  const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = src.split('\n');
  const issues: UnlabeledInput[] = [];
  const labelStack: string[] = [];

  function visit(node: ts.Node) {
    // Отслеживаем открытие/закрытие JSX-элементов для стека <label>
    if (ts.isJsxElement(node)) {
      const openTag = node.openingElement;
      const tagName = openTag.tagName.getText();
      labelStack.push(tagName);
      ts.forEachChild(node, visit);
      labelStack.pop();
      return;
    }

    // Самозакрывающийся тег <input ... />
    if (ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText();
      if (tagName === 'input') {
        const attrs = node.attributes.properties;
        if (!isExempt(attrs) && !hasAriaLabel(attrs) && !isInsideLabel(labelStack)) {
          const pos = sf.getLineAndCharacterOfPosition(node.getStart());
          const lineText = (lines[pos.line] || '').trim().slice(0, 120);
          issues.push({
            file: path.relative(SCAN_DIR, filePath),
            line: pos.line + 1,
            snippet: lineText,
          });
        }
      }
      // Ещё нужно пройти детей (JSX-атрибуты могут содержать JSX)
      ts.forEachChild(node, visit);
      return;
    }

    // Открывающий тег внутри JsxElement уже обработан выше через isJsxElement
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sf, visit);
  return issues;
}

describe('N-71: input accessibility labels scanner', () => {
  const files = collectTsxFiles(SCAN_DIR);

  it('found at least 10 tsx files to scan (non-blind gate)', () => {
    expect(files.length, `Expected >= 10 tsx files in ${SCAN_DIR}`).toBeGreaterThanOrEqual(10);
  });

  it('all <input> elements in src/ have accessible labels (aria-label, aria-labelledby, or parent <label>)', () => {
    let totalInputs = 0;
    const allIssues: UnlabeledInput[] = [];

    for (const f of files) {
      const issues = scanFile(f);
      if (issues.length > 0) {
        allIssues.push(...issues);
      }
      // Count the total inputs in file to ensure scan is non-trivial
      const src = fs.readFileSync(f, 'utf8');
      const matches = src.match(/<input[\s/]/g);
      if (matches) totalInputs += matches.length;
    }

    expect(totalInputs, 'Non-blind: must find at least 20 inputs across all tsx files').toBeGreaterThanOrEqual(20);

    if (allIssues.length > 0) {
      const report = allIssues
        .map(i => `  ${i.file}:${i.line}  ${i.snippet}`)
        .join('\n');
      expect.fail(
        `Found ${allIssues.length} <input> element(s) without aria-label, aria-labelledby, or parent <label>:\n${report}\n` +
        'Add aria-label="…" (or aria-labelledby) to each, or wrap in <label>.',
      );
    }
  });
});
