#!/usr/bin/env bash
# Учебное восстановление: свежий дамп → отдельный контейнер без сети → сверка
# числа строк с боевой базой. Ничего в боевой базе не трогает. Запускать на
# сервере от root:  sudo bash /opt/justwriting/backup/restore-drill.sh
#
# Проверено 2026-09-24 (next-steps №3): наивное восстановление в свежий образ
# Supabase теряет auth.users (схема auth уже создана образом и конфликтует) —
# аккаунты не входят, а uid, к которым привязаны заметки, пропадают. Рабочий
# способ — pg_restore --clean --if-exists от supabase_admin (см. RESTORE.md).
set -euo pipefail

IMAGE=$(docker inspect supabase-db --format '{{.Config.Image}}')
DUMP=$(ls -t /var/backups/justwriting/*.dump | head -1)
NAME=jw-restore-drill

( cd /var/backups/justwriting && sha256sum -c "$(basename "$DUMP").sha256" )

docker rm -f "$NAME" >/dev/null 2>&1 || true
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$NAME" --memory 1g --network none -e POSTGRES_PASSWORD=drill "$IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break; sleep 2; done
sleep 5

docker exec -i -e PGPASSWORD=drill "$NAME" pg_restore -U supabase_admin -h localhost -d postgres \
  --clean --if-exists --no-owner --no-privileges < "$DUMP"

Q="select (select count(*) from auth.users)||' auth.users, '||(select count(*) from public.users)||' users, '||(select count(*) from public.documents)||' docs, '||(select count(*) from public.versions)||' versions, '||(select count(*) from public.local_store_records)||' ai records, '||(select count(*) from public.users where encryption_meta is not null)||' vaults'"
echo "дамп:  $(docker exec -e PGPASSWORD=drill "$NAME" psql -U supabase_admin -h localhost -d postgres -At -c "$Q")"
echo "прод:  $(docker exec supabase-db psql -U postgres -At -c "$Q")"
echo "(прод может быть впереди на то, что записано после дампа)"
