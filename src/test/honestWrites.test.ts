import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Запись и удаление не молчат о сбое.
 *
 * Класс, найденный четырьмя раундами аудита по одному месту за раз: функция
 * сохранения или удаления глотает ошибку, спокойно завершается — и вызывающий
 * показывает «Сохранено» / «удалено навсегда». Проверка синтаксическая и
 * общая для всего слоя сервисов: в функции записи/удаления пустой catch и
 * `.catch(() => {})` запрещены. Сбой надо сообщить (reportError, return false,
 * throw, счётчик) — или, если молчание и есть правильное поведение, объяснить
 * это комментарием, начинающимся с «намеренно:».
 */

const ROOTS = ['src/core/services', 'src/core/sync', 'src/core/storage', 'src/features'];
const WRITE_NAME = /^(delete|remove|save|clear|purge|wipe|trash|restore|empty|prune|cascade|persist|write|drop|erase)/i;
const REASON = /намеренно:/i;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      out.push(...files(p));
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function inServiceLayer(path: string): boolean {
  return /^src\/core\/(services|sync|storage)\//.test(path) || /^src\/features\/[^/]+\/services\//.test(path);
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

function scan(path: string, text: string): string[] {
  const found: string[] = [];
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node, owner: string | null): void => {
    const name = fnName(node, sf) ?? owner;
    if (name !== null && WRITE_NAME.test(name)) {
      const at = `${path}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${name}`;
      if (ts.isCatchClause(node) && node.block.statements.length === 0 && !REASON.test(innerText(node.block, sf))) {
        found.push(`${at}: пустой catch`);
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'catch') {
        const h = node.arguments[0];
        if (h && (ts.isArrowFunction(h) || ts.isFunctionExpression(h)) && ts.isBlock(h.body)
            && h.body.statements.length === 0 && !REASON.test(innerText(h.body, sf))) {
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
  it('в функциях записи/удаления слоя сервисов нет молча проглоченных ошибок', () => {
    const found = ROOTS.flatMap(files)
      .map(f => relative(process.cwd(), f))
      .filter(inServiceLayer)
      .flatMap(p => scan(p, readFileSync(p, 'utf8')));
    expect(found).toEqual([]);
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
