#!/usr/bin/env bash
# Учебное восстановление: свежий дамп → отдельный контейнер без сети → сверка
# числа строк и прав доступа с боевой базой. Ничего в боевой базе не трогает.
# Запускать на сервере от root:  sudo bash /opt/justwriting/backup/restore-drill.sh
#
# Проверено 2026-09-24 (next-steps №3): наивное восстановление в свежий образ
# Supabase теряет auth.users (схема auth уже создана образом и конфликтует) —
# аккаунты не входят, а uid, к которым привязаны заметки, пропадают. Рабочий
# способ — pg_restore --clean --if-exists от supabase_admin (см. RESTORE.md).
#
# N-78: счётчики строк читаются суперюзером и про права не знают ничего. Drill
# обязан краснеть на базе, в которую приложение не может войти, — поэтому после
# сверки счётчиков проверяется вход под ролью приложения и гранты таблиц.
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

# N-78: сравнение табличных грантов восстановленной базы с продом. Формат
# строк — «таблица роль привилегия» по одной строке на грант (запрос GRANTS_QUERY
# ниже), поэтому записи владельца в сравнении нет и порядок не важен.
compare_drill_grants() {
  local restored="$1"
  local prod="$2"

  local restored_count prod_count
  restored_count=$(printf '%s\n' "$restored" | grep -c . || true)
  prod_count=$(printf '%s\n' "$prod" | grep -c . || true)

  # Гейт не проходит вслепую: пустой список — это не «гранты совпали».
  if [ "$prod_count" -eq 0 ] || [ "$restored_count" -eq 0 ]; then
    echo "ERROR: сверка грантов не состоялась (строк грантов: восстановлено=$restored_count, прод=$prod_count)" >&2
    return 1
  fi

  local diff_out
  if diff_out=$(diff <(printf '%s\n' "$restored" | sort) <(printf '%s\n' "$prod" | sort)); then
    echo "OK: гранты ролей приложения совпадают с продом ($prod_count записей)"
    return 0
  fi

  echo "ERROR: гранты разошлись с продом — приложение после восстановления может не войти в базу:" >&2
  printf '%s\n' "$diff_out" | head -20 >&2
  return 1
}

if [ "${1:-}" = "--compare" ]; then
  compare_drill_counts "$2" "$3"
  exit $?
fi

if [ "${1:-}" = "--compare-grants" ]; then
  compare_drill_grants "$2" "$3"
  exit $?
fi

IMAGE=$(docker inspect supabase-db --format '{{.Config.Image}}')
DUMP=$(ls -t /var/backups/justwriting/*.dump | head -1)
NAME=jw-restore-drill

# ── N-78: вход приложения и гранты ──────────────────────────────────────────
# Счётчики читаются суперюзером: на базе без единого табличного гранта они
# точь-в-точь такие же. Проверка под ролью, которой реально работает клиент, —
# единственная, что может покраснеть на потере грантов.
drill_sql() { docker exec -e PGPASSWORD=drill "$NAME" psql -U supabase_admin -h localhost -d postgres -At -c "$1"; }
prod_sql() { docker exec supabase-db psql -U postgres -d postgres -At -c "$1"; }

# Права владельца в сверку не входят: pg_restore --no-owner делает владельцем
# supabase_admin, а на проде это другой роль, — запись acl разошлась бы всегда
# и поводу, которого нет. Смысл проверки — права трёх ролей Supabase, под
# которыми ходит клиент (anon/authenticated через Kong, service_role у API).
# grantee из aclexplode — OID, сравнивать его с именем надо через pg_roles.
# Таблицы и представления — плюс функции: отзыв EXECUTE у PUBLIC/anon
# (0017/0020/0033) восстановление теряло так же, как отзыв прав на таблицы
# (0034), а сверка видела только таблицы. Для функций NULL в proacl — права по
# умолчанию (EXECUTE для PUBLIC), поэтому acldefault.
GRANTS_QUERY="select q from (
 select c.relname||' '||coalesce(r.rolname,'PUBLIC')||' '||p.privilege_type as q
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) p
   left join pg_roles r on r.oid = p.grantee
  where n.nspname = 'public' and c.relkind in ('r','v')
    and coalesce(r.rolname,'PUBLIC') in ('anon','authenticated','service_role')
 union all
 select 'fn '||pr.proname||'('||pg_get_function_identity_arguments(pr.oid)||') '||coalesce(r.rolname,'PUBLIC')||' '||p.privilege_type
   from pg_proc pr
   join pg_namespace n on n.oid = pr.pronamespace
  cross join lateral aclexplode(coalesce(pr.proacl, acldefault('f', pr.proowner))) p
   left join pg_roles r on r.oid = p.grantee
  where n.nspname = 'public'
    and coalesce(r.rolname,'PUBLIC') in ('anon','authenticated','service_role','PUBLIC')
) x order by 1"

run_checks() {
  Q="select (select count(*) from auth.users)||' auth.users, '||(select count(*) from public.users)||' users, '||(select count(*) from public.documents)||' docs, '||(select count(*) from public.versions)||' versions, '||(select count(*) from public.local_store_records)||' ai records, '||(select count(*) from public.users where encryption_meta is not null)||' vaults'"
  # N-91: psql из $(…) отдаёт ошибку как пустую строку — сверка падала с
  # «нечисловые значения», хотя причина была в недоступной базе. Каждый
  # доступ к базе теперь проверяется явно и падает с честной причиной.
  dump_display=$(drill_sql "$Q") || { echo "ERROR: drill-контейнер не отвечает (psql не смог прочитать счётчики)" >&2; return 1; }
  prod_display=$(prod_sql "$Q") || { echo "ERROR: прод не отвечает (psql не смог прочитать счётчики)" >&2; return 1; }
  echo "дамп:  $dump_display"
  echo "прод:  $prod_display"
  echo "(прод может быть впереди на то, что записано после дампа)"

  Q_RAW="select (select count(*) from auth.users)||'|'||(select count(*) from public.users)||'|'||(select count(*) from public.documents)||'|'||(select count(*) from public.versions)||'|'||(select count(*) from public.local_store_records)||'|'||(select count(*) from public.users where encryption_meta is not null)"
  dump_counts=$(drill_sql "$Q_RAW") || { echo "ERROR: drill-контейнер не отвечает (psql не смог прочитать сырые счётчики)" >&2; return 1; }
  prod_counts=$(prod_sql "$Q_RAW") || { echo "ERROR: прод не отвечает (psql не смог прочитать сырые счётчики)" >&2; return 1; }
  compare_drill_counts "$dump_counts" "$prod_counts" || return 1

  local login_failed=0
  for role in authenticated service_role; do
    for table in documents users; do
      if ! out=$(drill_sql "set role $role; select 1 from public.$table limit 1" 2>&1); then
        echo "ERROR: роль $role не читает public.$table после восстановления: $out" >&2
        login_failed=1
      fi
    done
  done
  if [ "$login_failed" -ne 0 ]; then
    echo "Проверить вход приложения — не удалось: см. ERROR выше."
    return 1
  fi
  echo "OK: приложение входит в восстановленную базу (authenticated, service_role)"

  # N-91: гранты тоже читаются явно — пустой ответ psql не «пустой список грантов».
  restored_grants=$(drill_sql "$GRANTS_QUERY") || { echo "ERROR: drill-контейнер не отвечает (psql не смог прочитать гранты)" >&2; return 1; }
  prod_grants=$(prod_sql "$GRANTS_QUERY") || { echo "ERROR: прод не отвечает (psql не смог прочитать гранты)" >&2; return 1; }
  compare_drill_grants "$restored_grants" "$prod_grants"
}

# --verify-only: боевой дамп не разворачивать, проверить контейнер с прошлой
# итерации. Нужно, чтобы подкрутить гранты в одноразовом контейнере и убедиться,
# что сверка краснеет, — иначе каждая поломка стоит полного восстановления.
if [ "${1:-}" = "--verify-only" ] || [ "${2:-}" = "--verify-only" ]; then
  # N-91: без контейнера проверять нечего — раньше это падало дальше по скрипту
  # с посторонней ошибкой.
  if ! docker container inspect "$NAME" >/dev/null 2>&1; then
    echo "ERROR: контейнер $NAME не найден — --verify-only проверять нечего." >&2
    echo "Сначала полный прогон: sudo bash $0 --keep-container" >&2
    exit 1
  fi
  run_checks
  exit $?
fi

# N-91: --keep-container не убивает контейнер после прогона — так работает
# красный рецепт из RESTORE.md: прогон → отозвать грант → --verify-only.
KEEP_CONTAINER=0
for arg in "$@"; do
  if [ "$arg" = "--keep-container" ]; then KEEP_CONTAINER=1; fi
done

( cd /var/backups/justwriting && sha256sum -c "$(basename "$DUMP").sha256" )

docker rm -f "$NAME" >/dev/null 2>&1 || true
if [ "$KEEP_CONTAINER" -eq 0 ]; then
  trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
fi
docker run -d --name "$NAME" --memory 1g --network none -e POSTGRES_PASSWORD=drill "$IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break; sleep 2; done
sleep 5

docker exec -i -e PGPASSWORD=drill "$NAME" pg_restore -U supabase_admin -h localhost -d postgres \
  --clean --if-exists --no-owner --no-privileges < "$DUMP"
# Права, которые миграции отозвали, --no-privileges теряет — возвращаем их
# тем же файлом, что и при настоящем восстановлении (RESTORE.md).
docker exec -i -e PGPASSWORD=drill "$NAME" psql -U supabase_admin -h localhost -d postgres -v ON_ERROR_STOP=1 -q \
  < "$(dirname "$0")/post-restore-grants.sql"

run_checks
