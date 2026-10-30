import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Здравоохранитель харнесса: на Windows `:` в PATH не разделяет пути —
// заглушки не находятся и тесты «падают средой». `path.delimiter` даёт
// `:` на Linux (как раньше) и `;` на Windows; PYTHONUTF8 чинит cp1251-вывод
// питона, чтобы кириллица в stdout сравнивалась честно.

// Харнесс POSIX-only: заглушки — bash-скрипты, healthcheck зовёт их через
// `shell=True` (bash-пайпы `df | tail`). На Windows это физически не исполнить —
// там файл честно пропускается, а не краснеет 26 «средовыми» падениями.
// Решающий прогон — CI (Linux), там все проверки идут.
const POSIX_ONLY = process.platform !== 'linux' && process.platform !== 'darwin';

const ROOT = path.resolve(__dirname, '../..');
const HEALTHCHECK = path.join(ROOT, 'deploy/monitor/healthcheck.py');

const sandboxes: string[] = [];
afterEach(() => {
  for (const dir of sandboxes.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

type Sandbox = { dir: string; backupDir: string; bin: string; offsiteStamp: string; alertEnv: string };

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
  const offsiteStamp = path.join(dir, 'offsite.stamp');
  fs.writeFileSync(offsiteStamp, '');
  const alertEnv = path.join(dir, 'monitor.env');
  fs.writeFileSync(alertEnv, '');
  const sb = { dir, backupDir, bin, offsiteStamp, alertEnv };
  setSystemctl(sb, unitOutput, showOutput);
  // Песочница не читает журнал машины: без заглушки на macOS journalctl нет,
  // а на Linux-раннере (он же прод) попадал журнал самого сервера.
  fs.writeFileSync(path.join(bin, 'journalctl'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });

  fs.writeFileSync(
    path.join(bin, 'curl'),
    '#!/bin/bash\necho "000"\n',
    { mode: 0o755 },
  );

  fs.writeFileSync(
    path.join(bin, 'docker'),
    '#!/bin/bash\ncase "$*" in *ai_global_daily*) echo "10|20" ;; *) exit 0 ;; esac\n',
    { mode: 0o755 },
  );

  return sb;
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
  stub('docker', 'case "$*" in *ai_global_daily*) echo "10|20" ;; *exec*) echo \'{"disable_signup": true}\' ;; *) echo \'{"Service":"db","State":"running","Health":"healthy"}\' ;; esac');
  const dump = path.join(sb.backupDir, 'justwriting-20261002-030000.dump');
  fs.writeFileSync(dump, 'dump');
  fs.writeFileSync(`${dump}.sha256`, 'sha');
  fs.writeFileSync(`${dump}.counts`, 'counts');
  return sb;
}

function runHealthcheck(sb: Sandbox): { status: number; stdout: string; stderr: string } {
  const res = spawnSync('python3', [HEALTHCHECK, '--dry-run'], {
    env: {
      ...process.env,
      BACKUP_DIR: sb.backupDir,
      OFFSITE_STAMP: sb.offsiteStamp,
      MONITOR_ALERT_ENV: sb.alertEnv,
      // Каталог compose — песочница: /opt/justwriting/supabase есть только на
      // Linux-раннере (он же прод), и на Mac `cd` падал до заглушки docker.
      MONITOR_COMPOSE_DIR: sb.dir,
      MONITOR_SITE: 'http://127.0.0.1:9',
      PATH: `${sb.bin}${path.delimiter}${process.env.PATH ?? ''}`,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
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
  // GREEN_SITE=1: сайт отвечает 200 оболочкой приложения; GREEN_SITE_HTML
  // подменяет оболочку, MISSING_ASSETS (пути через запятую) отвечают 404 (S-63).
  'import os, io, urllib.request, urllib.error',
  'if os.environ.get("TELEGRAM_CAPTURE"):',
  '    _real_open = urllib.request.urlopen',
  '    def _tg_open(req, timeout=15):',
  "        if '/bot' in req.full_url:",
  "            print('TG_SENT: ' + (req.data.decode() if req.data else ''))",
  '            class R:',
  '                status = 200',
  '                def read(self): return os.environ.get("TELEGRAM_CAPTURE_REPLY", \'{"ok":true}\').encode()',
  '                def __enter__(self): return self',
  '                def __exit__(self, *a): return False',
  '            return R()',
  '        return _real_open(req, timeout=timeout)',
  '    urllib.request.urlopen = _tg_open',
  'if os.environ.get("GREEN_SITE"):',
  '    class R(io.BytesIO):',
  '        status = 200',
  '        def __enter__(self): return self',
  '        def __exit__(self, *a): return False',
  '    _html = os.environ.get("GREEN_SITE_HTML", "<html data-app-version=\\"t\\"></html>").encode()',
  '    _missing = set(filter(None, os.environ.get("MISSING_ASSETS", "").split(",")))',
  '    def _open(req, timeout=15):',
  '        path = "/" + req.full_url.split("//", 1)[-1].split("/", 1)[-1]',
  '        if path in _missing: raise urllib.error.HTTPError(req.full_url, 404, "nf", None, None)',
  '        return R(_html)',
  '    urllib.request.urlopen = _open',
  'sys.argv = [sys.argv[1]]',
  "runpy.run_path(sys.argv[0], run_name='__main__')",
].join('\n');

function runAlerting(sb: Sandbox, statePath = path.join(sb.dir, 'state.json'), green = false, extraEnv: Record<string, string> = {}): { status: number; stdout: string; stderr: string } {
  const envFile = path.join(sb.dir, 'supabase.env');
  fs.writeFileSync(envFile, 'SMTP_HOST=smtp.test\nSMTP_PORT=465\nSMTP_USER=u@test\nSMTP_PASS=x\n');
  const res = spawnSync('python3', ['-c', RUNNER, HEALTHCHECK], {
    env: {
      ...process.env,
      // «Сейчас» для сводки E-9 — 15:00 по UTC+5, не 09:00: без этого прогон
      // с 09:00 до 10:00 по часам машины слал письмо «сводка не ушла», и тесты
      // писем краснели по времени суток (полный прогон 29.10 в 10:00).
      MONITOR_NOW: String(Date.UTC(2026, 9, 21, 10, 0, 0) / 1000),
      ...(green ? { GREEN_SITE: '1', MONITOR_COMPOSE_DIR: sb.dir } : {}),
      ...extraEnv,
      BACKUP_DIR: sb.backupDir,
      OFFSITE_STAMP: sb.offsiteStamp,
      MONITOR_SITE: 'http://127.0.0.1:9',
      MONITOR_ALERT_TO: 'alerts@test',
      MONITOR_STATE: statePath,
      MONITOR_ENV_FILE: envFile,
      PATH: `${sb.bin}${path.delimiter}${process.env.PATH ?? ''}`,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    },
    encoding: 'utf8',
  });
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

describe.skipIf(POSIX_ONLY)('deploy/monitor/healthcheck.py (S-7)', () => {
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

  // S-63: ключ без имён молчал о втором контейнере: A упал → письмо; A поднялся,
  // B упал → тот же ключ, письма нет.
  it('S-63: a different container going down is a new key — mailed', () => {
    const sb = makeGreenSandbox();
    const setContainers = (rows: string[]) => fs.writeFileSync(path.join(sb.dir, 'ps.txt'), rows.join('\n') + '\n');
    fs.writeFileSync(path.join(sb.bin, 'docker'), `#!/bin/bash\ncase "$*" in *exec*) echo '{"disable_signup": true}' ;; *) cat "${path.join(sb.dir, 'ps.txt')}" ;; esac\n`, { mode: 0o755 });
    const state = path.join(sb.dir, 'state.json');
    const row = (service: string, state: string) => JSON.stringify({ Service: service, State: state, Health: '' });

    setContainers([row('db', 'exited'), row('auth', 'running')]);
    expect(runAlerting(sb, state, true).stdout).toContain('SMTP_SENT');

    setContainers([row('db', 'running'), row('auth', 'exited')]);
    const second = runAlerting(sb, state, true);
    expect(second.stdout, 'упал другой контейнер — письма нет').toContain('SMTP_SENT');
    expect(second.stdout).toContain('auth (exited)');
  });

  it('S-63: a different missing asset is a new key — mailed', () => {
    const sb = makeGreenSandbox();
    const state = path.join(sb.dir, 'state.json');
    const html = '<html data-app-version="t"><script src="/assets/a.js"></script><link href="/assets/b.css"></html>';

    expect(runAlerting(sb, state, true, { GREEN_SITE_HTML: html, MISSING_ASSETS: '/assets/a.js' }).stdout).toContain('SMTP_SENT');
    const second = runAlerting(sb, state, true, { GREEN_SITE_HTML: html, MISSING_ASSETS: '/assets/b.css' });
    expect(second.stdout, 'пропал другой ассет — письма нет').toContain('SMTP_SENT');
    expect(second.stdout).toContain('/assets/b.css');
  });

  it('S-63 survivor: a valid non-dict state file (`[]`) is not the same key and does not crash the run', () => {
    const sb = makeSandbox('justwriting-restore-drill.service loaded failed failed Justwriting Restore Drill');
    fs.writeFileSync(path.join(sb.dir, 'state.json'), '[]');
    const res = runAlerting(sb);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain('SMTP_SENT');
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

describe.skipIf(POSIX_ONLY)('C-1: суточный кап ИИ', () => {
  function setAiUsage(sb: Sandbox, output: string, thresholds = '') {
    fs.writeFileSync(sb.alertEnv, thresholds);
    fs.writeFileSync(
      path.join(sb.bin, 'docker'),
      `#!/bin/bash
case "$*" in *ai_global_daily*) ${output ? `echo "${output}"` : 'exit 1'} ;; *exec*) echo '{"disable_signup": true}' ;; *) echo '{"Service":"db","State":"running","Health":"healthy"}' ;; esac
`,
      { mode: 0o755 },
    );
  }

  it('ниже порога — тихо', () => {
    const sb = makeGreenSandbox();
    setAiUsage(sb, '10|20', 'AI_ALERT_CALLS=100\nAI_ALERT_TOKENS=1000\n');
    const res = runHealthcheck(sb);
    expect(res.stdout).not.toContain('Суточный кап ИИ близко');
  });

  it('порог достигнут — ai_quota_near с числами', () => {
    const sb = makeGreenSandbox();
    setAiUsage(sb, '7|20', 'AI_ALERT_CALLS=5\nAI_ALERT_TOKENS=1000\n');
    const res = runHealthcheck(sb);
    expect(res.stdout).toContain('Суточный кап ИИ близко: запросов 7 из 5');
  });

  it('сбой запроса — «измеритель», а не «всё хорошо»', () => {
    const sb = makeGreenSandbox();
    setAiUsage(sb, '');
    const res = runHealthcheck(sb);
    expect(res.stdout).toContain('Не удалось измерить суточный расход ИИ');
  });
});

describe.skipIf(POSIX_ONLY)('E-8: сплошные 5xx API', () => {
  function setJournal(sb: Sandbox, lines: string[], fail = false) {
    const body = fail
      ? '#!/bin/bash\nexit 1\n'
      : `#!/bin/bash\n${lines.map(l => `echo "${l}"`).join('\n')}\nexit 0\n`;
    fs.writeFileSync(path.join(sb.bin, 'journalctl'), body, { mode: 0o755 });
  }

  it('ниже порога — тихо', () => {
    const sb = makeGreenSandbox();
    setJournal(sb, ['[api/handlers] 500 internal in summarizeDocument: x']);
    const res = runHealthcheck(sb);
    expect(res.stdout).not.toContain('Ошибки API за час');
  });

  it('порог — счётчики по меткам, текста строк в выводе нет', () => {
    const sb = makeGreenSandbox();
    setJournal(sb, [
      ...Array.from({ length: 5 }, () => '[api/handlers] 502 internal in chat: MARKER_E8_TEXT'),
      'uncaughtException MARKER_E8_TEXT',
    ]);
    const res = runHealthcheck(sb);
    expect(res.stdout).toContain('handlers5xx=5');
    expect(res.stdout).toContain('uncaught=1');
    expect(res.stdout).not.toContain('MARKER_E8_TEXT');
  });

  // DY10-2: ветка «хода мысли» отвечает 502/504 через sendError — метка [api-5xx].
  // Мутация: не считать [api-5xx] → красный.
  it('[api-5xx] из sendError считается пятисоткой', () => {
    const sb = makeGreenSandbox();
    setJournal(sb, Array.from({ length: 5 }, () => '[api-5xx] 502 UPSTREAM_ERROR'));
    const res = runHealthcheck(sb);
    expect(res.stdout).toContain('handlers5xx=5');
  });

  // Ревью 0.11.2: отказ поставщика до ответа пишет свою строку и [api-5xx] 502 —
  // это одна ошибка, не две. Мутация: считать и «provider failed» → красный.
  it('отказ поставщика до ответа считается один раз', () => {
    const sb = makeGreenSandbox();
    setJournal(sb, Array.from({ length: 4 }, () => [
      '[api/chat] provider failed before response started: name=Error',
      '[api-5xx] 502 UPSTREAM_ERROR',
    ]).flat());
    const res = runHealthcheck(sb);
    expect(res.stdout).not.toContain('Ошибки API за час');
  });

  // Ревью: самый общий путь 500 пишет «unhandled error» без кода.
  // Мутация: считать только '[api/handlers] 5' → красный.
  it('«unhandled error» тоже считается пятисоткой', () => {
    const sb = makeGreenSandbox();
    setJournal(sb, Array.from({ length: 5 }, () => '[api/handlers] unhandled error in chat: MARKER_E8_TEXT'));
    const res = runHealthcheck(sb);
    expect(res.stdout).toContain('handlers5xx=5');
    expect(res.stdout).not.toContain('MARKER_E8_TEXT');
  });

  it('журнал не читается — тревога «измеритель», не тишина', () => {
    const sb = makeGreenSandbox();
    setJournal(sb, [], true);
    const res = runHealthcheck(sb);
    expect(res.stdout).toContain('Не удалось прочитать журнал');
  });
});

// TELEGRAM_CAPTURE: питон печатает TG_SENT в stdout — без живого HTTP-сервера
// в воркере (spawnSync блокирует цикл событий, сервер не отвечал на Linux CI).
describe.skipIf(POSIX_ONLY)('E-9: ежедневная сводка в Telegram', () => {
  it('в 09:00 МСК одна сводка, повтор в тот же день не дублирует, сбой части проверок отмечен', () => {
    const sb = makeSandbox('justwriting.service loaded active running Justwriting');
    const daily = path.join(sb.dir, 'daily-summary.json');
    const env = {
      MONITOR_NOW: String(Date.UTC(2026, 9, 21, 4, 0, 0) / 1000), // 09:00 по UTC+5 (время владельца)
      MONITOR_DAILY_STATE: daily,
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_CHAT_ID: 'test-chat',
      TELEGRAM_CAPTURE: '1',
    };
    const first = runAlerting(sb, path.join(sb.dir, 'state.json'), false, env);
    const second = runAlerting(sb, path.join(sb.dir, 'state.json'), false, env);

    const sent = (first.stdout + '\n' + second.stdout).split('\n').filter(l => l.startsWith('TG_SENT:'));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('сводка за сутки');
    expect(sent[0]).toContain('Проверка неполная');
    expect(sent[0]).toContain('[client-error] за 24 ч');
    expect(fs.existsSync(daily)).toBe(true);
  });

  // Telegram отвечает 200 и с ok:false (бот выкинут из чата) — это не доставка:
  // сводка не помечается отправленной, о сбое уходит письмо.
  it('ok:false в ответе — не доставка: письмо о сбое, отметки дня нет', () => {
    const sb = makeSandbox('justwriting.service loaded active running Justwriting');
    const daily = path.join(sb.dir, 'daily-summary.json');
    const res = runAlerting(sb, path.join(sb.dir, 'state.json'), false, {
      MONITOR_NOW: String(Date.UTC(2026, 9, 21, 4, 0, 0) / 1000),
      MONITOR_DAILY_STATE: daily,
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_CHAT_ID: 'test-chat',
      TELEGRAM_CAPTURE: '1',
      TELEGRAM_CAPTURE_REPLY: '{"ok":false,"description":"Forbidden: bot was kicked"}',
    });
    expect(res.stderr).toContain('СВОДКА НЕ УШЛА');
    expect(res.stdout).toContain('SMTP_SENT: justwriting: ежедневная сводка не ушла');
    expect(fs.existsSync(daily)).toBe(false);
  });
});
