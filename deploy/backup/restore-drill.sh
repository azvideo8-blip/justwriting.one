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

compare_drill_counts() {
  local dump_counts="$1"
  local prod_counts="$2"

  local labels=("auth.users" "public.users" "documents" "versions" "local_store_records" "vaults")

  IFS='|' read -r d_auth d_users d_docs d_vers d_ai d_vault <<< "$dump_counts"
  IFS='|' read -r p_auth p_users p_docs p_vers p_ai p_vault <<< "$prod_counts"

  local d_arr=("$d_auth" "$d_users" "$d_docs" "$d_vers" "$d_ai" "$d_vault")
  local p_arr=("$p_auth" "$p_users" "$p_docs" "$p_vers" "$p_ai" "$p_vault")

  # Проверка формата (числовые значения)
  for ((i=0; i<6; i++)); do
    if ! [[ "${d_arr[i]}" =~ ^[0-9]+$ ]] || ! [[ "${p_arr[i]}" =~ ^[0-9]+$ ]]; then
      echo "ERROR: нечисловые значения счётчиков (${labels[i]}: dump='${d_arr[i]}', prod='${p_arr[i]}')" >&2
      return 1
    fi
  done

  # Дамп может и отставать от прода (записали после копии), и опережать его
  # (удалили заметку или аккаунт после копии) — это не сбой. Сбой — дамп,
  # который не восстановился целиком: пуст при непустом проде или намного
  # меньше прода (N-36). Пустой прод — здоровое состояние, не красное.
  local p_total=0
  for ((i=0; i<6; i++)); do p_total=$((p_total + p_arr[i])); done
  if [ "$p_total" -eq 0 ]; then
    echo "OK: прод пуст — сверять не с чем"
    return 0
  fi

  if { [ "$p_users" -gt 0 ] && [ "$d_users" -eq 0 ]; } || { [ "$p_docs" -gt 0 ] && [ "$d_docs" -eq 0 ]; }; then
    echo "ERROR: дамп пуст при непустом проде (users=$d_users/$p_users, documents=$d_docs/$p_docs)" >&2
    return 1
  fi

  # Меньше половины прода там, где на проде хотя бы 10 строк, — дамп обрезан.
  for ((i=0; i<6; i++)); do
    local d="${d_arr[i]}"
    local p="${p_arr[i]}"
    if [ "$p" -ge 10 ] && [ $((d * 2)) -lt "$p" ]; then
      echo "ERROR: в дампе ${labels[i]}=$d, на проде $p — меньше половины, похоже на неполное восстановление" >&2
      return 1
    fi
  done

  echo "OK: сверка дампа и прода успешна (дамп не пуст и не обрезан)"
  return 0
}

if [ "${1:-}" = "--compare" ]; then
  compare_drill_counts "$2" "$3"
  exit $?
fi

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

Q_RAW="select (select count(*) from auth.users)||'|'||(select count(*) from public.users)||'|'||(select count(*) from public.documents)||'|'||(select count(*) from public.versions)||'|'||(select count(*) from public.local_store_records)||'|'||(select count(*) from public.users where encryption_meta is not null)"
dump_raw=$(docker exec -e PGPASSWORD=drill "$NAME" psql -U supabase_admin -h localhost -d postgres -At -c "$Q_RAW")
prod_raw=$(docker exec supabase-db psql -U postgres -At -c "$Q_RAW")

compare_drill_counts "$dump_raw" "$prod_raw"
