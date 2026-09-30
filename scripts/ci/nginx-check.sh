#!/usr/bin/env bash
# R5-003 (приёмка L-7): `nginx -t` над deploy/nginx.conf до того, как его руками
# скопируют на сервер. Раньше конфиг проверяли два grep'а — синтаксическая
# ошибка всплывала на живом nginx.
#
# Контейнер той же версии, что на проде (nginx -v → 1.28.x): `http2 on;` и
# прочее принимаются ровно так, как их примет сервер. Сертификаты — подставной
# самоподписанный: -t их читает и разбирает, но наружу ничего не слушает.
# Файл сайта ложится в conf.d/ образа — его nginx.conf подключает conf.d
# внутри http{}, как sites-enabled у Ubuntu.
set -euo pipefail
cd "$(dirname "$0")/../.."

IMAGE=nginx:1.28
CERTS=$(mktemp -d)
trap 'rm -rf "$CERTS"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=nginx-check \
  -keyout "$CERTS/privkey.pem" -out "$CERTS/fullchain.pem" 2>/dev/null
# Контейнер читает ключ от root, но не на каждом демоне тот же uid.
chmod 644 "$CERTS/privkey.pem"

docker run --rm \
  -v "$PWD/deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$PWD/deploy/snippets:/etc/nginx/snippets:ro" \
  -v "$CERTS:/etc/letsencrypt/live/justwriting.ru:ro" \
  -v "$CERTS:/etc/letsencrypt/live/justwriting.online:ro" \
  --entrypoint nginx "$IMAGE" -t
