#!/usr/bin/env bash
# sync_push_concurrency.sh — два сеанса пишут одну строку с одной базой (S2-2).
#
# Запуск — как sync_rev_concurrency.sh (тот же SYNC_REV_PSQL), шаг CI
# «sync_rev guards (0045)» в джобе rls.
#
# Проверка: сеанс A внутри транзакции делает put с базой R и держит строку;
# сеанс B делает put с той же базой R. После commit A у B — `conflict`
# (повторная проверка `rev = base` видит новый rev A), строка — от A.
# Без `sleep`-гонок: B стартует, когда A уже в pg_sleep.

set -euo pipefail

read -r -a PSQL_CMD <<< "${SYNC_REV_PSQL:-psql}"

U=00000000-0000-0000-0000-000000000fb1

q() {
  "${PSQL_CMD[@]}" -v ON_ERROR_STOP=1 -Atq "$@"
}

conninfo() {
  echo "dbname=${PGDATABASE:-postgres} application_name=$1"
}

fail() {
  echo "sync_push_concurrency: FAIL: $*" >&2
  exit 1
}

cleanup() {
  q -c "delete from public.local_store_records where user_id = '$U';
        delete from public.users where uid = '$U';" >/dev/null 2>&1 || true
}
trap cleanup EXIT

AS_U="set request.jwt.claims = '{\"sub\":\"$U\"}'; set role authenticated;"

q -c "delete from public.local_store_records where user_id = '$U';
      delete from public.users where uid = '$U';
      insert into public.users (uid, email, nickname, role) values ('$U', 'sp-conc@test.local', 'SP', 'user');
      insert into public.local_store_records (user_id, store, key, payload)
        values ('$U', 'aiPortrait', 'singleton', '{\"v\":0}');"

R=$(q -c "select rev from public.local_store_records where user_id = '$U'")

item() {
  echo "[{\"table\":\"local_store_records\",\"op\":\"put\",\"store\":\"aiPortrait\",\"key\":\"singleton\",\"base_rev\":$R,\"payload\":{\"v\":\"$1\"}}]"
}

"${PSQL_CMD[@]}" -d "$(conninfo sync2-A)" -v ON_ERROR_STOP=1 -Atq > /tmp/sync_push_conc_a.out <<SQL &
$AS_U
begin;
select public.sync_push('$(item a)'::jsonb)->0->>'status';
select pg_sleep(3);
commit;
SQL
A_PID=$!

for _ in $(seq 1 50); do
  if [ "$(q -c "select count(*) from pg_stat_activity where application_name = 'sync2-A' and query like '%pg_sleep%'")" = "1" ]; then
    break
  fi
  sleep 0.1
done

B=$("${PSQL_CMD[@]}" -d "$(conninfo sync2-B)" -v ON_ERROR_STOP=1 -Atq <<SQL
$AS_U
select public.sync_push('$(item b)'::jsonb)->0->>'status';
SQL
)
wait "$A_PID"
A=$(grep -E '^(ok|conflict)$' /tmp/sync_push_conc_a.out || true)

[ "$A" = "ok" ] || fail "A: ожидался ok, получено «$A»"
[ "$(echo "$B" | grep -E '^(ok|conflict)$')" = "conflict" ] || fail "B: ожидался conflict, получено «$B»"
V=$(q -c "select payload->>'v' from public.local_store_records where user_id = '$U'")
[ "$V" = "a" ] || fail "строка: ожидалось a, получено «$V»"

echo "sync_push_concurrency: ok (A ok, B conflict)"
