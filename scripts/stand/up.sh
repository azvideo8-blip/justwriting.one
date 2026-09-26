#!/usr/bin/env bash
# Локальный стенд без прода: Postgres + GoTrue + PostgREST в docker, наши
# миграции, Vite и прокси на :3000. Ключи и пароли генерируются на каждый
# подъём и лежат только в scripts/stand/.env.stand (в .gitignore).
#
#   bash scripts/stand/up.sh && npx playwright test -c playwright.stand.config.ts && bash scripts/stand/down.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

STAND_PORT="${STAND_PORT:-3000}"          # прокси, сюда ходит браузер
STAND_VITE_PORT="${STAND_VITE_PORT:-3010}"
STAND_GOTRUE_PORT="${STAND_GOTRUE_PORT:-9999}"
STAND_REST_PORT="${STAND_REST_PORT:-3003}"
STAND_PG_PORT="${STAND_PG_PORT:-5440}"    # 5439 занят воротами (gates.yml)
NET=jw-stand
DB=jw-stand-db; AUTH=jw-stand-auth; REST=jw-stand-rest
ENV_FILE=scripts/stand/.env.stand
PIDS=scripts/stand/.pids

bash scripts/stand/down.sh >/dev/null 2>&1 || true

node scripts/stand/keys.mjs > "$ENV_FILE"
# shellcheck disable=SC1090
source "$ENV_FILE"
cat >> "$ENV_FILE" <<ENV
STAND_URL=http://localhost:${STAND_PORT}
STAND_GOTRUE_URL=http://localhost:${STAND_GOTRUE_PORT}
ENV

docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" -p "127.0.0.1:${STAND_PG_PORT}:5432" \
  -e POSTGRES_PASSWORD=pg supabase/postgres:17.6.1.136 >/dev/null
echo "стенд: жду postgres"
# По TCP: временный сервер initdb слушает только сокет и потом перезапускается.
for _ in $(seq 1 60); do
  docker exec "$DB" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break
  sleep 1
done
# В образе supabase/postgres суперпользователь — supabase_admin, а `postgres` понижен.
docker exec -i "$DB" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
alter role supabase_auth_admin login password 'pg';
alter role authenticator login password 'pg';
alter role supabase_auth_admin set search_path to auth;
SQL

docker run -d --name "$AUTH" --network "$NET" -p "127.0.0.1:${STAND_GOTRUE_PORT}:9999" \
  -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 \
  -e API_EXTERNAL_URL="http://localhost:${STAND_PORT}/auth/v1" \
  -e GOTRUE_DB_DRIVER=postgres \
  -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:pg@${DB}:5432/postgres" \
  -e GOTRUE_SITE_URL="http://localhost:${STAND_PORT}" \
  -e GOTRUE_URI_ALLOW_LIST="http://localhost:${STAND_PORT}/*" \
  -e GOTRUE_JWT_SECRET="$JWT_SECRET" -e GOTRUE_JWT_EXP=3600 \
  -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_ADMIN_ROLES=service_role \
  -e GOTRUE_JWT_AUD=authenticated \
  -e GOTRUE_DISABLE_SIGNUP=true \
  -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
  -e GOTRUE_EXTERNAL_PHONE_ENABLED=false -e GOTRUE_SMS_AUTOCONFIRM=false \
  supabase/gotrue:v2.189.0 >/dev/null
echo "стенд: жду gotrue"
for _ in $(seq 1 60); do
  curl -fsS "http://localhost:${STAND_GOTRUE_PORT}/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://localhost:${STAND_GOTRUE_PORT}/health" >/dev/null

echo "стенд: миграции"
for f in supabase/migrations/*.sql; do
  docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 -q < "$f"
done

docker run -d --name "$REST" --network "$NET" -p "127.0.0.1:${STAND_REST_PORT}:3000" \
  -e PGRST_DB_URI="postgres://authenticator:pg@${DB}:5432/postgres" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="$JWT_SECRET" -e PGRST_DB_USE_LEGACY_GUCS=false \
  postgrest/postgrest:v14.12 >/dev/null

: > "$PIDS"
VITE_SUPABASE_URL="http://localhost:${STAND_PORT}" VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
  npx vite --port "$STAND_VITE_PORT" --strictPort > scripts/stand/vite.log 2>&1 &
echo $! >> "$PIDS"
STAND_PORT="$STAND_PORT" STAND_VITE_PORT="$STAND_VITE_PORT" STAND_GOTRUE_PORT="$STAND_GOTRUE_PORT" STAND_REST_PORT="$STAND_REST_PORT" \
  node scripts/stand/proxy.mjs > scripts/stand/proxy.log 2>&1 &
echo $! >> "$PIDS"

echo "стенд: жду vite и postgrest"
for _ in $(seq 1 90); do
  curl -fsS "http://localhost:${STAND_PORT}/login" >/dev/null 2>&1 \
    && curl -fsS "http://localhost:${STAND_PORT}/rest/v1/" -H "apikey: $ANON_KEY" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://localhost:${STAND_PORT}/login" >/dev/null
curl -fsS "http://localhost:${STAND_PORT}/rest/v1/" -H "apikey: $ANON_KEY" >/dev/null
echo "стенд поднят: http://localhost:${STAND_PORT} (ключи в $ENV_FILE)"
