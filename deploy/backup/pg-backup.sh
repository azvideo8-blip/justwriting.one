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

DEST=/var/backups/justwriting
KEEP_DAILY=14
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="$DEST/justwriting-$STAMP.dump"

install -d -m 700 "$DEST"

# pg_dump живёт в контейнере: на хосте клиента нет, а ставить его ради этого
# значит следить ещё и за совпадением версий.
docker exec supabase-db pg_dump -U postgres -d postgres -Fc --no-owner > "$FILE"

# Дамп, который никто не открывал, — не копия, а надежда. Проверяем, что файл
# читается штатным инструментом и содержит ожидаемые таблицы.
if ! docker exec -i supabase-db pg_restore --list < "$FILE" > /tmp/backup-toc.txt 2>/dev/null; then
    echo "ОШИБКА: дамп $FILE не читается pg_restore" >&2
    rm -f "$FILE"
    exit 1
fi

for t in users documents versions; do
    if ! grep -q "TABLE DATA public $t" /tmp/backup-toc.txt; then
        echo "ОШИБКА: в дампе нет данных таблицы $t" >&2
        rm -f "$FILE"
        exit 1
    fi
done

sha256sum "$FILE" > "$FILE.sha256"
SIZE=$(du -h "$FILE" | cut -f1)

# Ротация: держим последние N дампов вместе с их контрольными суммами.
ls -1t "$DEST"/justwriting-*.dump 2>/dev/null | tail -n +$((KEEP_DAILY + 1)) | while read -r old; do
    rm -f "$old" "$old.sha256"
done

COUNT=$(ls -1 "$DEST"/justwriting-*.dump 2>/dev/null | wc -l)
echo "копия готова: $FILE ($SIZE), в хранилище $COUNT шт."
