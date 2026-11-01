// 31.10 (разбор Qoder): ворота мобильного e2e сравнивали push с прошлым push.
// Новый push отменяет прошлый прогон — правка кода, за которой ушли одни тесты,
// e2e не проходила ни разу. Теперь ветка сравнивается со своей базой на main.
// Мутация: в e2e-gate.sh для ветки взять base="$before" → (1) красный.
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const GATE = resolve(__dirname, '../ci/e2e-gate.sh');
let repo = '';
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
function commit(path: string): string {
  mkdirSync(join(repo, path, '..'), { recursive: true });
  writeFileSync(join(repo, path), String(Math.random()));
  git('add', path);
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', path);
  return git('rev-parse', 'HEAD');
}
const gate = (...args: string[]) =>
  execFileSync('bash', [GATE, ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

let codePush = '';
let testsPush = '';
let docsOnly = '';
beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'e2e-gate-'));
  git('init', '-q', '-b', 'main');
  commit('README.md');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('switch', '-qc', 'feat');
  codePush = commit('src/app.ts');
  testsPush = commit('src/__tests__/app.test.ts');
  git('switch', '-q', 'main');
  git('switch', '-qc', 'docs');
  docsOnly = commit('docs/note.md');
});

describe('ворота мобильного e2e', () => {
  it('(1) второй push ветки только с тестами — правка кода в ветке всё равно гоняет e2e', () => {
    expect(gate('push', 'refs/heads/feat', codePush, testsPush)).toBe('run=true');
  });
  it('(2) ветка без приложения — пропуск', () => {
    expect(gate('push', 'refs/heads/docs', '', docsOnly)).toBe('run=false');
  });
  it('(3) ручной запуск — всегда гоняет', () => {
    expect(gate('workflow_dispatch', 'refs/heads/docs', '', docsOnly)).toBe('run=true');
  });
});
