#!/usr/bin/env bash
# MB-12: мобильные e2e-спеки (e2e/mobile/*.spec.ts) на локальном стенде.
#
# Мобильный макет открывается по праву аккаунта (MB-1), право отдаёт база, значит
# спекам нужен настоящий стек: GoTrue + PostgREST + Postgres + собранный фронт и
# api/server.ts с заглушкой ИИ. Порты — свои (не :3000: на VPS-раннере его держит
# продовый API, и up.sh на занятом порту отказывается стартовать).
#
#   bash scripts/ci/mobile-e2e.sh                 # поднять стенд, прогнать, погасить
#   MOBILE_E2E_LIST=1 bash scripts/ci/mobile-e2e.sh   # только проверка, что спеки находятся
#
# Переживаемость: стенд поднимается в этой же оболочке и гасится по trap'у; фоном
# его оставлять нельзя (группа процессов умирает вместе с запуском — см. runbook).
set -uo pipefail
cd "$(dirname "$0")/../.."

export STAND_PORT="${STAND_PORT:-3300}"
export STAND_VITE_PORT="${STAND_VITE_PORT:-3310}"
export STAND_GOTRUE_PORT="${STAND_GOTRUE_PORT:-8999}"
export STAND_REST_PORT="${STAND_REST_PORT:-3013}"
export STAND_PG_PORT="${STAND_PG_PORT:-5442}"
export STAND_API_PORT="${STAND_API_PORT:-3304}"
AI_STUB_PORT="${AI_STUB_PORT:-3305}"
PROJECT="${MOBILE_E2E_PROJECT:-Mobile Chrome}"

cleanup() { bash scripts/stand/down.sh >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== стенд на :${STAND_PORT} (vite :${STAND_VITE_PORT}, auth :${STAND_GOTRUE_PORT}, rest :${STAND_REST_PORT}, pg :${STAND_PG_PORT}, api :${STAND_API_PORT}, заглушка ИИ :${AI_STUB_PORT})"
bash scripts/stand/up.sh || { echo "up.sh упал" >&2; exit 1; }
# shellcheck disable=SC1091
set -a; . scripts/stand/.env.stand; set +a

# R7Q-033: PID'ы дописываются в .pids стенда. Их читает down.sh, который
# вызывается и по trap'у, и руками: без записи осиротевший node держит порт, и
# следующий подъём падает на «порт занят» — а убивать придётся чужой процесс.
STAND_AI_STUB_PORT="$AI_STUB_PORT" node scripts/stand/ai-stub.mjs > scripts/stand/ai-stub.log 2>&1 &
echo $! >> scripts/stand/.pids
PORT="$STAND_API_PORT" \
  DATABASE_URL="postgres://postgres:pg@127.0.0.1:${STAND_PG_PORT}/postgres" \
  SUPABASE_JWT_SECRET="$JWT_SECRET" REQUIRE_JWT_ISSUER=false \
  OPENROUTER_API_KEY=stand-dummy \
  AI_BASE_URL="http://127.0.0.1:${AI_STUB_PORT}/v1" AI_EMBED_BASE_URL="http://127.0.0.1:${AI_STUB_PORT}/v1" \
  AI_DAILY_LIMIT=500 AI_INTERNAL_CHAT_DAILY_LIMIT=2000 \
  AI_TIER_TPD=1000000000 AI_TIER_TPM=100000000 AI_TIER_RPD=100000 \
  npx tsx api/server.ts > scripts/stand/api.log 2>&1 &
API_PID=$!
echo "$API_PID" >> scripts/stand/.pids

# 502 — прокси жив, а API ещё нет; 000 — нет ответа. Готов — любой другой код
# (404 тоже: запрос дошёл до API). Раньше 502 считался готовностью.
for _ in $(seq 1 60); do
  case "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:${STAND_PORT}/api/healthcheck")" in
    000|502|503) sleep 1 ;;
    *) break ;;
  esac
done
echo "фронт=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${STAND_PORT}/login") rest=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${STAND_PORT}/rest/v1/" -H "apikey: $ANON_KEY") api=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${STAND_PORT}/api/healthcheck") (404 = дошёл до API, 503 = API не подключён)"

if [ "${MOBILE_E2E_LIST:-0}" = "1" ]; then
  STAND_URL="http://localhost:${STAND_PORT}" npx playwright test -c playwright.mobile.config.ts --list
  exit $?
fi

STAND_URL="http://localhost:${STAND_PORT}" npx playwright test -c playwright.mobile.config.ts --project="$PROJECT"
rc=$?
# Дожидать и убивать сам API не нужно по-прежнему: trap → down.sh, а он читает
# .pids, куда записаны оба процесса.
kill "$API_PID" >/dev/null 2>&1 || true
exit "$rc"
