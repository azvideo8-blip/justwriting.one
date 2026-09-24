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

Поднимает дамп в отдельном контейнере без сети и сверяет число строк с боевой
базой. Боевую базу не трогает.

## Восстановление всего

Только `--clean --if-exists` от `supabase_admin`: образ Supabase при старте
сам создаёт схему `auth`, и восстановление поверх неё без `--clean` теряет
`auth.users` — аккаунты не входят, uid заметок повисают.

```bash
cd /opt/justwriting/supabase
sudo docker compose stop kong auth rest realtime   # никто не пишет во время восстановления
F=$(sudo ls -t /var/backups/justwriting/*.dump | head -1)
( cd /var/backups/justwriting && sudo sha256sum -c "$(basename $F).sha256" )
sudo cat "$F" | sudo docker exec -i supabase-db pg_restore -U supabase_admin -d postgres \
  --clean --if-exists --no-owner --no-privileges
sudo docker compose start kong auth rest realtime
```

## Восстановление одного человека

Поднять дамп рядом (`restore-drill.sh`, закомментировав `trap`), затем
перенести его строки по `user_id`/`uid` в боевую базу: `auth.users` →
`public.users` → `documents` → `versions` → `drafts` → `ai_summaries` →
`ai_embeddings` → `local_store_records` (порядок — из-за внешних ключей).
Всё зашифровано ключом из `users.encryption_meta` — переносить её вместе с
остальным, иначе заметки не открыть.
