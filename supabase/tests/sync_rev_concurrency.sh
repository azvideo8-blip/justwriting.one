#!/usr/bin/env bash
# sync_rev_concurrency.sh — два сеанса к живой базе стенда (S1-2).
#
# Почему отдельно от sync_rev.test.sql: здесь нужен второй сеанс, а CI-шаг rls
# склеивает миграции и тесты в один поток psql. С DY10-5 (30.10) — шаг
# «sync_rev guards (0045)» в джобе rls; вручную — на стенде (Docker или нативная база).
#
# Подключение задаётся переменными окружения (как у psql):
#   PGHOST PGPORT PGUSER PGDATABASE — можно передать утилите напрямую.
# По умолчанию используется psql из PATH. Для docker-стенда:
#   SYNC_REV_PSQL="docker exec -i jw-stand-db psql -U postgres" \
#     bash supabase/tests/sync_rev_concurrency.sh
# Для нативной базы:
#   SYNC_REV_PSQL="/c/.../pgsql/bin/psql.exe" PGPORT=55541 PGUSER=postgres \
#     PGDATABASE=postgres PGHOST=127.0.0.1 bash supabase/tests/sync_rev_concurrency.sh
#
# Проверки:
#   1) пока транзакция A держит замок пользователя U, UPDATE другой строки U из
#      сеанса B получает 55P03 (lock_timeout); строка пользователя V проходит;
#      после commit A запись B проходит, и rev_B > rev_A.
#   2) два многострочных обновления U в разном порядке строк не дают 40P01:
#      statement-триггер берёт замок до блокировок строк.
#
# Без `sleep`-гонок: окно ожидания стартует только после того, как A реально
# вошёл в pg_sleep, то есть уже держит замок и строку.

set -euo pipefail

read -r -a PSQL_CMD <<< "${SYNC_REV_PSQL:-psql}"

U=00000000-0000-0000-0000-000000000fa1
V=00000000-0000-0000-0000-000000000fa2

q() {
  "${PSQL_CMD[@]}" -v ON_ERROR_STOP=1 -Atq "$@"
}

# Имя сеанса — в строке подключения, а не в PGAPPNAME: при `docker exec … psql`
# переменная окружения остаётся у клиента docker и в контейнер не попадает
# (DY10-5: в CI сеанс A не находился в pg_stat_activity).
conninfo() {
  echo "dbname=${PGDATABASE:-postgres} application_name=$1"
}

fail() {
  echo "sync_rev_concurrency: FAIL: $*" >&2
  exit 1
}

cleanup() {
  q -c "delete from public.documents where uuid like 's1-conc-%';
        delete from auth.users where id in ('$U', '$V');" >/dev/null 2>&1 || true
}
trap cleanup EXIT

q -c "insert into auth.users (id, email) values
        ('$U', 'sync-conc-u@test.local'),
        ('$V', 'sync-conc-v@test.local')
      on conflict (id) do nothing;
      delete from public.documents where uuid like 's1-conc-%';
      insert into public.documents (uuid, user_id, title) values
        ('s1-conc-u1', '$U', 'init'),
        ('s1-conc-u2', '$U', 'init'),
        ('s1-conc-v1', '$V', 'init');"

echo "== 1. замок пользователя: B ждёт A, V проходит"

"${PSQL_CMD[@]}" -d "$(conninfo sync1-A)" -v ON_ERROR_STOP=1 -q <<SQL &
begin;
update public.documents set title = 'a' where uuid = 's1-conc-u1';
select pg_sleep(3);
commit;
SQL
A_PID=$!

A_READY=0
for _ in $(seq 1 100); do
  n=$(q -c "select count(*) from pg_stat_activity
            where application_name = 'sync1-A' and query like '%pg_sleep(3)%'")
  if [ "$n" = "1" ]; then A_READY=1; break; fi
  sleep 0.1
done
[ "$A_READY" = "1" ] || { kill "$A_PID" 2>/dev/null || true; fail "сеанс A не вошёл в pg_sleep (замок не взят)"; }

set +e
OUT_B=$("${PSQL_CMD[@]}" -v ON_ERROR_STOP=1 -Atq \
  -c '\set VERBOSITY verbose' \
  -c "set lock_timeout = '300ms';
      update public.documents set title = 'b' where uuid = 's1-conc-u2';" 2>&1)
RC_B=$?
set -e
[ "$RC_B" -ne 0 ] || fail "B прошёл при открытой транзакции A — замка пользователя нет"
case "$OUT_B" in
  *55P03*) ;;
  *) fail "B упал не по lock_timeout: $OUT_B" ;;
esac

"${PSQL_CMD[@]}" -v ON_ERROR_STOP=1 -Atq \
  -c "set lock_timeout = '300ms';
      update public.documents set title = 'v' where uuid = 's1-conc-v1';" >/dev/null \
  || fail "V не прошёл, хотя замок другого пользователя не должен мешать"

wait "$A_PID" || fail "сеанс A завершился с ошибкой"

"${PSQL_CMD[@]}" -v ON_ERROR_STOP=1 -Atq \
  -c "set lock_timeout = '300ms';
      update public.documents set title = 'b2' where uuid = 's1-conc-u2';" >/dev/null \
  || fail "B не прошёл после commit A"

REV_A=$(q -c "select rev from public.documents where uuid = 's1-conc-u1'")
REV_B=$(q -c "select rev from public.documents where uuid = 's1-conc-u2'")
[ -n "$REV_A" ] && [ -n "$REV_B" ] || fail "не удалось прочитать rev (A=$REV_A B=$REV_B)"
[ "$REV_B" -gt "$REV_A" ] || fail "rev_B ($REV_B) не больше rev_A ($REV_A) после commit"

echo "   ok: B получил 55P03 при открытом A; V прошёл; после commit rev_B=$REV_B > rev_A=$REV_A"

echo "== 2. два многострочных UPDATE U в разном порядке строк — без 40P01"

# Клиентский путь: роль authenticated и JWT-claims. Statement-триггер берёт
# замок по auth.uid(); под сервисной ролью (claims нет) он по устройству
# ничего не делает — тогда порядок обеспечивает только строчный триггер.
"${PSQL_CMD[@]}" -d "$(conninfo sync1-D1)" -v ON_ERROR_STOP=1 -q >/tmp/sync_rev_d1.out 2>&1 <<SQL &
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"$U","role":"authenticated"}', false);
begin;
update public.documents set title = 'd1' where uuid = 's1-conc-u1';
select pg_sleep(1);
update public.documents set title = 'd1' where uuid = 's1-conc-u2';
commit;
SQL
D1_PID=$!

D1_READY=0
for _ in $(seq 1 100); do
  n=$(q -c "select count(*) from pg_stat_activity
            where application_name = 'sync1-D1' and query like '%pg_sleep(1)%'")
  if [ "$n" = "1" ]; then D1_READY=1; break; fi
  sleep 0.1
done
[ "$D1_READY" = "1" ] || { kill "$D1_PID" 2>/dev/null || true; fail "D1 не вошёл в pg_sleep"; }

set +e
OUT_D2=$("${PSQL_CMD[@]}" -v ON_ERROR_STOP=1 -Atq \
  -c '\set VERBOSITY verbose' \
  -c "set role authenticated;
      select set_config('request.jwt.claims', '{\"sub\":\"$U\",\"role\":\"authenticated\"}', false);
      begin;
      update public.documents set title = 'd2' where uuid = 's1-conc-u2';
      update public.documents set title = 'd2' where uuid = 's1-conc-u1';
      commit;" 2>&1)
RC_D2=$?
wait "$D1_PID"
RC_D1=$?
set -e

[ "$RC_D1" -eq 0 ] || fail "D1 упал: $(cat /tmp/sync_rev_d1.out)"
[ "$RC_D2" -eq 0 ] || fail "D2 упал (ожидался только замок, не ошибка): $OUT_D2"
case "$(cat /tmp/sync_rev_d1.out)$OUT_D2" in
  *40P01*|*deadlock*) fail "взаимоблокировка: $(cat /tmp/sync_rev_d1.out) $OUT_D2" ;;
esac
rm -f /tmp/sync_rev_d1.out

echo "   ok: оба многострочных обновления прошли, 40P01 нет"
echo "sync_rev_concurrency: все проверки прошли"
