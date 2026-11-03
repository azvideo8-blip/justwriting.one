#!/usr/bin/env bash
# Опустить стенд: процессы, контейнеры, сеть, ключи.
set -u
cd "$(dirname "$0")/../.."

# GT-3: в .pids записан PID обёртки `npx` (её пишут up.sh, s38-e2e.sh и
# mobile-e2e.sh), а настоящие `vite preview` / `tsx api/server.ts` — её дети.
# `kill` по одному PID гасит обёртку, дети остаются держать порты стенда, и
# следующий подъём падает на EADDRINUSE. Поэтому для каждого PID гасим дерево.
kill_tree() {
  local pid="$1" winpid=""
  if command -v taskkill >/dev/null 2>&1; then
    # Git Bash: PID из `$!` — номер MSYS, а taskkill требует Win32-PID.
    winpid=$(ps -l 2>/dev/null | awk -v p="$pid" '$1==p {print $4; exit}')
    # Формы `//PID` здесь нет намеренно: подъёмы стенда идут с
    # MSYS_NO_PATHCONV=1, и тогда `//PID` доезжает до taskkill буквально
    # («неверный параметр»). Явный префикс работает при любой настройке.
    [ -n "$winpid" ] && MSYS_NO_PATHCONV=1 taskkill /PID "$winpid" /T /F >/dev/null 2>&1
  elif command -v pkill >/dev/null 2>&1; then
    pkill -TERM -P "$pid" >/dev/null 2>&1
  fi
  kill "$pid" 2>/dev/null
  return 0
}

if [ -f scripts/stand/.pids ]; then
  while read -r pid; do [ -n "$pid" ] && kill_tree "$pid"; done < scripts/stand/.pids
  rm -f scripts/stand/.pids
fi

# GT-3 (дополнение, 02.11). Дерево находится по PID обёртки только пока обёртка
# жива. `mobile-e2e.sh:69` убивает её сам (`kill "$API_PID"` до trap'а), и после
# мобильного прогона на :3304 оставался правнук — `node --require tsx/dist/
# preflight.cjs … api/server.ts` (PPID уже несуществующий). Следующий подъём
# стенда на этом порту ловит EADDRINUSE, а тесты отвечают «ответ ИИ не появился».
# Поэтому дополнительно снимаем то, что слушает СОБСТВЕННЫЕ node-порты стенда
# (прокси, vite, api, заглушка ИИ). Опубликованные Docker-порты (pg/auth/rest) не
# трогаем: их держит не стенд, а com.docker.backend.
node_port_pids() {
  local port="$1"
  netstat -ano 2>/dev/null | grep -i LISTENING | grep -E "[:.]${port}[[:space:]]" | awk '{print $5}'
}

release_port() {
  local port="$1" pid
  [ -n "$port" ] || return 0
  for pid in $(node_port_pids "$port"); do
    # «Чей» это процесс, решаем по Win32-имени: осиротевший правнук уже не виден
    # в MSYS-`ps` (родитель умер — переподчинение), а `tasklist` знает, что это
    # node.exe. Слушатели pg/auth/rest (com.docker.backend) под фильтр не попадают.
    MSYS_NO_PATHCONV=1 tasklist /FI "PID eq $pid" /NH /FO CSV 2>/dev/null | grep -qi '^"node\.exe"' || continue
    MSYS_NO_PATHCONV=1 taskkill /PID "$pid" /T /F >/dev/null 2>&1
  done
  return 0
}

if command -v taskkill >/dev/null 2>&1; then
  for p in "${STAND_PORT:-}" "${STAND_VITE_PORT:-}" "${STAND_API_PORT:-}" "${AI_STUB_PORT:-}" \
           "$(sed -n 's/^STAND_URL=.*localhost:\([0-9]\{1,\}\).*$/\1/p' scripts/stand/.env.stand 2>/dev/null)"; do
    release_port "$p"
  done
fi

docker rm -f jw-stand-db jw-stand-auth jw-stand-rest >/dev/null 2>&1
docker network rm jw-stand >/dev/null 2>&1
rm -f scripts/stand/.env.stand
exit 0
