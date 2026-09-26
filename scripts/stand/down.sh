#!/usr/bin/env bash
# Опустить стенд: процессы, контейнеры, сеть, ключи.
set -u
cd "$(dirname "$0")/../.."
if [ -f scripts/stand/.pids ]; then
  while read -r pid; do [ -n "$pid" ] && kill "$pid" 2>/dev/null; done < scripts/stand/.pids
  rm -f scripts/stand/.pids
fi
docker rm -f jw-stand-db jw-stand-auth jw-stand-rest >/dev/null 2>&1
docker network rm jw-stand >/dev/null 2>&1
rm -f scripts/stand/.env.stand
exit 0
