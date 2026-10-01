# Восстановление из резервной копии

Дамп — `pg_dump -Fc` всей базы (`/var/backups/justwriting/*.dump`, рядом
`.sha256`). Проверено учебным восстановлением 2026-09-24: дамп поднимается
целиком, включая `auth.users`, и заметки тестового аккаунта расшифровываются
его паролем — ключи сейфа (`users.encryption_meta`) лежат в том же снимке, что
и заметки.

## Учебное восстановление (раз в месяц)

```bash
sudo bash /opt/justwriting/backup/restore-drill.sh
```

Поднимает дамп в отдельном контейнере без сети и сверяет с боевой базой и число
строк, и права. Боевую базу не трогает.

### Таймер (R5-025, R5-062)

«Раз в месяц» держит systemd, а не память: `justwriting-restore-drill.timer`
запускает тот же скрипт 1-го числа в 05:00 UTC (после ночной копии в 03:30),
без `--keep-container` — контейнер с копией данных удаляется на выходе. Красный
drill — ненулевой код, юнит уходит в `failed`, вывод — в журнале. Установка
(один раз, из корня репозитория на сервере или после копирования файлов):

```bash
sudo install -m 644 deploy/backup/justwriting-restore-drill.service \
  deploy/backup/justwriting-restore-drill.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/justwriting-restore-drill.service
sudo systemctl enable --now justwriting-restore-drill.timer
systemctl list-timers justwriting-restore-drill.timer     # следующий запуск
sudo systemctl start justwriting-restore-drill.service    # первый прогон сразу, ждёт до конца
```

Итог последнего прогона — машиной, а не прозой:

```bash
systemctl show -p Result,ExecMainStatus,ExecMainExitTimestamp justwriting-restore-drill.service
journalctl -u justwriting-restore-drill.service -n 60 --no-pager
```

`Result=success`, `ExecMainStatus=0` — зелёный; `ExecMainExitTimestamp` старше
~35 дней — таймер не срабатывает, это тоже красный.

Красный drill оставляет юнит в `failed` до следующего запуска таймера, и
`healthcheck.py` (S-7) шлёт об этом одно письмо — следующее придёт, только
когда набор проблем изменится (S-44.3). Разобравшись с причиной, снять
состояние вручную, иначе в следующем письме о чём-то другом он будет снова:

```bash
sudo systemctl reset-failed justwriting-restore-drill.service
sudo /opt/justwriting/monitor/healthcheck.py --dry-run   # → «проблем нет»
```

Счётчики строк читаются суперюзером — на базе без единого табличного гранта они
выглядят точно так же, как на здоровой. Поэтому drill дополнительно входит в
восстановленную базу под ролями клиента (`authenticated`, `service_role`) и
сверяет гранты таблиц `public` с продом по строкам
«таблица роль привилегия» (`aclexplode`, права владельца не участвуют —
`--no-owner` делает владельцем `supabase_admin`). Права `anon`, `authenticated`
и `service_role` сравниваются целиком; расходится хотя бы одна строка — drill
красный. Замеры 2026-09-27: 408 записей на проде и в восстановленной базе,
совпали.

`--verify-only` прогоняет проверки по уже поднятому контейнеру `jw-restore-drill`
без нового восстановления — им и проверяют, что гейт краснеет. Обычный прогон
удаляет контейнер на выходе, поэтому первый прогон — с `--keep-container`, а
контейнер (в нём копия данных) после проверки удаляется руками:

```bash
sudo bash /opt/justwriting/backup/restore-drill.sh --keep-container   # → exit 0
sudo docker exec jw-restore-drill psql -U supabase_admin -h localhost -d postgres \
  -c 'revoke select on public.versions from authenticated'
sudo bash /opt/justwriting/backup/restore-drill.sh --verify-only   # → exit 1
sudo docker rm -f jw-restore-drill
```

Прогон 2026-09-30 (0.9.23, дамп 03:42 UTC): полный — exit 0, счётчики сошлись,
408 грантов совпали; после `revoke` — exit 1, «гранты разошлись», одна строка
`versions authenticated SELECT`.

## Срок хранения журнала входов (S-27)

Журнал GoTrue `auth.audit_log_entries` пишет входы, сбросы пароля и приглашения
вместе с почтой. Держим 30 дней — обещание в политике, раздел «Сроки хранения»;
записи удалённого аккаунта стирает само удаление (S-10), а не этот таймер.

Файлы в `deploy/backup/` совпадают с продом побайтно (проверка — sha256, а не
«похоже на правду»):

```bash
sha256sum /etc/systemd/system/justwriting-audit-retention.{service,timer} \
  deploy/backup/justwriting-audit-retention.{service,timer}
```

Установка (на сервере, из корня репозитория):

```bash
sudo install -m 644 deploy/backup/justwriting-audit-retention.service \
  deploy/backup/justwriting-audit-retention.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/justwriting-audit-retention.service
sudo systemctl enable --now justwriting-audit-retention.timer
sudo systemctl start justwriting-audit-retention.service   # первый прогон сразу
journalctl -u justwriting-audit-retention.service -n 20 --no-pager
```

Плюс 600 секунд случайной задержки к 04:20 UTC, `Persistent=true` догоняет
пропущенный запуск. Юнит попадает под маску `justwriting*.service`, которой
мониторинг (S-7) смотрит `failed` — то есть молча не работающая чистка краснеет
в healthcheck, а не остаётся не замеченной, как drill 2026-10-01.

## Восстановление всего

Только `--clean --if-exists` от `supabase_admin`: образ Supabase при старте
сам создаёт схему `auth`, и восстановление поверх неё без `--clean` теряет
`auth.users` — аккаунты не входят, uid заметок повисают.

`--no-privileges` теряет то, что миграции **отозвали** (служебные таблицы из
0034, EXECUTE у функций из 0017/0020/0033): права по умолчанию образа выдают
их снова. Поэтому сразу после `pg_restore` применяется
`post-restore-grants.sql` — все `grant`/`revoke` из миграций (тест
`scripts/__tests__/postRestoreGrants.test.ts` держит список полным). Drill
2026-10-01 это и поймал.

`--no-privileges` не выбрасывает гранты приложения: образ держит
`ALTER DEFAULT PRIVILEGES`, и таблицы, созданные восстановлением, получают
права `anon`/`authenticated`/`service_role` заново. Проверено на настоящем
контейнере 2026-09-27 (сверка грантов в drill — тот факт и сторожит: гранты
перестанут возвращаться — drill покраснеет). В чистом Postgres без default
privileges эта опция теряет гранты, и приложение в базу не войдёт — если
восстанавливать не в образ Supabase, `--no-privileges` убрать.

```bash
F=$(sudo sh -c 'ls -1t /var/backups/justwriting/*.dump | head -1')
sudo sh -c "cd /var/backups/justwriting && sha256sum -c \"$(basename "$F").sha256\""
cd /opt/justwriting/supabase
sudo docker compose stop kong auth rest realtime   # никто не пишет во время восстановления
sudo cat "$F" | sudo docker exec -i supabase-db pg_restore -U supabase_admin -d postgres \
  --clean --if-exists --no-owner --no-privileges
# права, которые миграции отозвали: --no-privileges их теряет, а default
# privileges образа возвращают anon/authenticated всё (drill 2026-10-01)
sudo docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
  < /opt/justwriting/backup/post-restore-grants.sql
sudo docker compose start kong auth rest realtime
```

После восстановления всего — прогнать drill целиком: он сверяет счётчики и
гранты с живой базой.

## Восстановление одного человека

Поднять дамп рядом (`restore-drill.sh`, закомментировав `trap`), затем
перенести его строки по `user_id`/`uid` в боевую базу: `auth.users` →
`public.users` → `documents` → `versions` → `drafts` → `ai_summaries` →
`ai_embeddings` → `local_store_records` (порядок — из-за внешних ключей).
Всё зашифровано ключом из `users.encryption_meta` — переносить её вместе с
остальным, иначе заметки не открыть.
