#!/usr/bin/env bash
# Сквозная проверка изоляции данных через настоящий стек: Kong → PostgREST → RLS.
# CI проверяет политики на голом Postgres; здесь проверяется то, что CI не видит —
# что JWT действительно доходит до политик, а права ролей не рубят запрос раньше.
# Все тестовые строки удаляются в конце.
set -euo pipefail
cd /opt/justwriting/supabase

ANON_KEY=$(grep -m1 '^ANON_KEY=' .env | cut -d= -f2-)
JWT_SECRET=$(grep -m1 '^JWT_SECRET=' .env | cut -d= -f2-)

A=11111111-1111-1111-1111-111111111111   # Алиса
B=22222222-2222-2222-2222-222222222222   # Боб

# L-8 (R4-048): секрет — в окружение процесса, не в argv (его видно в ps всем
# пользователям машины).
mint() {  # $1 = sub (uuid) → JWT роли authenticated
  JWT_SECRET="$JWT_SECRET" python3 - "$1" <<'PY'
import base64, hmac, hashlib, json, os, sys, time
sub, secret = sys.argv[1], os.environ["JWT_SECRET"]
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b'=').decode()
now = int(time.time())
h = b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(',',':')).encode())
p = b64(json.dumps({"sub":sub,"role":"authenticated","aud":"authenticated",
                    "iss":"supabase","iat":now,"exp":now+3600},separators=(',',':')).encode())
sig = b64(hmac.new(secret.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest())
print(f"{h}.{p}.{sig}")
PY
}

# Токен — в конфиг curl со stdin (как в deploy/invite.sh): в ps аргументы не светятся.
req() {  # $1 = URL; JWT берётся из REQ_JWT, если задан
  { [ -n "${REQ_JWT:-}" ] && printf 'header = "Authorization: Bearer %s"\n' "$REQ_JWT";
    printf 'header = "apikey: %s"\n' "$ANON_KEY"; } | curl -sS --max-time 15 --config - "$@"
}

echo "=== засеваем: у Алисы и Боба по одной заметке ==="
docker compose exec -T db psql -U postgres -d postgres -X -q <<SQL
insert into public.users (uid, email, nickname) values
  ('$A','alice@e2e.test','Alice'), ('$B','bob@e2e.test','Bob')
  on conflict do nothing;
insert into public.documents (uuid, user_id, title) values
  ('e2e-alice-doc','$A','Записка Алисы'), ('e2e-bob-doc','$B','Тайна Боба')
  on conflict do nothing;
SQL

JWT_A=$(mint "$A")
fail=0

echo
echo "=== 1. Алиса запрашивает все документы ==="
body=$(REQ_JWT="$JWT_A" req "http://127.0.0.1:8000/rest/v1/documents?select=uuid,title")
echo "ответ: $body"
echo "$body" | grep -q 'e2e-alice-doc' \
  && echo "  ✓ свою заметку видит" || { echo "  ✗ свою заметку НЕ видит"; fail=1; }
echo "$body" | grep -q 'e2e-bob-doc' \
  && { echo "  ✗ ВИДИТ ЧУЖУЮ — изоляция сломана"; fail=1; } || echo "  ✓ чужую не видит"

echo
echo "=== 2. Алиса адресно запрашивает заметку Боба ==="
body=$(REQ_JWT="$JWT_A" req \
  "http://127.0.0.1:8000/rest/v1/documents?uuid=eq.e2e-bob-doc&select=uuid,title")
echo "ответ: $body"
[ "$(echo "$body" | tr -d '[:space:]')" = "[]" ] \
  && echo "  ✓ пусто, как и должно быть" || { echo "  ✗ что-то вернулось"; fail=1; }

echo
echo "=== 3. Аноним без токена ==="
body=$(req "http://127.0.0.1:8000/rest/v1/documents?select=uuid,title")
echo "ответ: $body"
[ "$(echo "$body" | tr -d '[:space:]')" = "[]" ] \
  && echo "  ✓ ничего не отдано" || { echo "  ✗ аноним что-то получил"; fail=1; }

echo
echo "=== 4. Алиса пытается записать заметку от имени Боба ==="
code=$(curl -sS -o /tmp/e2e-ins.txt -w '%{http_code}' --max-time 15 \
  -X POST -H 'Content-Type: application/json' \
  -d "{\"uuid\":\"e2e-forged\",\"user_id\":\"$B\",\"title\":\"подделка\"}" \
  --config - <<CURLCFG
header = "apikey: $ANON_KEY"
header = "Authorization: Bearer $JWT_A"
url = "http://127.0.0.1:8000/rest/v1/documents"
CURLCFG
)
echo "HTTP $code — $(cat /tmp/e2e-ins.txt | head -c 160)"
[ "$code" = "403" ] || [ "$code" = "401" ] \
  && echo "  ✓ запись отклонена" || { echo "  ✗ подделка прошла"; fail=1; }

echo
echo "=== уборка ==="
docker compose exec -T db psql -U postgres -d postgres -X -q <<SQL
delete from public.documents where uuid in ('e2e-alice-doc','e2e-bob-doc','e2e-forged');
delete from public.users where uid in ('$A','$B');
SQL
rm -f /tmp/e2e-ins.txt
docker compose exec -T db psql -U postgres -d postgres -X -q -c \
  "select count(*) as documents_left from public.documents;"

echo
[ "$fail" = "0" ] && echo "ИТОГ: все проверки пройдены" || echo "ИТОГ: ЕСТЬ ПРОВАЛЫ"
exit "$fail"
