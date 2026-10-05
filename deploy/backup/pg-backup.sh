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

# R5-056: «дамп читается» ≠ «в дампе есть данные». Счётчики строк ключевых
# таблиц (auth.users public.users documents versions local_store_records)
# сравниваются с прошлой копией по правилу restore-drill.sh: где раньше было
# хотя бы 10 строк, а стало меньше половины, — обвал.
check_counts() {
    local -a prev new
    read -r -a prev <<< "$1"
    read -r -a new <<< "$2"
    local i
    for i in 0 1 2 3 4; do
        if ! [[ "${prev[i]:-}" =~ ^[0-9]+$ && "${new[i]:-}" =~ ^[0-9]+$ ]]; then
            echo "ОШИБКА: нечисловые счётчики строк: было «$1», стало «$2»" >&2
            return 1
        fi
        if [ "${prev[i]}" -ge 10 ] && [ $((new[i] * 2)) -lt "${prev[i]}" ]; then
            echo "ОБВАЛ: строк было «$1», стало «$2» (auth.users users documents versions local_store_records)" >&2
            return 1
        fi
    done
}

if [ "${1:-}" = "--check-counts" ]; then
    check_counts "${2:-}" "${3:-}"
    exit $?
fi

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
# Отметка об обвале: пока она лежит, ротация стоит (иначе 14 ночей вытеснят
# последние копии «до удаления»), а монитор шлёт письмо. Снимает владелец,
# убедившись, что удаление было намеренным: sudo rm <этот файл>.
SHRINK_MARK="$DEST/SHRINK-ALERT"
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="$DEST/justwriting-$STAMP.dump"

install -d -m 700 "$DEST"

# R3-11: дамп пишется во временный файл и получает имя .dump только после
# проверки — иначе оборванный pg_dump (set -e) оставлял «свежую» копию, которую
# монитор считал годной. Оглавление — во временный файл с непредсказуемым именем.
TMP="$FILE.partial"
TOC=$(mktemp)
trap 'rm -f "$TMP" "$TOC"' EXIT

# Счётчики — до дампа и отдельным запросом: секунды расхождения для порога
# «вдвое» не важны. Сбой подсчёта не отменяет копию, но и не молчит.
COUNTS=$(docker exec supabase-db psql -U postgres -d postgres -tAc \
    "select (select count(*) from auth.users)||' '||(select count(*) from public.users)||' '||(select count(*) from public.documents)||' '||(select count(*) from public.versions)||' '||(select count(*) from public.local_store_records)") \
    || COUNTS=""
if ! [[ "$COUNTS" =~ ^[0-9]+( [0-9]+){4}$ ]]; then
    echo "ПРЕДУПРЕЖДЕНИЕ: не удалось посчитать строки («${COUNTS}») — сравнение с прошлой копией пропущено" >&2
    COUNTS=""
fi

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

SHRUNK=0
if [ -n "$COUNTS" ]; then
    PREV_COUNTS_FILE=$(ls -1t "$DEST"/justwriting-*.dump.counts 2>/dev/null | head -n 1 || true)
    echo "$COUNTS" > "$FILE.counts"
    if [ -n "$PREV_COUNTS_FILE" ] && ! SHRINK_MSG=$(check_counts "$(cat "$PREV_COUNTS_FILE")" "$COUNTS" 2>&1); then
        echo "$SHRINK_MSG" >&2
        printf '%s %s\n%s\nпрошлая копия: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$FILE" "$SHRINK_MSG" "${PREV_COUNTS_FILE%.counts}" >> "$SHRINK_MARK"
        SHRUNK=1
    fi
fi

# Ротация: держим последние N дампов вместе с их контрольными суммами.
if [ -e "$SHRINK_MARK" ]; then
    echo "ротация остановлена: есть $SHRINK_MARK" >&2
else
    ls -1t "$DEST"/justwriting-*.dump 2>/dev/null | tail -n +$((KEEP_DAILY + 1)) | while read -r old; do
        rm -f "$old" "$old.sha256" "$old.counts"
    done
fi

COUNT=$(ls -1 "$DEST"/justwriting-*.dump 2>/dev/null | wc -l)
echo "копия готова: $FILE ($SIZE), в хранилище $COUNT шт."
# Копия сохранена, но служба краснеет: обвал — событие, а не норма.
[ "$SHRUNK" -eq 0 ] || exit 1
