import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Запись и удаление не молчат о сбое.
 *
 * Класс, найденный четырьмя раундами аудита по одному месту за раз: функция
 * сохранения или удаления глотает ошибку, спокойно завершается — и вызывающий
 * показывает «Сохранено» / «удалено навсегда». Проверка синтаксическая и
 * общая для сервисного слоя, компонентов, хуков и app: в функции записи/удаления
 * и security-вызовах пустой catch и `.catch(() => {})` запрещены.
 * Сбой надо сообщить (reportError, return false, throw, счётчик) — или, если
 * молчание и есть правильное поведение, объяснить это комментарием,
 * начинающимся с «намеренно:».
 */

const ROOTS = ['src/core/services', 'src/core/sync', 'src/core/storage', 'src/features', 'src/app'];
const WRITE_NAME = /^(delete|remove|save|clear|purge|wipe|trash|restore|empty|prune|cascade|persist|write|drop|erase)/i;
const SECURITY_CALLS = /^(clearDeviceKey|wipeLocalData|wipeData|wipeAllUserData|eraseAllData|clearAllData|clearUserData|revokeConsent|clearConsent|setConsent|saveConsent|updateConsent)/i;
const REASON = /намеренно:/i;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      out.push(...files(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

export function inAuditedScope(path: string): boolean {
  return /^src\/core\/(services|sync|storage)\//.test(path)
    || /^src\/features\/[^/]+\/(services|components|hooks|store)\//.test(path)
    || /^src\/app\//.test(path);
}

function fnName(node: ts.Node, sf: ts.SourceFile): string | null {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) return node.name.getText(sf);
  const parent = node.parent;
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node))
      && (ts.isPropertyAssignment(parent) || ts.isVariableDeclaration(parent))) {
    return parent.name.getText(sf);
  }
  return null;
}

// Текст блока без фигурных скобок: комментарии внутри пустого catch.
function innerText(block: ts.Block, sf: ts.SourceFile): string {
  return sf.text.slice(block.getStart(sf) + 1, block.getEnd() - 1);
}

function getDirectCallee(node: ts.Node): string | null {
  if (ts.isCallExpression(node)) {
    if (ts.isIdentifier(node.expression)) return node.expression.text;
    if (ts.isPropertyAccessExpression(node.expression)) {
      const obj = node.expression.expression.getText();
      if (obj === 'localStorage' || obj === 'sessionStorage') return null;
      return node.expression.name.text;
    }
  }
  return null;
}

function getCalledNamesInBlock(node: ts.Node, sf: ts.SourceFile): string[] {
  const names: string[] = [];
  function walk(n: ts.Node) {
    if (ts.isCallExpression(n)) {
      if (ts.isIdentifier(n.expression)) {
        names.push(n.expression.text);
      } else if (ts.isPropertyAccessExpression(n.expression)) {
        const obj = n.expression.expression.getText(sf);
        if (obj !== 'localStorage' && obj !== 'sessionStorage') {
          names.push(n.expression.name.text);
        }
      }
    }
    ts.forEachChild(n, walk);
  }
  walk(node);
  return names;
}

export function scan(path: string, text: string): string[] {
  const found: string[] = [];
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node, owner: string | null): void => {
    const name = fnName(node, sf) ?? owner;

    if (ts.isCatchClause(node) && node.block.statements.length === 0 && !REASON.test(innerText(node.block, sf))) {
      const isWriteFn = name !== null && WRITE_NAME.test(name);
      const tryCalls = ts.isTryStatement(node.parent) ? getCalledNamesInBlock(node.parent.tryBlock, sf) : [];
      const secCall = tryCalls.find(c => SECURITY_CALLS.test(c));
      const writeCall = tryCalls.find(c => WRITE_NAME.test(c));
      if (isWriteFn || secCall || writeCall) {
        const matched = secCall ?? (isWriteFn ? name : writeCall);
        const at = `${path}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${matched}`;
        found.push(`${at}: пустой catch`);
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'catch') {
      const h = node.arguments[0];
      if (h && (ts.isArrowFunction(h) || ts.isFunctionExpression(h)) && ts.isBlock(h.body)
          && h.body.statements.length === 0 && !REASON.test(innerText(h.body, sf))) {
        const isWriteFn = name !== null && WRITE_NAME.test(name);
        const directCallee = getDirectCallee(node.expression.expression);
        const isSecCall = directCallee !== null && SECURITY_CALLS.test(directCallee);
        const isWriteCall = directCallee !== null && WRITE_NAME.test(directCallee);
        if (isWriteFn || isSecCall || isWriteCall) {
          const matched = isSecCall ? (directCallee ?? '') : (isWriteFn ? (name ?? '') : (directCallee ?? ''));
          const at = `${path}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${matched}`;
          found.push(`${at}: .catch(() => {})`);
        }
      }
    }

    ts.forEachChild(node, c => visit(c, name));
  };
  visit(sf, null);
  return found;
}

describe('запись и удаление не молчат о сбое', () => {
  it('в функциях записи/удаления и security-вызовах нет молча проглоченных ошибок', () => {
    const scanned = ROOTS.flatMap(files)
      .map(f => relative(process.cwd(), f).split(sep).join('/'))
      .filter(inAuditedScope);
    // Non-blind gate: проверяем, что отсканировано не 0 файлов (минимум 100)
    expect(scanned.length).toBeGreaterThan(100);
    const found = scanned.flatMap(p => scan(p, readFileSync(p, 'utf8')));
    expect(found).toEqual([]);
  });

  it('нормализация слэшей работает для Windows-путей (N-63)', () => {
    const winPath = 'src\\core\\services\\LocalDocumentService.ts';
    // Без нормализации Windows путь с обратными слэшами не распознаётся regex
    expect(inAuditedScope(winPath)).toBe(false);
    // С нормализацией — распознаётся корректно
    expect(inAuditedScope(winPath.split('\\').join('/'))).toBe(true);
  });

  it('security-вызовы (clearDeviceKey и др.) ловятся независимо от имени функции', () => {
    const badSample = `
      function handleConfirm() {
        void clearDeviceKey(uid).catch(() => {});
      }
    `;
    expect(scan('t.ts', badSample)).toEqual(['t.ts:3 clearDeviceKey: .catch(() => {})']);

    const okSample = `
      function handleConfirm() {
        void clearDeviceKey(uid).catch(() => { /* намеренно: ключ уже удалён */ });
      }
    `;
    expect(scan('t.ts', okSample)).toEqual([]);
  });

  it('проверка ловит то, что должна, и пропускает объяснённое', () => {
    const sample = [
      'async function deleteThing() { try { await x(); } catch { /* ignore */ } }',
      'const saveIt = () => p.catch(() => {});',
      'async function removeOk() { try { await x(); } catch { /* намеренно: кэш, пересоберётся */ } }',
      'async function saveReported() { try { await x(); } catch (e) { reportError(e); } }',
      'async function readThing() { try { await x(); } catch { /* ignore */ } }',
    ].join('\n');
    expect(scan('t.ts', sample).map(h => h.split(' ')[1]!.replace(/:$/, ''))).toEqual(['deleteThing', 'saveIt']);
  });
});
