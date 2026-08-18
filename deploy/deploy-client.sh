#!/usr/bin/env bash
# Выкатка собранного клиента на сервер.
#
# Ключевое отличие от простого «rsync --delete»: старые файлы из assets/ НЕ
# удаляются сразу. Страница, открытая до выкатки, продолжает по мере надобности
# подгружать куски того бандла, из которого она загрузилась. Удалить их значит
# сломать приложение у того, кто в этот момент пишет: именно так 18 августа
# посыпался график скорости письма — «Failed to fetch dynamically imported
# module: WpmChart-D9aAQgDs.js».
#
# Имена кусков содержат хэш содержимого, поэтому старые и новые не конфликтуют.
# Они лишь копятся, и их достаточно подчищать по возрасту.
#
#   bash deploy/deploy-client.sh
#
set -euo pipefail

HOST=justwriting
KEEP_DAYS=14

[ -d dist ] || { echo "нет каталога dist — сначала npm run build" >&2; exit 1; }

echo "1/4 · отправляю сборку…"
rsync -az -e "ssh -o ServerAliveInterval=15" dist/ "$HOST:/tmp/dist-new/"

echo "2/4 · раскладываю (старые куски остаются)…"
# Без --delete: всё новое перезаписывает одноимённое, старые куски остаются
# лежать для уже открытых страниц.
ssh "$HOST" "sudo rsync -a /tmp/dist-new/ /var/www/justwriting/ && \
             sudo mkdir -p /var/www/justwriting/email && \
             sudo rsync -a /tmp/email/ /var/www/justwriting/email/ 2>/dev/null || true; \
             sudo chown -R www-data:www-data /var/www/justwriting"

echo "3/4 · убираю куски старше $KEEP_DAYS дней…"
ssh "$HOST" "sudo find /var/www/justwriting/assets -type f -mtime +$KEEP_DAYS -delete; \
             ls -1 /var/www/justwriting/assets | wc -l | xargs printf '  осталось файлов: %s\n'"

echo "4/4 · проверяю…"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://justwriting.ru/)
[ "$code" = "200" ] || { echo "сайт отвечает $code" >&2; exit 1; }
ver=$(ssh "$HOST" "grep -oE \"v[0-9]+[.][0-9]+[.][0-9]+\" /var/www/justwriting/sw.js | head -1")
echo "готово: сайт 200, версия $ver"
