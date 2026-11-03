#!/usr/bin/env bash
# D-1: единственная команда пользователя backup-pull (forced command в
# authorized_keys). Отдаёт только зашифрованные копии (age) из одного каталога:
#   latest       — имя самой свежей копии
#   sha  <имя>   — строка sha256 этой копии
#   get  <имя>   — содержимое копии
# Всё остальное — отказ. Ключа расшифровки на сервере нет.
set -euo pipefail
DIR=/var/backups/justwriting-offsite
read -r cmd name extra <<< "${SSH_ORIGINAL_COMMAND:-}"
[ -z "${extra:-}" ] || { echo "лишние аргументы" >&2; exit 2; }
valid() { [[ "$1" =~ ^justwriting-[0-9]{8}-[0-9]{6}\.dump\.age$ ]] && [ -f "$DIR/$1" ]; }
case "$cmd" in
    latest) ls -1t "$DIR"/justwriting-*.dump.age 2>/dev/null | head -n 1 | xargs -r basename ;;
    sha) valid "${name:-}" || { echo "нет такой копии" >&2; exit 2; }; cat "$DIR/$name.sha256" ;;
    get) valid "${name:-}" || { echo "нет такой копии" >&2; exit 2; }; cat "$DIR/$name" ;;
    *) echo "разрешено: latest | sha <имя> | get <имя>" >&2; exit 2 ;;
esac
