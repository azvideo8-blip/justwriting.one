// K-5/N-93: pull-backup.sh с фейковым ssh. Обрыв посреди передачи раньше
// оставлял частичный .dump в ~/Backups как «свежую копию»; пустой каталог на
// сервере ронял скрипт до своего сообщения; состав дампа никто не проверял.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'deploy/backup/pull-backup.sh');
const PG_BACKUP = path.join(ROOT, 'deploy/backup/pg-backup.sh');

const DUMP_CONTENT = 'justwriting fake dump for tests — TABLE DATA public documents\n';
const DUMP_SHA = crypto.createHash('sha256').update(DUMP_CONTENT).digest('hex');
const DUMP_NAME = 'justwriting-20260930-000000.dump';

const FULL_TOC = [
  '; <oid>; <oid> TABLE DATA auth users postgres',
  '; <oid>; <oid> TABLE DATA public users postgres',
  '; <oid>; <oid> TABLE DATA public documents postgres',
  '; <oid>; <oid> TABLE DATA public versions postgres',
  '; <oid>; <oid> TABLE DATA public local_store_records postgres',
].join('\n');

const sandboxes: string[] = [];

function makeSandbox(fakeSshBody: string): { dir: string; dest: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-pullbackup-'));
  sandboxes.push(dir);
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(dir, 'Backups/justwriting'), { recursive: true });

  fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/bash\n${fakeSshBody}\n`, { mode: 0o755 });
  return { dir, dest: path.join(dir, 'Backups/justwriting') };
}

function fakePgRestoreInto(dir: string, toc: string): void {
  const bin = path.join(dir, 'bin');
  fs.writeFileSync(
    path.join(bin, 'pg_restore'),
    `#!/bin/bash\ncat <<'TOCEOF'\n${toc}\nTOCEOF\n`,
    { mode: 0o755 },
  );
}

function runPullBackup(dir: string): { status: number; stderr: string } {
  const res = spawnSync('bash', [SCRIPT], {
    env: {
      ...process.env,
      HOME: dir,
      PATH: `${path.join(dir, 'bin')}:${process.env.PATH ?? ''}`,
    },
    encoding: 'utf8',
  });
  return { status: res.status ?? -1, stderr: res.stderr };
}

afterEach(() => {
  for (const dir of sandboxes.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('K-5/N-93: pull-backup.sh против обрыва и неполного дампа', () => {
  it('обрыв ssh посреди передачи не оставляет частичный .dump', () => {
    const { dir, dest } = makeSandbox(`
if [[ "$*" == *pg-backup.sh* ]]; then exit 0; fi
if [[ "$*" == *"ls -1t"* ]]; then echo "${DUMP_NAME}"; exit 0; fi
if [[ "$*" == *".dump.sha256"* ]]; then echo "${DUMP_SHA}  ${DUMP_NAME}"; exit 0; fi
if [[ "$*" == *".dump"* ]]; then
  head -c 4096 /dev/zero
  echo "fake ssh dies mid-stream" >&2
  exit 255
fi
exit 0
`);
    const res = runPullBackup(dir);

    expect(res.status).not.toBe(0);
    const leftovers = fs.readdirSync(dest).filter(f => f.endsWith('.dump'));
    expect(leftovers, `остались частичные копии: ${leftovers.join(', ')}`).toEqual([]);
  });

  it('пустой каталог на сервере доходит до своего сообщения', () => {
    const { dir } = makeSandbox(`
if [[ "$*" == *"ls -1t"* ]]; then exit 0; fi
exit 0
`);
    const res = runPullBackup(dir);

    expect(res.status).toBe(1);
    expect(res.stderr).toContain('на сервере нет ни одной копии');
  });

  it('копия без TABLE DATA public documents удаляется, успеха не объявлено', () => {
    const { dir, dest } = makeSandbox(`
if [[ "$*" == *pg-backup.sh* ]]; then exit 0; fi
if [[ "$*" == *"ls -1t"* ]]; then echo "${DUMP_NAME}"; exit 0; fi
if [[ "$*" == *".dump.sha256"* ]]; then echo "${DUMP_SHA}  ${DUMP_NAME}"; exit 0; fi
if [[ "$*" == *".dump"* ]]; then printf '%s' '${DUMP_CONTENT}'; exit 0; fi
exit 0
`);
    fakePgRestoreInto(dir, FULL_TOC.replace('TABLE DATA public documents', 'TABLE DATA public nothing'));
    const res = runPullBackup(dir);

    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('копия неполная');
    expect(fs.readdirSync(dest).filter(f => f.endsWith('.dump'))).toEqual([]);
  });

  it('цельная копия остаётся и получает sidecar', () => {
    const { dir, dest } = makeSandbox(`
if [[ "$*" == *pg-backup.sh* ]]; then exit 0; fi
if [[ "$*" == *"ls -1t"* ]]; then echo "${DUMP_NAME}"; exit 0; fi
if [[ "$*" == *".dump.sha256"* ]]; then echo "${DUMP_SHA}  ${DUMP_NAME}"; exit 0; fi
if [[ "$*" == *".dump"* ]]; then printf '%s' '${DUMP_CONTENT}'; exit 0; fi
exit 0
`);
    fakePgRestoreInto(dir, FULL_TOC);
    const res = runPullBackup(dir);

    expect(res.status).toBe(0);
    expect(fs.existsSync(path.join(dest, DUMP_NAME))).toBe(true);
    expect(fs.existsSync(path.join(dest, `${DUMP_NAME}.sha256`))).toBe(true);
  });
});

describe('K-5/N-92: pg-backup.sh --check-toc', () => {
  const runCheckToc = (toc: string): { status: number; stderr: string } => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-pgbackuptoc-'));
    sandboxes.push(dir);
    const tocFile = path.join(dir, 'toc.txt');
    fs.writeFileSync(tocFile, toc);
    const res = spawnSync('bash', [PG_BACKUP, '--check-toc', tocFile], { encoding: 'utf8' });
    return { status: res.status ?? -1, stderr: res.stderr };
  };

  it('оглавление со всеми обязательными таблицами проходит', () => {
    const res = runCheckToc(FULL_TOC);
    expect(res.status).toBe(0);
  });

  it('оглавление без auth.users краснеет и называет таблицу', () => {
    const res = runCheckToc(FULL_TOC.replace('TABLE DATA auth users', 'TABLE DATA auth nothing'));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('auth users');
  });

  it('оглавление без public.local_store_records краснеет', () => {
    const res = runCheckToc(FULL_TOC.replace('TABLE DATA public local_store_records', 'TABLE DATA public nothing'));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('local_store_records');
  });
});
