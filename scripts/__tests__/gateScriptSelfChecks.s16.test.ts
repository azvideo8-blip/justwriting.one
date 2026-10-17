// S-16 (R7Q-036): из четырёх гейтов «не холостого» механизма в скриптах ворот
// независимой проверялки была только одна. Здесь — три оставшиеся, каждая на
// ИЗМЕНЁННОЙ КОПИИ самого скрипта, а не на пересказе его логики:
//
//  (ii) audit-proofs.sh 3.3 ищет стороку `pull-backup.sh` только среди
//       незакомментированных строк (code_lines). Закомментированный guard обязан
//       дать провал «guard regex not found», а не зелёный отчёт.
//  (iii) audit-proofs.sh 3.7: список иконок в manifest и og-картинок в
//       index.html. Пустой список обязан провалиться, а не «ноль найдено, всё
//       хорошо».
//  (iv) sync-mutation-sweep.sh: пустой список мутаций — провал до базового
//       прогона; записью без массива tests — тоже провал.
//
// Мутация к (ii): закомментировать guard в фикстуре → красный. К (iii):
// `icons: []` → красный. К (iv): `[]` в sync-sweep.json → ждём exit 1, и тест
// красный, если скрипт пойдёт дальше.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const REPO = join(__dirname, '..', '..');
const PROOFS = readFileSync(join(REPO, 'scripts/audit-proofs.sh'), 'utf8').split('\n');
const SWEEP = readFileSync(join(REPO, 'scripts/sync-mutation-sweep.sh'), 'utf8');

/** Шапка скрипта: set -u, cd в корень, fail/fails и code_lines. */
function headerOf(lines: string[]): string {
  const end = lines.findIndex(l => l.startsWith('echo "### '));
  return lines.slice(0, end === -1 ? lines.length : end).join('\n');
}

/** Блок секции по заголовку — от её `echo "### x` до следующей секции или конца. */
function sectionOf(lines: string[], id: string): string {
  const start = lines.findIndex(l => l.includes(`### ${id}`));
  if (start === -1) throw new Error(`секция ${id} не найдена в audit-proofs.sh — гейт переехал, тест надо обновить`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]?.startsWith('echo "### ')) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

const FOOTER = '\nif [ "${#fails[@]}" -gt 0 ]; then exit 1; fi\nexit 0\n';

let sb = '';

beforeEach(() => {
  sb = mkdtempSync(join(tmpdir(), 'jw-s16-'));
  mkdirSync(join(sb, 'scripts'), { recursive: true });
  mkdirSync(join(sb, 'deploy/backup'), { recursive: true });
  mkdirSync(join(sb, 'public'), { recursive: true });
  mkdirSync(join(sb, 'src'), { recursive: true });
});

afterEach(() => {
  rmSync(sb, { recursive: true, force: true });
});

function writeProofsScript(id: string): string {
  const path = join(sb, 'scripts/proof.sh');
  writeFileSync(path, `${headerOf(PROOFS)}\n\n${sectionOf(PROOFS, id)}\n${FOOTER}`);
  return path;
}

function run(script: string): { rc: number, out: string } {
  try {
    const out = execFileSync('bash', [script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { rc: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { rc: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const GUARD = 'if [[ "$NAME" =~ ^justwriting-[0-9]{8}-[0-9]{6}\\.dump$ ]]; then\n  echo ok\nfi\n';

describe('S-16 (ii): audit-proofs 3.3 видит только незакомментированный guard', () => {
  it('живой guard — зелёно, hostile-имена отсеяны тем же regex', () => {
    writeFileSync(join(sb, 'deploy/backup/pull-backup.sh'), `#!/bin/bash\n${GUARD}`);
    const res = run(writeProofsScript('3.3'));
    expect(res.out).toContain('rejected by the guard regex');
    expect(res.rc, res.out).toBe(0);
  });

  it('тот же guard, закрытый комментарием, — провал, а не зелёный отчёт', () => {
    const commented = GUARD.split('\n').map(l => `# ${l}`).join('\n');
    writeFileSync(join(sb, 'deploy/backup/pull-backup.sh'), `#!/bin/bash\n${commented}\n`);
    const res = run(writeProofsScript('3.3'));
    expect(res.rc, 'закомментированный guard прошёл как живой').not.toBe(0);
    expect(res.out).toContain('guard regex not found');
  });
});

describe('S-16 (iii): audit-proofs 3.7 не зелёная при пустом списке файлов', () => {
  it('иконка и og на месте — зелёно', () => {
    mkdirSync(join(sb, 'public/icons'), { recursive: true });
    writeFileSync(join(sb, 'public/icons/a.svg'), '<svg/>');
    writeFileSync(join(sb, 'public/og-image.png'), 'x');
    writeFileSync(join(sb, 'public/manifest.json'), '{ "icons": [ { "src": "/icons/a.svg" } ] }');
    writeFileSync(join(sb, 'index.html'), '<meta property="og:image" content="/og-image.png">');
    const res = run(writeProofsScript('3.7'));
    // Иначе «зелено» может означать, что блок не выполнился вовсе.
    expect(res.out).toContain('OK /icons/a.svg');
    expect(res.out).toContain('OK /og-image.png (index.html)');
    expect(res.rc, res.out).toBe(0);
  });

  it('manifest без иконок — провал «no icons found»', () => {
    writeFileSync(join(sb, 'public/og-image.png'), 'x');
    writeFileSync(join(sb, 'index.html'), '<meta property="og:image" content="/og-image.png">');
    writeFileSync(join(sb, 'public/manifest.json'), '{ "icons": [] }');
    const res = run(writeProofsScript('3.7'));
    expect(res.rc, 'пустой список иконок зелёный').not.toBe(0);
    expect(res.out).toContain('no icons found');
  });

  it('иконка из manifest не лежит на диске — провал по конкретному пути', () => {
    writeFileSync(join(sb, 'public/og-image.png'), 'x');
    writeFileSync(join(sb, 'index.html'), '<meta property="og:image" content="/og-image.png">');
    writeFileSync(join(sb, 'public/manifest.json'), '{ "icons": [ { "src": "/icons/gone.svg" } ] }');
    const res = run(writeProofsScript('3.7'));
    expect(res.rc, 'несуществующая иконка зелёная').not.toBe(0);
    expect(res.out).toContain('/icons/gone.svg');
  });
});

describe('S-16 (iv): sync-mutation-sweep падает на пустом списке, а не «всё зелёно»', () => {
  function writeSweep(list: string): string {
    mkdirSync(join(sb, 'scripts/mutations'), { recursive: true });
    mkdirSync(join(sb, 'docs'), { recursive: true });
    writeFileSync(join(sb, 'scripts/mutations/sync-sweep.json'), list);
    const path = join(sb, 'scripts/sync-mutation-sweep.sh');
    writeFileSync(path, SWEEP);
    return path;
  }

  it('список мутаций пуст — exit 1 до базового прогона', () => {
    const res = run(writeSweep('[]'));
    expect(res.rc, 'пустой список мутаций не считается проверкой').not.toBe(0);
    expect(res.out).toContain('список мутаций пуст');
  });

  it('запись без массива tests — exit 1 с названием записи', () => {
    const res = run(writeSweep('[{"id":"ss-99","file":"src/x.ts","line":1,"description":"нет тестов"}]'));
    expect(res.rc).not.toBe(0);
    expect(res.out).toContain('ss-99');
  });
});
