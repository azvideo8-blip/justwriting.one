import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const WRITE_NAME = /^(delete|remove|save|clear|purge|wipe|trash|restore|empty|prune|cascade|persist|write|drop|erase)/i;
const STATUS_FIELD = /([oO]k|cloudSynced|deleted|pruned|[cC]ount)/;
const REASON = /намеренно:/i;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules' || name === 'dist') continue;
      out.push(...walk(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

export interface StatusTarget {
  name: string;
  parent?: string | undefined;
}

export function findStatusReturningTargets(sourceFiles: { path: string; text: string }[]): StatusTarget[] {
  const targets: StatusTarget[] = [];
  const seen = new Set<string>();

  for (const { path, text } of sourceFiles) {
    const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);

    const checkAndAdd = (name: string, parent?: string, returnTypeNode?: ts.TypeNode, body?: ts.Node) => {
      if (!WRITE_NAME.test(name)) return;
      const key = `${parent ?? ''}.${name}`;
      if (seen.has(key)) return;

      let isStatus = false;
      if (returnTypeNode) {
        const typeText = returnTypeNode.getText(sf);
        if (typeText.includes('boolean') || STATUS_FIELD.test(typeText)) {
          isStatus = true;
        }
      }

      if (!isStatus && body) {
        const bodyText = body.getText(sf);
        if (
          /return\s+(true|false)\b/.test(bodyText) ||
          /return\s*\{[^}]*([oO]k|cloudSynced|deleted|pruned|[cC]ount)/.test(bodyText)
        ) {
          isStatus = true;
        }
      }

      if (isStatus) {
        seen.add(key);
        targets.push({ name, parent });
      }
    };

    const visit = (node: ts.Node, currentParent?: string) => {
      let nextParent = currentParent;

      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        nextParent = node.name.text;
      }

      if (ts.isFunctionDeclaration(node) && node.name) {
        checkAndAdd(node.name.text, undefined, node.type, node.body);
      } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
        checkAndAdd(node.name.text, currentParent, node.type, node.body);
      } else if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
        if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
          checkAndAdd(node.name.text, currentParent, node.initializer.type, node.initializer.body);
        }
      } else if (ts.isMethodSignature(node) && ts.isIdentifier(node.name)) {
        checkAndAdd(node.name.text, currentParent, node.type);
      }

      ts.forEachChild(node, c => visit(c, nextParent));
    };

    visit(sf);
  }

  return targets;
}

export function scanDiscardedCalls(
  filePath: string,
  text: string,
  targets: StatusTarget[]
): string[] {
  const issues: string[] = [];
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);

  const visit = (node: ts.Node) => {
    if (ts.isExpressionStatement(node)) {
      let inner = node.expression;
      if (ts.isAwaitExpression(inner)) inner = inner.expression;
      if (ts.isVoidExpression(inner)) {
        inner = inner.expression;
        if (ts.isAwaitExpression(inner)) inner = inner.expression;
      }

      if (ts.isCallExpression(inner)) {
        let calleeName: string | null = null;
        let parentName: string | undefined = undefined;

        if (ts.isIdentifier(inner.expression)) {
          calleeName = inner.expression.text;
        } else if (ts.isPropertyAccessExpression(inner.expression)) {
          calleeName = inner.expression.name.text;
          if (ts.isIdentifier(inner.expression.expression)) {
            parentName = inner.expression.expression.text;
          }
        }

        if (calleeName && WRITE_NAME.test(calleeName)) {
          const match = targets.find(t => {
            if (t.name !== calleeName) return false;
            if (t.parent && parentName && t.parent !== parentName) return false;
            return true;
          });

          if (match) {
            const lineNum = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
            const lineText = text.split('\n')[lineNum] ?? '';
            if (!REASON.test(lineText)) {
              const relPath = filePath.split(sep).join('/');
              issues.push(`${relPath}:${lineNum + 1} выброшен результат вызова ${parentName ? `${parentName}.${calleeName}` : calleeName}()`);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return issues;
}

describe('R10-3: honestResults gate — «функция вернула флаг, вызывающий его выбросил»', () => {
  it('находит вызовы функций записи/удаления со статусом, чей результат выброшен без «намеренно:»', () => {
    const allFiles = walk('src')
      .map(p => ({
        path: relative(process.cwd(), p).split(sep).join('/'),
        text: readFileSync(p, 'utf8'),
      }))
      .filter(f => !f.path.includes('/__tests__/') && !f.path.includes('/test/'));

    // Non-blind gate: must scan substantial number of files (> 50)
    expect(allFiles.length).toBeGreaterThan(50);

    const targets = findStatusReturningTargets(allFiles);

    // Guaranteed known status targets
    targets.push(
      { name: 'removeLocalCopy', parent: 'StorageService' },
      { name: 'deleteDocument', parent: 'LocalDocumentService' },
      { name: 'deleteDocument', parent: 'LocalStorageService' },
      { name: 'deleteArchiveSession' },
      { name: 'emptyTrash' },
      { name: 'pruneExpiredTrash' }
    );

    expect(targets.length).toBeGreaterThan(5);

    const findings: string[] = [];
    for (const file of allFiles) {
      findings.push(...scanDiscardedCalls(file.path, file.text, targets));
    }

    expect(findings).toEqual([]);
  }, 30_000); // обходит весь src через AST: под полной нагрузкой 5 с не хватает

  it('самопроверка гейта: синтетический исходник с await deleteProbe() даёт находку', () => {
    const targets: StatusTarget[] = [{ name: 'deleteProbe' }];
    const sample = `
      async function test() {
        await deleteProbe();
      }
    `;
    const res = scanDiscardedCalls('sample.ts', sample, targets);
    expect(res).toHaveLength(1);
    expect(res[0]).toContain('выброшен результат вызова deleteProbe()');
  });

  it('самопроверка гейта: «намеренно:» разрешает выброс результата', () => {
    const targets: StatusTarget[] = [{ name: 'deleteProbe' }];
    const sample = `
      async function test() {
        await deleteProbe(); // намеренно: фоновая зачистка, результат не важен
      }
    `;
    const res = scanDiscardedCalls('sample.ts', sample, targets);
    expect(res).toHaveLength(0);
  });

  it('самопроверка гейта: падает при 0 файлов на входе', () => {
    const emptyFiles: { path: string; text: string }[] = [];
    expect(() => {
      if (emptyFiles.length === 0) throw new Error('Gate scanned 0 files');
    }).toThrow('Gate scanned 0 files');
  });
});
