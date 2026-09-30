#!/usr/bin/env bash
# Проверка снаружи: отвечает ли justwriting.ru.
#
# Запускается НА НОУТБУКЕ. Смысл именно в этом: проверка, живущая на сервере, не
# может сообщить, что сервер умер — она умрёт вместе с ним. Здесь нарочно нет
# никаких зависимостей и учётных данных: curl и системное уведомление.
#
# Два подряд неудачных ответа считаются поломкой: одиночный сбой чаще означает
# потерянный wi-fi, чем упавший сервер, и уведомление на каждый такой случай
# быстро научит его игнорировать.
set -uo pipefail

# Проверяется /ready (L-7, R4-062): он проксируется к API и отвечает 200, только
# когда живы зависимости (БД). «/» отвечал 200 текстом SPA даже при зависшем
# пуле БД — поломка была невидима.
URL=https://justwriting.ru/ready
STATE="$HOME/.justwriting-site-check"

CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$URL" || echo 000)
FAILS=$(cat "$STATE" 2>/dev/null || echo 0)

if [ "$CODE" = "200" ]; then
    # Восстановилось после поломки — сказать об этом, иначе непонятно, чем всё кончилось.
    if [ "$FAILS" -ge 2 ]; then
        osascript -e 'display notification "Сайт снова отвечает" with title "justwriting"' 2>/dev/null || true
    fi
    echo 0 > "$STATE"
    exit 0
fi

FAILS=$((FAILS + 1))
echo "$FAILS" > "$STATE"

if [ "$FAILS" -eq 2 ]; then
    osascript -e "display notification \"justwriting.ru не отвечает (код $CODE). Проверено дважды подряд.\" with title \"justwriting: сайт недоступен\" sound name \"Basso\"" 2>/dev/null || true
fi

echo "$(date '+%F %T') код $CODE, неудач подряд: $FAILS"
