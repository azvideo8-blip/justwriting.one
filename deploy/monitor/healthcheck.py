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
import json, os, re, smtplib, ssl, subprocess, sys, time
from email.message import EmailMessage
from pathlib import Path

STATE = Path('/var/lib/justwriting-monitor/state.json')
REPEAT_AFTER = 12 * 3600
# EA-2: адрес получателя — из окружения (EnvironmentFile в unit), не из репозитория.
TO = os.environ.get('MONITOR_ALERT_TO', '')
if not TO:
    print('MONITOR_ALERT_TO не задан — некому слать тревоги', file=sys.stderr)
    sys.exit(2)

def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.strip()

problems = []

# ── место на диске ──────────────────────────────────────────────────────────
used = int(sh("df --output=pcent / | tail -1 | tr -dc '0-9'") or 0)
if used >= 80:
    problems.append(f'Диск занят на {used}%. Копии базы лежат в /var/backups/justwriting.')

# ── служба ИИ ───────────────────────────────────────────────────────────────
if sh('systemctl is-active justwriting') != 'active':
    problems.append('Служба justwriting не работает — ИИ-функции и /api недоступны.')

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
if down:
    problems.append('Контейнеры не в порядке: ' + ', '.join(down))

# ── свежесть резервной копии ────────────────────────────────────────────────
dumps = sorted(Path('/var/backups/justwriting').glob('*.dump'), key=lambda p: p.stat().st_mtime, reverse=True)
if not dumps:
    problems.append('Резервных копий нет вовсе.')
else:
    age_h = (time.time() - dumps[0].stat().st_mtime) / 3600
    if age_h > 26:
        problems.append(f'Свежей копии нет {age_h:.0f} часов — таймер копирования, похоже, сломался.')

# ── сертификат ──────────────────────────────────────────────────────────────
out = sh('openssl x509 -enddate -noout -in /etc/letsencrypt/live/justwriting.ru/fullchain.pem')
m = re.search(r'notAfter=(.+)', out)
if m:
    left = (time.mktime(time.strptime(m.group(1).strip(), '%b %d %H:%M:%S %Y %Z')) - time.time()) / 86400
    if left < 20:
        problems.append(f'Сертификат истекает через {left:.0f} дней — автопродление не сработало.')

# ── сайт отвечает (изнутри) ─────────────────────────────────────────────────
code = sh('curl -s -o /dev/null -w "%{http_code}" --max-time 15 https://justwriting.ru/')
if code != '200':
    problems.append(f'Сайт отвечает {code} вместо 200.')

# ── регистрация закрыта (DA-17) ─────────────────────────────────────────────
auth_settings = sh('curl -s --max-time 15 https://justwriting.ru/auth/v1/settings')
try:
    auth_data = json.loads(auth_settings)
    if auth_data.get('disable_signup') is not True:
        problems.append('Регистрация открыта: /auth/v1/settings вернул disable_signup: false.')
except Exception as e:
    problems.append(f'Не удалось проверить /auth/v1/settings: {e}')

# ── отправка ────────────────────────────────────────────────────────────────
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

env = dict(re.findall(r'^(\w+)=(.*)$', Path('/opt/justwriting/supabase/.env').read_text(), re.M))
msg = EmailMessage()
msg['Subject'] = 'justwriting: проверка сервера нашла проблему'
msg['From'] = env['SMTP_USER']
msg['To'] = TO
msg.set_content('Почасовая проверка сервера обнаружила:\n\n' + '\n'.join(f'  • {p}' for p in problems) +
                '\n\nЭто письмо приходит не чаще раза в 12 часов на одну и ту же причину.\n')
with smtplib.SMTP_SSL(env['SMTP_HOST'], int(env['SMTP_PORT']), timeout=30, context=ssl.create_default_context()) as s:
    s.login(env['SMTP_USER'], env['SMTP_PASS'])
    s.send_message(msg)

STATE.write_text(json.dumps({'key': key, 'sent': time.time()}))
print('отправлено письмо:', '; '.join(problems))
