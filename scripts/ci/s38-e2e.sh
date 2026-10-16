#!/usr/bin/env bash
# R7Q-035: стендовые спеки двух устройств (e2e/*.stand.spec.ts, конфиг
# playwright.s38.config.ts) раньше не гонялись ни в одном пайплайне — их
# запускал только человек, который помнил команду. Скрипт делает этот запуск
# одним шагом ворот: поднимает стенд, стартует API с заглушкой ИИ, гасит всё по
# trap'у при любом исходе.
#
#   bash scripts/ci/s38-e2e.sh                       # весь набор
#   bash scripts/ci/s38-e2e.sh e2e/dialogueSync.stand.spec.ts
#   S38_E2E_LIST=1 bash scripts/ci/s38-e2e.sh        # только проверка, что спеки находятся
#
# Спеки старого клиента идут в набор только вместе с двумя поднятыми сборками
# 0.9.29 и 0.9.28: задайте STAND_OLD_029 и STAND_OLD_028 адресами этих сборок —
# без них обёртка исключает именно эти три спека (см. ниже в теле скрипта).
#
# Порты — свои (не :3000: на VPS-раннере его держит продовый API; не 3100/3300:
# это стенды шага «смена аккаунта» и мобильных ворот, up.sh на занятом порту
# отказывается стартовать).

set -uo pipefail
cd "$(dirname "$0")/../.."

export STAND_PORT="${STAND_PORT:-3600}"
export STAND_VITE_PORT="${STAND_VITE_PORT:-3610}"
export STAND_GOTRUE_PORT="${STAND_GOTRUE_PORT:-8699}"
export STAND_REST_PORT="${STAND_REST_PORT:-3016}"
export STAND_PG_PORT="${STAND_PG_PORT:-5443}"
export STAND_API_PORT="${STAND_API_PORT:-3604}"
AI_STUB_PORT="${AI_STUB_PORT:-3605}"
PIDS_FILE=scripts/stand/.pids

cleanup() { bash scripts/stand/down.sh >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== стенд на :${STAND_PORT} (vite :${STAND_VITE_PORT}, auth :${STAND_GOTRUE_PORT}, rest :${STAND_REST_PORT}, pg :${STAND_PG_PORT}, api :${STAND_API_PORT}, заглушка :${AI_STUB_PORT})"
bash scripts/stand/up.sh || { echo "up.sh упал" >&2; exit 1; }
# shellcheck disable=SC1091
set -a; . scripts/stand/.env.stand; set +a

# PID'ы API и заглушки дописываются в .pids стенда: down.sh читает именно этот
# файл. Без них осиротевший node-процесс на :3604 держит порт, и следующий
# подъём стенда падает на «порт занят» — а чужие процессы трогать нельзя.
STAND_AI_STUB_PORT="$AI_STUB_PORT" node scripts/stand/ai-stub.mjs > scripts/stand/ai-stub.log 2>&1 &
echo $! >> "$PIDS_FILE"

PORT="$STAND_API_PORT" \
  DATABASE_URL="postgres://postgres:pg@127.0.0.1:${STAND_PG_PORT}/postgres" \
  SUPABASE_JWT_SECRET="$JWT_SECRET" REQUIRE_JWT_ISSUER=false \
  OPENROUTER_API_KEY=stand-dummy \
  AI_BASE_URL="http://127.0.0.1:${AI_STUB_PORT}/v1" AI_EMBED_BASE_URL="http://127.0.0.1:${AI_STUB_PORT}/v1" \
  AI_DAILY_LIMIT=500 AI_INTERNAL_CHAT_DAILY_LIMIT=2000 \
  AI_TIER_TPD=1000000000 AI_TIER_TPM=100000000 AI_TIER_RPD=100000 \
  npx tsx api/server.ts > scripts/stand/api.log 2>&1 &
echo $! >> "$PIDS_FILE"

# 502 — прокси жив, API ещё нет; 000 — нет ответа. Готов — любой другой код
# (404 тоже: запрос дошёл до API).
for _ in $(seq 1 60); do
  case "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:${STAND_PORT}/api/healthcheck")" in
    000|502|503) sleep 1 ;;
    *) break ;;
  esac
done
api_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:${STAND_PORT}/api/healthcheck")
echo "api/healthcheck = ${api_code} (404 = дошёл до API, 503 = API не подключён)"
if [ "$api_code" = "000" ] || [ "$api_code" = "502" ] || [ "$api_code" = "503" ]; then
  echo "API на стенде не поднялся — см. scripts/stand/api.log" >&2
  tail -20 scripts/stand/api.log >&2 || true
  exit 1
fi

args=(-c playwright.s38.config.ts)
# Спеки старого клиента («…0.9.29…», «…созданный на 0.9.28», «0.9.29 воскрешает…»)
# ходят на собранные бандлы 0.9.29 и 0.9.28 — их отдают отдельные клоны
# (~/jw-029, ~/jw-028), пересобраны под JWT/anon-ключи именно этого подъёма
# стенда, и адресуются через STAND_OLD_029 / STAND_OLD_028. Без них спек 10
# падает на ERR_CONNECTION_REFUSED, а из-за serial-режима в файле за ним
# снимаются ещё десять спеков: прогон выглядит как дефект продукта, которым он
# не является. Поэтому без обоих адресов эти три спека исключаются явно и об
# этом печатается число.
if [ -z "${STAND_OLD_029:-}" ] || [ -z "${STAND_OLD_028:-}" ]; then
  echo "== старые клиенты не заданы (STAND_OLD_029 / STAND_OLD_028) — исключаю 3 спека 0.9.28/0.9.29"
  args+=(--grep-invert '0\.9\.2[89]')
fi
if [ "$#" -gt 0 ]; then
  args+=("$@")
fi
if [ "${S38_E2E_LIST:-0}" = "1" ]; then
  STAND_URL="http://localhost:${STAND_PORT}" npx playwright test "${args[@]}" --list
  exit $?
fi

STAND_URL="http://localhost:${STAND_PORT}" npx playwright test "${args[@]}"
