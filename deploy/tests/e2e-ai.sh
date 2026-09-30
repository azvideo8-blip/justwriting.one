#!/usr/bin/env bash
# Live check of the AI service: auth, limits, and whose uid is used.
# По умолчанию — стенд (jw-stand-db из scripts/stand/up.sh, сервис на :3111).
# Ход в боевую базу — только явно: bash e2e-ai.sh --prod (и тогда глобальный
# счётчик ai_global_daily не трогается: вычитание gc1-gc0 вычитало бы и чужие
# вызовы за минуту теста).
set -uo pipefail
BASE=http://127.0.0.1:3111
UID_A=33333333-3333-3333-3333-333333333333
UID_B=44444444-4444-4444-4444-444444444444

MODE=stand
for arg in "$@"; do case "$arg" in --prod) MODE=prod ;; esac; done

if [ "$MODE" = "prod" ]; then
  PSQL() { ssh -o BatchMode=yes justwriting "cd /opt/justwriting/supabase && docker compose exec -T db psql -U postgres -d postgres -X -q -t -A -c \"$1\""; }
else
  : "${STAND_DB:=jw-stand-db}"
  PSQL() { docker exec -i "$STAND_DB" psql -U postgres -d postgres -X -q -t -A -c "$1"; }
fi

# R3-12: секрет — через окружение (аргумент виден в ps), iss — как у GoTrue на сервере.
: "${SUPABASE_JWT_SECRET:?export SUPABASE_JWT_SECRET first}"
export SUPABASE_JWT_SECRET SUPABASE_JWT_ISS="${SUPABASE_JWT_ISS:-supabase}"
mint() {
  python3 - "$1" <<'PY'
import base64,hmac,hashlib,json,os,sys,time
sub,secret,iss=sys.argv[1],os.environ['SUPABASE_JWT_SECRET'],os.environ['SUPABASE_JWT_ISS']
b=lambda x: base64.urlsafe_b64encode(x).rstrip(b'=').decode()
n=int(time.time())
h=b(json.dumps({"alg":"HS256","typ":"JWT"},separators=(',',':')).encode())
p=b(json.dumps({"sub":sub,"role":"authenticated","aud":"authenticated","iss":iss,"iat":n,"exp":n+3600},separators=(',',':')).encode())
print(f"{h}.{p}."+b(hmac.new(secret.encode(),f"{h}.{p}".encode(),hashlib.sha256).digest()))
PY
}

echo "=== seed: two users (FK requires them to exist) ==="
PSQL "insert into users (uid,email,nickname) values ('$UID_A','a@live.test','A'),('$UID_B','b@live.test','B') on conflict do nothing;" >/dev/null
PSQL "delete from ai_daily_limit where uid in ('$UID_A','$UID_B'); delete from ai_cooldown where uid in ('$UID_A','$UID_B');" >/dev/null

# R3-12: тест ходит в боевую базу — запоминаем общий дневной счётчик, чтобы
# вернуть потраченное тестом. Только на стенде: на проде счётчик общий с чужими
# вызовами — не трогаем (R4-049).
if [ "$MODE" = "stand" ]; then
  GLOBAL0=$(PSQL "select coalesce(sum(call_count),0)||' '||coalesce(sum(tokens),0) from ai_global_daily;")
fi

JWT_A=$(mint "$UID_A")
fail=0
BODY='{"data":{"personaId":"coach","messages":[{"role":"user","content":"скажи одно слово: тест"}]}}'

# R5-002: токен — в конфиг curl со stdin (как в supabase/tests/e2e-rls.sh и
# deploy/invite.sh): в argv его видно любому через ps. JWT — из REQ_JWT, если задан.
code() {
  { [ -n "${REQ_JWT:-}" ] && printf 'header = "Authorization: Bearer %s"\n' "$REQ_JWT"; } \
    | curl -sS -o /tmp/lv.out -w '%{http_code}' --max-time 90 --config - "$@"
}

echo
echo "=== 1. no token → expect 401 ==="
c=$(code -X POST -H 'Content-Type: application/json' -d "$BODY" "$BASE/api/chatWithAI")
echo "HTTP $c"; [ "$c" = "401" ] && echo "  ok" || { echo "  FAIL"; fail=1; }

echo
echo "=== 2. valid token → expect 200 ==="
c=$(REQ_JWT="$JWT_A" code -X POST -H 'Content-Type: application/json' -d "$BODY" "$BASE/api/chatWithAI")
echo "HTTP $c — $(head -c 140 /tmp/lv.out)"
[ "$c" = "200" ] && echo "  ok" || { echo "  FAIL"; fail=1; }

echo
echo "=== 3. immediate second call → expect 429 (cooldown) ==="
c=$(REQ_JWT="$JWT_A" code -X POST -H 'Content-Type: application/json' -d "$BODY" "$BASE/api/chatWithAI")
echo "HTTP $c — $(head -c 140 /tmp/lv.out)"
[ "$c" = "429" ] && echo "  ok" || { echo "  FAIL"; fail=1; }

echo
echo "=== 4. uid comes from the token, not the body ==="
echo "counter rows after the calls above:"
PSQL "select uid,kind,call_count from ai_daily_limit where uid in ('$UID_A','$UID_B') order by uid;"
n=$(PSQL "select count(*) from ai_daily_limit where uid='$UID_B';")
[ "$n" = "0" ] && echo "  ok — nothing charged to B" || { echo "  FAIL — B has rows"; fail=1; }

echo
echo "=== 5. usage recorded ==="
PSQL "select uid,date,data from ai_usage where uid='$UID_A';"
PSQL "select date,call_count,tokens from ai_global_daily;"

echo
echo "=== 6. daily cap → expect 429 after the allowance ==="
PSQL "update ai_daily_limit set call_count = 999 where uid='$UID_A' and kind='chat';" >/dev/null
PSQL "update ai_cooldown set updated_at = now() - interval '1 hour' where uid='$UID_A';" >/dev/null
c=$(REQ_JWT="$JWT_A" code -X POST -H 'Content-Type: application/json' -d "$BODY" "$BASE/api/chatWithAI")
echo "HTTP $c — $(head -c 140 /tmp/lv.out)"
[ "$c" = "429" ] && echo "  ok" || { echo "  FAIL"; fail=1; }

echo
echo "=== cleanup ==="
PSQL "delete from ai_usage where uid in ('$UID_A','$UID_B'); delete from ai_daily_limit where uid in ('$UID_A','$UID_B'); delete from ai_cooldown where uid in ('$UID_A','$UID_B'); delete from users where uid in ('$UID_A','$UID_B');" >/dev/null
if [ "$MODE" = "stand" ]; then
  read -r gc0 gt0 <<<"$GLOBAL0"
  read -r gc1 gt1 <<<"$(PSQL "select coalesce(sum(call_count),0)||' '||coalesce(sum(tokens),0) from ai_global_daily;")"
  PSQL "update ai_global_daily set call_count = greatest(0, call_count - $((gc1 - gc0))), tokens = greatest(0, tokens - $((gt1 - gt0))) where date = (select max(date) from ai_global_daily);" >/dev/null
  echo "test rows removed, global daily counter restored"
else
  echo "test rows removed; prod global daily counter left as is (R4-049)"
fi
echo
[ "$fail" = "0" ] && echo "RESULT: all live checks passed" || echo "RESULT: FAILURES"
exit "$fail"
