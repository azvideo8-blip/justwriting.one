#!/usr/bin/env bash
# Пригласить человека в бету. Запускается НА СЕРВЕРЕ:
#
#   ssh justwriting 'sudo bash /opt/justwriting/deploy/invite.sh someone@example.com'
#
# Регистрация в интерфейсе выключена (LoginPage: SIGNUP_ENABLED = false), и это
# единственная дверь. GoTrue создаёт пользователя и шлёт письмо по шаблону
# public/email/invite.html; ссылка в нём ведёт на /reset-password?type=invite,
# где человек задаёт первый пароль — и на телефоне тоже, потому что ссылка
# несёт token_hash, а не PKCE-код.
#
# Ключ сервисной роли читается из supabase/.env и никуда не печатается.
set -euo pipefail

EMAIL="${1:-}"
case "$EMAIL" in
    *@*.*) ;;
    *) echo "использование: invite.sh <email>" >&2; exit 1 ;;
esac

ENV_FILE=/opt/justwriting/supabase/.env
SERVICE_ROLE_KEY=$(grep -E '^SERVICE_ROLE_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')
if [ -z "$SERVICE_ROLE_KEY" ]; then
    echo "SERVICE_ROLE_KEY не найден в $ENV_FILE" >&2
    exit 1
fi

# Проверяем доступность шаблона письма с token_hash ДО отправки приглашения
TEMPLATE_URL="https://justwriting.ru/email/invite.html"
TEMPLATE_CONTENT=""
AUTH_CONTAINER=$(docker ps --filter "name=auth" --format "{{.Names}}" 2>/dev/null | head -1 || true)
if [ -n "$AUTH_CONTAINER" ]; then
    TEMPLATE_CONTENT=$(docker exec "$AUTH_CONTAINER" curl -sS --max-time 5 "$TEMPLATE_URL" 2>/dev/null || true)
fi
if [ -z "$TEMPLATE_CONTENT" ]; then
    TEMPLATE_CONTENT=$(curl -sS --max-time 5 "$TEMPLATE_URL" 2>/dev/null || true)
fi
if ! echo "$TEMPLATE_CONTENT" | grep -q "token_hash"; then
    echo "ОШИБКА: шаблон $TEMPLATE_URL недоступен или не содержит token_hash!" >&2
    echo "GoTrue откатится на дефолтный шаблон с implicit access_token, который не поддерживается клиентом." >&2
    exit 1
fi

# Через свой же nginx → Kong: тот же путь, что у клиента, никаких внутренних портов.
HTTP_CODE=$(curl -sS -o /tmp/invite-response.json -w '%{http_code}' \
    -X POST "https://justwriting.ru/auth/v1/invite" \
    -H "apikey: $SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\"}")

if [ "$HTTP_CODE" = "200" ]; then
    echo "приглашение отправлено: $EMAIL"
else
    # В теле нет секретов — только сообщение GoTrue (например, «уже зарегистрирован»).
    echo "GoTrue ответил $HTTP_CODE: $(cat /tmp/invite-response.json)" >&2
    exit 1
fi
rm -f /tmp/invite-response.json
