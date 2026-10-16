import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// R7Q-033: у мобильного стенда API и заглушка ИИ поднимались фоном, но их PID'ы
// не попадали в scripts/stand/.pids — единственный файл, который читает down.sh.
// Если скрипт умирает не по trap'у (SIGKILL, закрытый терминал), на проде
// остаётся node, занимающий порт, и следующий подъём стенда падает на «порт
// занят» — а убивать придётся процесс, которого в журналах нет.

const root = process.cwd();
const CI_DIR = join(root, 'scripts/ci');

function shellScripts(): string[] {
  return readdirSync(CI_DIR).filter(f => f.endsWith('.sh')).map(f => join(CI_DIR, f));
}

/** Фоновые запуски (`… &`) и есть ли рядом регистрация PID'а в .pids. */
function unregisteredBackgroundLaunches(text: string): string[] {
  const lines = text.split('\n');
  const bad: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!/\s&\s*$/.test(line) || /^\s*(trap|echo|#)/.test(line)) continue;
    const next = lines.slice(i + 1, i + 4).join('\n');
    // либо литеральный путь, либо переменная, в которой он лежит
    if (!/(\.pids|PIDS_FILE)/.test(next)) bad.push(`${i + 1}: ${line.trim().slice(0, 60)}`);
  }
  return bad;
}

describe('R7Q-033: фоновые процессы стенда записаны в .pids', () => {
  it('ни один фоновый запуск в scripts/ci не остаётся без PID-записи', () => {
    const files = shellScripts();
    expect(files.length, 'скриптов ворот хотя бы два').toBeGreaterThan(1);
    const offenders = files.flatMap(f => unregisteredBackgroundLaunches(readFileSync(f, 'utf8'))
      .map(l => `${f.replace(root + '/', '')} → ${l}`));
    expect(offenders, `фоновые процессы не в .pids:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('проверка не холостая: убрал регистрацию — красная', () => {
    const text = readFileSync(join(CI_DIR, 'mobile-e2e.sh'), 'utf8');
    expect(unregisteredBackgroundLaunches(text)).toEqual([]);
    const stripped = text.replace(/^echo \$! >> scripts\/stand\/\.pids$/m, '');
    expect(unregisteredBackgroundLaunches(stripped).length).toBeGreaterThan(0);
  });
});
