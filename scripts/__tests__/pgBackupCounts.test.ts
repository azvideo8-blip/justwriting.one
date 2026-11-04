// R5-056: pg-backup.sh с фейковым docker. «Дамп читается» не значит «в дампе
// есть данные»: обвал строк ключевых таблиц должен красить службу, ставить
// отметку для монитора и останавливать ротацию, чтобы 14 ночей не вытеснили
// последние копии «до удаления».
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const PG_BACKUP = path.join(ROOT, 'deploy/backup/pg-backup.sh');

const FULL_TOC = ['auth users', 'public users', 'public documents', 'public versions', 'public local_store_records']
  .map((t) => `; <oid>; <oid> TABLE DATA ${t} postgres`)
  .join('\n');

const sandboxes: string[] = [];
afterEach(() => {
  for (const dir of sandboxes.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// Копия скрипта с каталогом копий внутри песочницы; docker подменён.
function makeSandbox(): { dir: string; dest: string; script: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-pgbackup-'));
  sandboxes.push(dir);
  const dest = path.join(dir, 'backups');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const script = path.join(dir, 'pg-backup.sh');
  const src = fs.readFileSync(PG_BACKUP, 'utf8');
  expect(src).toContain('DEST=/var/backups/justwriting\n');
  // Шаг копии вне сервера тоже в песочницу: на VPS, где живёт раннер, файл
  // получателя настоящий, и скрипт полез бы в настоящий каталог (0.11.6).
  const patched = src
    .replace('DEST=/var/backups/justwriting\n', `DEST=${dest}\n`)
    .replace('OFFSITE=/var/backups/justwriting-offsite\n', `OFFSITE=${path.join(dir, 'offsite')}\n`)
    .replace('RECIPIENT=/opt/justwriting/backup/age-recipient.txt\n', `RECIPIENT=${path.join(dir, 'no-recipient')}\n`);
  expect(patched).not.toMatch(/\/var\/backups|\/opt\/justwriting/);
  fs.writeFileSync(script, patched);
  fs.writeFileSync(
    path.join(bin, 'docker'),
    [
      '#!/bin/bash',
      'case "$*" in',
      '  *psql*) echo "$FAKE_COUNTS" ;;',
      '  *pg_dump*) echo "fake dump $FAKE_COUNTS" ;;',
      `  *pg_restore*) cat <<'TOCEOF'\n${FULL_TOC}\nTOCEOF\n ;;`,
      'esac',
    ].join('\n'),
    { mode: 0o755 },
  );
  return { dir, dest, script };
}

function run(sb: { dir: string; script: string }, counts: string) {
  const res = spawnSync('bash', [sb.script], {
    env: { ...process.env, FAKE_COUNTS: counts, PATH: `${path.join(sb.dir, 'bin')}:${process.env.PATH ?? ''}` },
    encoding: 'utf8',
  });
  return { status: res.status ?? -1, stderr: res.stderr };
}

// Разные секунды в имени: скрипт штампует копию по времени.
function seedOldDumps(dest: string, n: number, counts: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (let i = 0; i < n; i++) {
    const f = path.join(dest, `justwriting-20260901-0000${String(i).padStart(2, '0')}.dump`);
    fs.writeFileSync(f, 'old');
    fs.writeFileSync(`${f}.sha256`, 'x');
    fs.writeFileSync(`${f}.counts`, `${counts}\n`);
    const t = new Date(2026, 8, 1, 0, 0, i);
    for (const p of [f, `${f}.sha256`, `${f}.counts`]) fs.utimesSync(p, t, t);
  }
}

const dumps = (dest: string) => fs.readdirSync(dest).filter((f) => f.endsWith('.dump'));

describe('pg-backup.sh: сверка строк с прошлой копией (R5-056)', () => {
  it('--check-counts: рост и мелкие таблицы проходят, обвал вдвое — нет', () => {
    const chk = (a: string, b: string) => spawnSync('bash', [PG_BACKUP, '--check-counts', a, b]).status;
    expect(chk('8 8 207 232 1377', '8 8 210 240 1400')).toBe(0);
    expect(chk('8 8 207 232 1377', '3 3 207 232 1377')).toBe(0); // <10 строк — не сравниваем
    expect(chk('8 8 207 232 1377', '8 8 100 232 1377')).toBe(1);
    expect(chk('8 8 207 232 1377', '8 8 0 0 0')).toBe(1);
    expect(chk('8 8 207 232 1377', 'ERROR')).toBe(1);
  });

  it('здоровая ночь: копия + .counts, ротация до 14, отметки нет', () => {
    const sb = makeSandbox();
    seedOldDumps(sb.dest, 14, '8 8 207 232 1377');
    const res = run(sb, '8 8 210 240 1400');
    expect(res.status, res.stderr).toBe(0);
    expect(dumps(sb.dest)).toHaveLength(14);
    expect(fs.existsSync(path.join(sb.dest, 'SHRINK-ALERT'))).toBe(false);
  });

  it('обвал: копия сохранена, служба красная, отметка есть, ротация стоит', () => {
    const sb = makeSandbox();
    seedOldDumps(sb.dest, 14, '8 8 207 232 1377');
    const res = run(sb, '8 8 0 0 0');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('ОБВАЛ');
    expect(dumps(sb.dest)).toHaveLength(15);
    expect(fs.readFileSync(path.join(sb.dest, 'SHRINK-ALERT'), 'utf8')).toContain('ОБВАЛ');
  });

  it('сбой подсчёта не отменяет копию и не ставит отметку', () => {
    const sb = makeSandbox();
    seedOldDumps(sb.dest, 2, '8 8 207 232 1377');
    const res = run(sb, 'psql: error');
    expect(res.status, res.stderr).toBe(0);
    expect(res.stderr).toContain('ПРЕДУПРЕЖДЕНИЕ');
    expect(dumps(sb.dest)).toHaveLength(3);
    expect(fs.existsSync(path.join(sb.dest, 'SHRINK-ALERT'))).toBe(false);
  });
});
