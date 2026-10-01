import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const HEALTHCHECK = path.join(ROOT, 'deploy/monitor/healthcheck.py');

const sandboxes: string[] = [];
afterEach(() => {
  for (const dir of sandboxes.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeSandbox(unitOutput: string): { dir: string; backupDir: string; bin: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-healthcheck-'));
  sandboxes.push(dir);
  const backupDir = path.join(dir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });

  fs.writeFileSync(
    path.join(bin, 'systemctl'),
    [
      '#!/bin/bash',
      'case "$*" in',
      '  *list-units*)',
      `    cat <<'EOF'\n${unitOutput}\nEOF\n`,
      '    ;;',
      '  *is-active*)',
      '    echo "active"',
      '    ;;',
      '  *)',
      '    exit 0',
      '    ;;',
      'esac',
    ].join('\n'),
    { mode: 0o755 },
  );

  fs.writeFileSync(
    path.join(bin, 'curl'),
    '#!/bin/bash\necho "000"\n',
    { mode: 0o755 },
  );

  fs.writeFileSync(
    path.join(bin, 'docker'),
    '#!/bin/bash\nexit 0\n',
    { mode: 0o755 },
  );

  return { dir, backupDir, bin };
}

function runHealthcheck(sb: { backupDir: string; bin: string }): { status: number; stdout: string; stderr: string } {
  const res = spawnSync('python3', [HEALTHCHECK, '--dry-run'], {
    env: {
      ...process.env,
      BACKUP_DIR: sb.backupDir,
      MONITOR_SITE: 'http://127.0.0.1:9',
      PATH: `${sb.bin}:${process.env.PATH ?? ''}`,
    },
    encoding: 'utf8',
  });
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

describe('deploy/monitor/healthcheck.py (S-7)', () => {
  it('detects failed systemd unit from systemctl list-units', () => {
    const sb = makeSandbox('justwriting-restore-drill.service loaded failed failed Justwriting Restore Drill');
    const res = runHealthcheck(sb);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('justwriting-restore-drill.service');
    expect(res.stdout).toContain('Юниты в failed:');
  });

  it('detects empty systemctl list-units output as a problem', () => {
    const sb = makeSandbox('');
    const res = runHealthcheck(sb);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('systemctl list-units пуст');
  });

  it('detects newest dump without .counts as disarmed shrink check', () => {
    const sb = makeSandbox('justwriting.service loaded active running Justwriting');
    const dumpFile = path.join(sb.backupDir, 'justwriting-20261001-120000.dump');
    fs.writeFileSync(dumpFile, 'fake dump content');
    fs.writeFileSync(`${dumpFile}.sha256`, 'fake sha');
    // Note: dumpFile.counts is NOT created!

    const res = runHealthcheck(sb);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('проверка обвала выключена');
  });
});
