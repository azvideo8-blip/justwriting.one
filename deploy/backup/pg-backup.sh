#!/usr/bin/env bash
# Резервная копия базы justwriting.
#
# Копия рядом с базой копией не является: она спасает от «уронил таблицу», но не
# от потери машины. Поэтому скрипт делает свою половину работы — снимает дамп,
# проверяет его и удерживает историю, — а увоз на другую машину настраивается
# отдельно (см. B4 в docs/migration-plan.md).
#
# Формат custom (-Fc): сжат, восстанавливается выборочно, переживает смену
# версии сервера лучше простого текста.
set -euo pipefail
umask 077

# N-92: обязательный состав дампа. auth.users и public.local_store_records —
# таблицы, чья потеря уже случалась; дамп без них не копия, а надежда.
check_toc() {
    local toc_file="$1" entry
    for entry in "auth users" "public users" "public documents" "public versions" "public local_store_records"; do
        if ! grep -q "TABLE DATA $entry" "$toc_file"; then
            echo "ОШИБКА: в дампе нет данных таблицы $entry" >&2
            return 1
        fi
    done
}

# --check-toc <файл-оглавление>: только проверка состава, без дампа.
# Для стенда и тестов: pg-backup.sh --check-toc <(pg_restore --list dump.dump)
if [ "${1:-}" = "--check-toc" ]; then
    if [ -z "${2:-}" ] || [ ! -f "$2" ]; then
        echo "ОШИБКА: --check-toc требует путь к файлу оглавления" >&2
        exit 1
    fi
    check_toc "$2"
    exit $?
fi

DEST=/var/backups/justwriting
KEEP_DAILY=14
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="$DEST/justwriting-$STAMP.dump"

install -d -m 700 "$DEST"

# R3-11: дамп пишется во временный файл и получает имя .dump только после
# проверки — иначе оборванный pg_dump (set -e) оставлял «свежую» копию, которую
# монитор считал годной. Оглавление — во временный файл с непредсказуемым именем.
TMP="$FILE.partial"
TOC=$(mktemp)
trap 'rm -f "$TMP" "$TOC"' EXIT

# pg_dump живёт в контейнере: на хосте клиента нет, а ставить его ради этого
# значит следить ещё и за совпадением версий.
docker exec supabase-db pg_dump -U postgres -d postgres -Fc --no-owner > "$TMP"

# Дамп, который никто не открывал, — не копия, а надежда. Проверяем, что файл
# читается штатным инструментом и содержит ожидаемые таблицы.
if ! docker exec -i supabase-db pg_restore --list < "$TMP" > "$TOC" 2>/dev/null; then
    echo "ОШИБКА: дамп $FILE не читается pg_restore" >&2
    exit 1
fi

check_toc "$TOC" || exit 1

mv "$TMP" "$FILE"
sha256sum "$FILE" > "$FILE.sha256"
SIZE=$(du -h "$FILE" | cut -f1)

# Ротация: держим последние N дампов вместе с их контрольными суммами.
ls -1t "$DEST"/justwriting-*.dump 2>/dev/null | tail -n +$((KEEP_DAILY + 1)) | while read -r old; do
    rm -f "$old" "$old.sha256"
done

COUNT=$(ls -1 "$DEST"/justwriting-*.dump 2>/dev/null | wc -l)
echo "копия готова: $FILE ($SIZE), в хранилище $COUNT шт."
