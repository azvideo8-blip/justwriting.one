#!/usr/bin/env python3
# Почасовая проверка сервера justwriting.
#
# Проверяет то, что видно изнутри: место, контейнеры, службу, свежесть резервной
# копии, срок сертификата. Того, что сервер вообще жив, отсюда не проверить —
# для этого есть задание на ноутбуке.
#
# Письмо уходит только при отклонении и не чаще раза в 12 часов на одну и ту же
# причину: молчание должно значить «всё хорошо», а поток одинаковых писем
# приводит к тому, что их перестают читать.
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

STATE = Path('/var/lib/justwriting-monitor/state.json')
REPEAT_AFTER = 12 * 3600
SITE = os.environ.get('MONITOR_SITE', 'https://justwriting.ru')
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
        env = dict(re.findall(r'^(\w+)=(.*)$', Path('/opt/justwriting/supabase/.env').read_text(), re.M))
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

problems = []

# ── место на диске: байты и inode (R5-061) ─────────────────────────────────
pct = re.findall(r'(\d+)%', sh('df --output=pcent,ipcent / | tail -1'))
if len(pct) != 2:
    problems.append('Не удалось измерить место на диске: df не ответил.')
else:
    used, iused = map(int, pct)
    if used >= 80:
        problems.append(f'Диск занят на {used}%. Копии базы лежат в /var/backups/justwriting.')
    if iused >= 80:
        problems.append(f'Inode на диске заняты на {iused}%. Мелкие файлы: журналы docker, /tmp/jw-*.')

# ── служба ИИ ───────────────────────────────────────────────────────────────
if sh('systemctl is-active justwriting') != 'active':
    problems.append('Служба justwriting не работает — ИИ-функции и /api недоступны.')

# ── службы systemd (R6-005) ────────────────────────────────────────────────
units_out = sh("systemctl list-units --all --plain --no-legend 'justwriting*.service'")
if not units_out.strip():
    problems.append('Не удалось получить список юнитов: systemctl list-units пуст.')
else:
    failed = []
    for line in units_out.splitlines():
        parts = line.strip().split()
        if not parts:
            continue
        unit = parts[1] if parts[0] in ('●', '*') else parts[0]
        if 'failed' in parts[1:]:
            failed.append(unit)
    if failed:
        problems.append(f"Юниты в failed: {', '.join(failed)} — journalctl -u {failed[0]}")

# ── контейнеры ──────────────────────────────────────────────────────────────
ps = sh('cd /opt/justwriting/supabase && docker compose ps --format json')
down = []
for line in ps.splitlines():
    try:
        c = json.loads(line)
    except Exception:
        continue
    state = (c.get('State') or '').lower()
    health = (c.get('Health') or '').lower()
    if state != 'running' or health in ('unhealthy', 'starting'):
        down.append(f"{c.get('Service')} ({state}{'/' + health if health else ''})")
if not any(line.strip().startswith('{') for line in ps.splitlines()):
    problems.append('Не удалось получить список контейнеров: docker compose ps пуст.')
if down:
    problems.append('Контейнеры не в порядке: ' + ', '.join(down))

# ── эмбеддинги (R5-055) ─────────────────────────────────────────────────────
# Отдельный compose-проект (/opt/justwriting/embeddings), в список выше не
# попадает, а /ready знает только, что адрес задан. Спрашиваем сам сервис.
emb = sh('curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://127.0.0.1:8081/health')
if emb != '200':
    problems.append(f'Сервис эмбеддингов не отвечает: /health вернул {emb} — поиск и индексация заметок стоят.')

# ── свежесть резервной копии ────────────────────────────────────────────────
# R3-11: копия — только .dump с парной .sha256 (её пишут после проверки дампа).
BACKUP_DIR = Path(os.environ.get('BACKUP_DIR', '/var/backups/justwriting'))
try:
    dumps = sorted((p for p in BACKUP_DIR.glob('*.dump') if Path(f'{p}.sha256').exists()),
                   key=lambda p: p.stat().st_mtime, reverse=True)
except Exception as e:
    dumps = []
    problems.append(f'Не удалось прочитать каталог копий: {e}')

if not dumps:
    if not any('каталог копий' in p for p in problems):
        problems.append('Резервных копий нет вовсе.')
else:
    age_h = (time.time() - dumps[0].stat().st_mtime) / 3600
    if age_h > 26:
        problems.append(f'Свежей копии нет {age_h:.0f} часов — таймер копирования, похоже, сломался.')
    if not Path(f'{dumps[0]}.counts').exists():
        problems.append('Свежая копия базы не имеет .counts — проверка обвала выключена.')

# R5-056: отметку ставит pg-backup.sh, когда строк стало меньше вдвое против
# прошлой копии. Пока она лежит, ротация копий стоит.
try:
    shrink = BACKUP_DIR / 'SHRINK-ALERT'
    if shrink.exists():
        problems.append('Строк в базе стало меньше вдвое против прошлой копии, ротация копий остановлена. '
                        'Если удаление намеренное — sudo rm ' + str(shrink) + '\n' +
                        '\n'.join(shrink.read_text().splitlines()[-3:]))
except Exception:
    pass

# ── сертификат ──────────────────────────────────────────────────────────────
out = sh('openssl x509 -enddate -noout -in /etc/letsencrypt/live/justwriting.ru/fullchain.pem')
m = re.search(r'notAfter=(.+)', out)
if not m:
    problems.append('Не удалось прочитать срок сертификата: нет файла или openssl не ответил.')
else:
    left = (time.mktime(time.strptime(m.group(1).strip(), '%b %d %H:%M:%S %Y %Z')) - time.time()) / 86400
    if left < 20:
        problems.append(f'Сертификат истекает через {left:.0f} дней — автопродление не сработало.')

# ── сайт отвечает (изнутри) и отдаёт приложение (R5-051) ───────────────────
# 200 на / ещё не приложение: при пропавшем чанке nginx отдаёт index.html, а
# человек видит белый экран. Проверяем метку сборки и каждый /assets/ из неё.
code, html = http(SITE + '/')
if code != '200':
    problems.append(f'Сайт отвечает {code} вместо 200.')
elif 'data-app-version=' not in html:
    problems.append('Сайт отвечает 200, но без метки data-app-version — это не оболочка приложения.')
else:
    missing = [a for a in sorted(set(re.findall(r'(?:src|href)="(/assets/[^"]+)"', html)))
               if http(SITE + a, 'HEAD')[0] != '200']
    if missing:
        problems.append('Сайт отвечает 200, но ассетов нет — белый экран: ' + ', '.join(missing[:5]))

# ── готовность ИИ-службы с базой (N-77) ─────────────────────────────────────
# /health проверяет только «процесс жив»: при висящем пуле он продолжает
# отвечать 200, и ни systemd, ни эта проверка ничего не замечают. /ready
# спрашивает базу. 000 — curl не дождался ответа (висяк), тоже проблема.
ready = sh('curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://127.0.0.1:3000/ready')
if ready != '200':
    problems.append(
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
        problems.append('Регистрация открыта: /auth/v1/settings вернул disable_signup: false.')
except Exception as e:
    problems.append(f'Не удалось проверить /auth/v1/settings: {e}')

# ── отправка ────────────────────────────────────────────────────────────────
if DRY:
    print('\n'.join(problems) or 'проблем нет')
    sys.exit(0)
if not problems:
    sys.exit(0)

key = '|'.join(sorted(p.split('.')[0] for p in problems))
STATE.parent.mkdir(parents=True, exist_ok=True)
prev = {}
if STATE.exists():
    try: prev = json.loads(STATE.read_text())
    except Exception: prev = {}
if prev.get('key') == key and time.time() - prev.get('sent', 0) < REPEAT_AFTER:
    sys.exit(0)

send('justwriting: проверка сервера нашла проблему',
     'Почасовая проверка сервера обнаружила:\n\n' + '\n'.join(f'  • {p}' for p in problems) +
     '\n\nЭто письмо приходит не чаще раза в 12 часов на одну и ту же причину.\n')

STATE.write_text(json.dumps({'key': key, 'sent': time.time()}))
print('отправлено письмо:', '; '.join(problems))
