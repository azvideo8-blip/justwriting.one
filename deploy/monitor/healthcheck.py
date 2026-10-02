#!/usr/bin/env python3
# Почасовая проверка сервера justwriting.
#
# Проверяет то, что видно изнутри: место, контейнеры, службу, свежесть резервной
# копии, срок сертификата. Того, что сервер вообще жив, отсюда не проверить —
# для этого есть задание на ноутбуке.
#
# Письмо уходит только при отклонении и один раз на смену набора причин
# (S-44.3): молчание должно значить «всё хорошо», а поток одинаковых писем
# приводит к тому, что их перестают читать. Упавший oneshot (месячный drill)
# остаётся в failed до `systemctl reset-failed` — см. deploy/backup/RESTORE.md.
# S-63: ключ без имён (disk_high, cert_expiring…) не эскалирует: диск 80 → 99 %
# и сертификат 19 → 1 день — одно письмо. Причины с именами (юниты, контейнеры,
# ассеты) несут имена в ключе — смена состава даёт новое письмо.
#
# R5-054: сбой измерителя — тоже проблема. Проверка, которая ничего не
# измерила, не имеет права промолчать.
#
# Ключи (запуск вручную от root):
#   --dry-run     проверить и напечатать найденное; ничего не слать и не писать.
#   --test-alert  отправить одно проверочное письмо тем же путём, что и тревогу
#                 (R5-050: канал ни разу не исполнялся) — и выйти.
import json, os, re, smtplib, ssl, subprocess, sys, time, urllib.error, urllib.request
from email.message import EmailMessage
from pathlib import Path

# Пути переопределяются из окружения только ради тестов (scripts/__tests__/healthcheckMonitor.test.ts).
STATE = Path(os.environ.get('MONITOR_STATE', '/var/lib/justwriting-monitor/state.json'))
ENV_FILE = Path(os.environ.get('MONITOR_ENV_FILE', '/opt/justwriting/supabase/.env'))
SITE = os.environ.get('MONITOR_SITE', 'https://justwriting.ru')
COMPOSE_DIR = os.environ.get('MONITOR_COMPOSE_DIR', '/opt/justwriting/supabase')
DRY = '--dry-run' in sys.argv
# EA-2: адрес получателя — из окружения (EnvironmentFile в unit), не из репозитория.
TO = os.environ.get('MONITOR_ALERT_TO', '')
if not TO and not DRY:
    print('MONITOR_ALERT_TO не задан — некому слать тревоги', file=sys.stderr)
    sys.exit(2)

def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.strip()

def send(subject, body):
    # R5-050: письмо, которое не ушло, не должно выглядеть как «всё хорошо».
    # Причина — в журнал (без пароля: печатается только тип и текст ошибки),
    # служба — в failed, состояние не пишется, через час будет новая попытка.
    try:
        env = dict(re.findall(r'^(\w+)=(.*)$', ENV_FILE.read_text(), re.M))
        msg = EmailMessage()
        msg['Subject'] = subject
        msg['From'] = env['SMTP_USER']
        msg['To'] = TO
        msg.set_content(body)
        with smtplib.SMTP_SSL(env['SMTP_HOST'], int(env['SMTP_PORT']), timeout=30, context=ssl.create_default_context()) as s:
            s.login(env['SMTP_USER'], env['SMTP_PASS'])
            s.send_message(msg)
    except Exception as e:
        print(f'ПИСЬМО НЕ УШЛО: {type(e).__name__}: {e}', file=sys.stderr)
        sys.exit(1)

if '--test-alert' in sys.argv:
    send('justwriting: проверка канала тревог',
         'Это проверочное письмо почасовой проверки сервера, не авария.\n'
         'Раз оно дошло, тревоги тоже дойдут.\n')
    print('отправлено проверочное письмо')
    sys.exit(0)

def http(url, method='GET', timeout=15):
    # (код, тело); код — строка, как у curl: '000' — ответа не было вовсе.
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method=method), timeout=timeout) as r:
            return str(r.status), r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return str(e.code), ''
    except Exception:
        return '000', ''

# S-59: причина — пара (вид, текст). Ключ состояния считается по видам, а не
# по тексту: в тексте числа (часы копии, дни сертификата, проценты диска), и
# та же поломка каждый час выглядела новой.
problems = []

def problem(kind, text):
    problems.append((kind, text))

# ── место на диске: байты и inode (R5-061) ─────────────────────────────────
pct = re.findall(r'(\d+)%', sh('df --output=pcent,ipcent / | tail -1'))
if len(pct) != 2:
    problem('disk_df', 'Не удалось измерить место на диске: df не ответил.')
else:
    used, iused = map(int, pct)
    if used >= 80:
        problem('disk_high', f'Диск занят на {used}%. Копии базы лежат в /var/backups/justwriting.')
    if iused >= 80:
        problem('inodes_high', f'Inode на диске заняты на {iused}%. Мелкие файлы: журналы docker, /tmp/jw-*.')

# ── служба ИИ ───────────────────────────────────────────────────────────────
if sh('systemctl is-active justwriting') != 'active':
    problem('service_down', 'Служба justwriting не работает — ИИ-функции и /api недоступны.')

# ── службы systemd (R6-005) ────────────────────────────────────────────────
units_out = sh("systemctl list-units --all --plain --no-legend 'justwriting*.service'")
if not units_out.strip():
    problem('units_list', 'Не удалось получить список юнитов: systemctl list-units пуст.')
else:
    failed = []
    for line in units_out.splitlines():
        parts = line.strip().split()
        if not parts:
            continue
        # S-44.3: колонки UNIT LOAD ACTIVE SUB DESCRIPTION; смотреть надо на ACTIVE,
        # иначе «failed» в описании юнита поднимает ложную тревогу.
        cols = parts[1:] if parts[0] in ('●', '*') else parts
        if len(cols) > 2 and cols[2] == 'failed':
            failed.append(cols[0])
    if failed:
        # S-59: вид включает момент последнего падения каждого юнита — второй
        # подряд проваленный месячный drill иначе не давал письма, пока кто-то
        # не сделал reset-failed.
        stamps = [f"{u}@{sh(f'systemctl show -p ExecMainExitTimestamp --value {u}')}" for u in failed]
        problem('units_failed:' + ','.join(sorted(stamps)), f"Юниты в failed: {', '.join(failed)} — journalctl -u {failed[0]}")

# ── контейнеры ──────────────────────────────────────────────────────────────
ps = sh(f'cd {COMPOSE_DIR} && docker compose ps --format json')
down = []
down_names = []
for line in ps.splitlines():
    try:
        c = json.loads(line)
    except Exception:
        continue
    state = (c.get('State') or '').lower()
    health = (c.get('Health') or '').lower()
    if state != 'running' or health in ('unhealthy', 'starting'):
        down.append(f"{c.get('Service')} ({state}{'/' + health if health else ''})")
        down_names.append(str(c.get('Service')))
if not any(line.strip().startswith('{') for line in ps.splitlines()):
    problem('containers_list', 'Не удалось получить список контейнеров: docker compose ps пуст.')
if down:
    # S-63: имена в ключе, как у units_failed: иначе «A упал», а потом «A поднялся,
    # B упал» — один ключ, и о B письма нет.
    problem('containers_down:' + ','.join(sorted(down_names)), 'Контейнеры не в порядке: ' + ', '.join(down))

# ── эмбеддинги (R5-055) ─────────────────────────────────────────────────────
# Отдельный compose-проект (/opt/justwriting/embeddings), в список выше не
# попадает, а /ready знает только, что адрес задан. Спрашиваем сам сервис.
emb = sh('curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://127.0.0.1:8081/health')
if emb != '200':
    problem('embeddings_down', f'Сервис эмбеддингов не отвечает: /health вернул {emb} — поиск и индексация заметок стоят.')

# ── свежесть резервной копии ────────────────────────────────────────────────
# R3-11: копия — только .dump с парной .sha256 (её пишут после проверки дампа).
BACKUP_DIR = Path(os.environ.get('BACKUP_DIR', '/var/backups/justwriting'))
try:
    dumps = sorted((p for p in BACKUP_DIR.glob('*.dump') if Path(f'{p}.sha256').exists()),
                   key=lambda p: p.stat().st_mtime, reverse=True)
except Exception as e:
    dumps = []
    problem('backup_dir', f'Не удалось прочитать каталог копий: {e}')

if not dumps:
    if not any(k == 'backup_dir' for k, _ in problems):
        problem('backup_none', 'Резервных копий нет вовсе.')
else:
    age_h = (time.time() - dumps[0].stat().st_mtime) / 3600
    if age_h > 26:
        problem('backup_stale', f'Свежей копии нет {age_h:.0f} часов — таймер копирования, похоже, сломался.')
    if not Path(f'{dumps[0]}.counts').exists():
        problem('backup_counts', 'Свежая копия базы не имеет .counts — проверка обвала выключена.')

# R5-056: отметку ставит pg-backup.sh, когда строк стало меньше вдвое против
# прошлой копии. Пока она лежит, ротация копий стоит.
try:
    shrink = BACKUP_DIR / 'SHRINK-ALERT'
    if shrink.exists():
        problem('shrink_alert', 'Строк в базе стало меньше вдвое против прошлой копии, ротация копий остановлена. '
                        'Если удаление намеренное — sudo rm ' + str(shrink) + '\n' +
                        '\n'.join(shrink.read_text().splitlines()[-3:]))
except Exception as e:
    # R5-054 / S-44.3: не прочитанная отметка — не «отметки нет».
    problem('shrink_unreadable', f'Не удалось прочитать отметку SHRINK-ALERT: {e}')

# ── сертификат ──────────────────────────────────────────────────────────────
out = sh('openssl x509 -enddate -noout -in /etc/letsencrypt/live/justwriting.ru/fullchain.pem')
m = re.search(r'notAfter=(.+)', out)
if not m:
    problem('cert_read', 'Не удалось прочитать срок сертификата: нет файла или openssl не ответил.')
else:
    left = (time.mktime(time.strptime(m.group(1).strip(), '%b %d %H:%M:%S %Y %Z')) - time.time()) / 86400
    if left < 20:
        problem('cert_expiring', f'Сертификат истекает через {left:.0f} дней — автопродление не сработало.')

# ── сайт отвечает (изнутри) и отдаёт приложение (R5-051) ───────────────────
# 200 на / ещё не приложение: при пропавшем чанке nginx отдаёт index.html, а
# человек видит белый экран. Проверяем метку сборки и каждый /assets/ из неё.
code, html = http(SITE + '/')
if code != '200':
    problem('site_code', f'Сайт отвечает {code} вместо 200.')
elif 'data-app-version=' not in html:
    problem('site_shell', 'Сайт отвечает 200, но без метки data-app-version — это не оболочка приложения.')
else:
    missing = [a for a in sorted(set(re.findall(r'(?:src|href)="(/assets/[^"]+)"', html)))
               if http(SITE + a, 'HEAD')[0] != '200']
    if missing:
        problem('site_assets:' + ','.join(missing), 'Сайт отвечает 200, но ассетов нет — белый экран: ' + ', '.join(missing[:5]))

# ── готовность ИИ-службы с базой (N-77) ─────────────────────────────────────
# /health проверяет только «процесс жив»: при висящем пуле он продолжает
# отвечать 200, и ни systemd, ни эта проверка ничего не замечают. /ready
# спрашивает базу. 000 — curl не дождался ответа (висяк), тоже проблема.
ready = sh('curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://127.0.0.1:3000/ready')
if ready != '200':
    problem('ready',
        'Служба justwriting не готова: /ready вернул ' + ready +
        ' — база не отвечает либо пул соединений занят целиком (000 = не дождался ответа).'
    )

# ── регистрация закрыта (DA-17) ─────────────────────────────────────────────
# Напрямую в GoTrue: снаружи /auth/v1/settings без apikey отвечает Kong'ом
# «No API key found», и проверка поднимала бы ложную тревогу каждый час.
auth_settings = sh('docker exec supabase-auth wget -qO- http://localhost:9999/settings')
try:
    auth_data = json.loads(auth_settings)
    if auth_data.get('disable_signup') is not True:
        problem('signup_open', 'Регистрация открыта: /auth/v1/settings вернул disable_signup: false.')
except Exception as e:
    problem('signup_check', f'Не удалось проверить /auth/v1/settings: {e}')

# ── отправка ────────────────────────────────────────────────────────────────
texts = [t for _, t in problems]
if DRY:
    print('\n'.join(texts) or 'проблем нет')
    sys.exit(0)

# S-44.3: письмо — один раз на смену набора причин. Состояние пишется и при
# пустом наборе: иначе та же поломка после починки осталась бы без письма.
# S-59: ключ — по видам причин; нечитаемое состояние — не «тот же ключ».
key = '|'.join(sorted(k for k, _ in problems))
prev = None
if STATE.exists():
    try: prev = json.loads(STATE.read_text())
    except Exception: prev = None
if isinstance(prev, dict) and prev.get('key') == key:
    sys.exit(0)

if problems:
    send('justwriting: проверка сервера нашла проблему',
         'Почасовая проверка сервера обнаружила:\n\n' + '\n'.join(f'  • {t}' for t in texts) +
         '\n\nСледующее письмо придёт, только когда набор причин изменится.\n')
    print('отправлено письмо:', '; '.join(texts))

# S-59: письмо раньше записи состояния — иначе каталог, который не создался,
# навсегда оставлял проверку без писем. Незаписанное состояние — само тревога.
try:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps({'key': key, 'sent': time.time()}))
except Exception as e:
    send('justwriting: состояние проверки сервера не записалось',
         f'Проверка отработала, но не смогла записать {STATE}: {type(e).__name__}: {e}\n'
         'Пока это не починено, одно и то же письмо будет приходить каждый час.\n')
    print(f'СОСТОЯНИЕ НЕ ЗАПИСАНО: {type(e).__name__}: {e}', file=sys.stderr)
    sys.exit(1)
