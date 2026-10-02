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

type Sandbox = { dir: string; backupDir: string; bin: string };

/** systemctl-заглушка: list-units и show (момент падения юнита) читают файлы песочницы — их можно менять между запусками. */
function setSystemctl(sb: Sandbox, unitOutput: string, showOutput = ''): void {
  fs.writeFileSync(path.join(sb.dir, 'units.txt'), unitOutput + '\n');
  fs.writeFileSync(path.join(sb.dir, 'show.txt'), showOutput + '\n');
  fs.writeFileSync(
    path.join(sb.bin, 'systemctl'),
    [
      '#!/bin/bash',
      'case "$*" in',
      '  *list-units*)',
      `    cat "${path.join(sb.dir, 'units.txt')}"`,
      '    ;;',
      '  *show*)',
      `    cat "${path.join(sb.dir, 'show.txt')}"`,
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
}

function makeSandbox(unitOutput: string, showOutput = ''): Sandbox {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-healthcheck-'));
  sandboxes.push(dir);
  const backupDir = path.join(dir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const sb = { dir, backupDir, bin };
  setSystemctl(sb, unitOutput, showOutput);

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

/**
 * S-59: песочница, в которой ни одна проверка не находит проблем: заглушки df,
 * docker, curl и openssl отвечают «всё хорошо», свежая копия с .sha256 и
 * .counts на месте, а сайт подменяется в самом раннере (GREEN_SITE).
 */
function makeGreenSandbox(unitOutput = 'justwriting.service loaded active running Justwriting'): Sandbox {
  const sb = makeSandbox(unitOutput);
  const stub = (name: string, body: string) => fs.writeFileSync(path.join(sb.bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  stub('df', 'echo "Use% IUse%"; echo "50%  10%"');
  stub('curl', 'echo "200"');
  stub('openssl', 'echo "notAfter=Jan 01 00:00:00 2099 GMT"');
  stub('docker', 'case "$*" in *exec*) echo \'{"disable_signup": true}\' ;; *) echo \'{"Service":"db","State":"running","Health":"healthy"}\' ;; esac');
  const dump = path.join(sb.backupDir, 'justwriting-20261002-030000.dump');
  fs.writeFileSync(dump, 'dump');
  fs.writeFileSync(`${dump}.sha256`, 'sha');
  fs.writeFileSync(`${dump}.counts`, 'counts');
  return sb;
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

// S-44.3: боевой режим (без --dry-run) — с подменённым smtplib и путями
// состояния/окружения из песочницы; письмо видно по строке SMTP_SENT.
const RUNNER = [
  'import runpy, smtplib, sys',
  'class S:',
  '    def __init__(self, *a, **k): pass',
  '    def __enter__(self): return self',
  '    def __exit__(self, *a): return False',
  '    def login(self, *a): pass',
  "    def send_message(self, m): print('SMTP_SENT: ' + m['Subject'])",
  'smtplib.SMTP_SSL = S',
  // GREEN_SITE=1: сайт отвечает 200 оболочкой приложения без ассетов.
  'import os, io, urllib.request',
  'if os.environ.get("GREEN_SITE"):',
  '    class R(io.BytesIO):',
  '        status = 200',
  '        def __enter__(self): return self',
  '        def __exit__(self, *a): return False',
  '    urllib.request.urlopen = lambda req, timeout=15: R(b"<html data-app-version=\\"t\\"></html>")',
  'sys.argv = [sys.argv[1]]',
  "runpy.run_path(sys.argv[0], run_name='__main__')",
].join('\n');

function runAlerting(sb: Sandbox, statePath = path.join(sb.dir, 'state.json'), green = false): { status: number; stdout: string; stderr: string } {
  const envFile = path.join(sb.dir, 'supabase.env');
  fs.writeFileSync(envFile, 'SMTP_HOST=smtp.test\nSMTP_PORT=465\nSMTP_USER=u@test\nSMTP_PASS=x\n');
  const res = spawnSync('python3', ['-c', RUNNER, HEALTHCHECK], {
    env: {
      ...process.env,
      ...(green ? { GREEN_SITE: '1', MONITOR_COMPOSE_DIR: sb.dir } : {}),
      BACKUP_DIR: sb.backupDir,
      MONITOR_SITE: 'http://127.0.0.1:9',
      MONITOR_ALERT_TO: 'alerts@test',
      MONITOR_STATE: statePath,
      MONITOR_ENV_FILE: envFile,
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

  // S-45 (S-7): мутация «if True:» в проверке юнитов — здоровый список не
  // должен давать ни одного «Юниты в failed».
  it('S-45/S-7: a healthy unit list produces no failed-unit message', () => {
    const sb = makeSandbox('● justwriting.service loaded active running Justwriting\njustwriting-backup.service loaded inactive dead Justwriting backup');
    const res = runHealthcheck(sb);
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain('Юниты в failed');
  });

  it('S-44.3: «failed» in the DESCRIPTION column with ACTIVE=active is not a failed unit', () => {
    const sb = makeSandbox('justwriting-mail.service loaded active exited Retry failed mails');
    const res = runHealthcheck(sb);
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain('Юниты в failed');
  });

  it('S-44.3: an unreadable SHRINK-ALERT is reported, not swallowed (R5-054)', () => {
    const sb = makeSandbox('justwriting.service loaded active running Justwriting');
    // Каталог: exists() истинно, read_text() падает.
    fs.mkdirSync(path.join(sb.backupDir, 'SHRINK-ALERT'));
    const res = runHealthcheck(sb);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Не удалось прочитать отметку SHRINK-ALERT');
  });

  // S-59: ключ состояния — вид причины, не её текст с числами.
  it('S-59: a stale backup whose age grows by an hour is not mailed again', () => {
    const sb = makeSandbox('justwriting.service loaded active running Justwriting');
    const dump = path.join(sb.backupDir, 'justwriting-20261001-120000.dump');
    fs.writeFileSync(dump, 'dump');
    fs.writeFileSync(`${dump}.sha256`, 'sha');
    fs.writeFileSync(`${dump}.counts`, 'counts');
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
    fs.utimesSync(dump, hoursAgo(30), hoursAgo(30));

    const first = runAlerting(sb);
    expect(first.stdout).toContain('SMTP_SENT');
    expect(first.stdout).toContain('Свежей копии нет 30 часов');

    fs.utimesSync(dump, hoursAgo(31), hoursAgo(31));
    const second = runAlerting(sb);
    expect(second.status).toBe(0);
    expect(second.stdout, 'та же поломка с другим числом часов снова ушла письмом').not.toContain('SMTP_SENT');
  });

  it('S-59: a second consecutive failed drill (new ExecMainExitTimestamp) is mailed even without reset-failed', () => {
    const units = 'justwriting-restore-drill.service loaded failed failed Justwriting Restore Drill';
    const sb = makeSandbox(units, 'Wed 2026-09-02 03:00:00 UTC');
    expect(runAlerting(sb).stdout).toContain('SMTP_SENT');
    expect(runAlerting(sb).stdout).not.toContain('SMTP_SENT');

    setSystemctl(sb, units, 'Fri 2026-10-02 03:00:00 UTC');
    const again = runAlerting(sb);
    expect(again.stdout, 'новое падение того же юнита осталось без письма').toContain('SMTP_SENT');
  });

  it('S-59: when the state directory cannot be created the alert still goes out, and the state failure is mailed too', () => {
    const sb = makeSandbox('justwriting-restore-drill.service loaded failed failed Justwriting Restore Drill');
    const blocker = path.join(sb.dir, 'not-a-dir');
    fs.writeFileSync(blocker, 'file where a directory is needed');
    const res = runAlerting(sb, path.join(blocker, 'state.json'));
    expect(res.stdout).toContain('SMTP_SENT: justwriting: проверка сервера нашла проблему');
    expect(res.stdout).toContain('SMTP_SENT: justwriting: состояние проверки сервера не записалось');
    expect(res.status).toBe(1);
  });

  it('S-59 survivor: after a full recovery (no problems) the same problem mails again when it returns', () => {
    const broken = 'justwriting-restore-drill.service loaded failed failed Justwriting Restore Drill';
    const healthy = 'justwriting.service loaded active running Justwriting';
    const sb = makeGreenSandbox(broken);
    setSystemctl(sb, broken, 'Wed 2026-09-02 03:00:00 UTC');
    const state = path.join(sb.dir, 'state.json');

    const first = runAlerting(sb, state, true);
    expect(first.stdout).toContain('SMTP_SENT');
    expect(first.stdout).toContain('Юниты в failed');

    setSystemctl(sb, healthy);
    const recovered = runAlerting(sb, state, true);
    expect(recovered.status).toBe(0);
    expect(recovered.stdout).not.toContain('SMTP_SENT');
    expect((JSON.parse(fs.readFileSync(state, 'utf8')) as { key: string }).key, 'после починки состояние не очищено').toBe('');

    setSystemctl(sb, broken, 'Wed 2026-09-02 03:00:00 UTC');
    expect(runAlerting(sb, state, true).stdout, 'вернувшаяся поломка не дала письма').toContain('SMTP_SENT');
  });

  it('S-59: the green sandbox really is green (dry run finds nothing)', () => {
    const sb = makeGreenSandbox();
    const res = runAlerting(sb, path.join(sb.dir, 'state.json'), true);
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain('SMTP_SENT');
    expect((JSON.parse(fs.readFileSync(path.join(sb.dir, 'state.json'), 'utf8')) as { key: string }).key).toBe('');
  });

  it('S-59 survivor: a corrupt state file is not «the same key» — the problems are mailed', () => {
    const sb = makeSandbox('justwriting-restore-drill.service loaded failed failed Justwriting Restore Drill');
    fs.writeFileSync(path.join(sb.dir, 'state.json'), '{corrupt');
    const res = runAlerting(sb);
    expect(res.stdout).toContain('SMTP_SENT');
    expect(JSON.parse(fs.readFileSync(path.join(sb.dir, 'state.json'), 'utf8'))).toHaveProperty('key');
  });

  it('S-44.3: the same set of problems is mailed once, not again after the old 12 h window', () => {
    const sb = makeSandbox('justwriting-restore-drill.service loaded failed failed Justwriting Restore Drill');
    const first = runAlerting(sb);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('SMTP_SENT');

    const stateFile = path.join(sb.dir, 'state.json');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as { key: string; sent: number };
    fs.writeFileSync(stateFile, JSON.stringify({ ...state, sent: 0 }));
    const second = runAlerting(sb);
    expect(second.status).toBe(0);
    expect(second.stdout).not.toContain('SMTP_SENT');
  });
});
