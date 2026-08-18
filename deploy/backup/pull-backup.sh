#!/usr/bin/env bash
# Забрать резервную копию базы с сервера на этот компьютер.
#
# Запускается НА НОУТБУКЕ, не на сервере. Делает три вещи: просит сервер снять
# свежий дамп, забирает его сюда и сверяет контрольную сумму. Без последнего
# шага копия остаётся непроверенной, а непроверенная копия — это надежда.
#
#   bash deploy/backup/pull-backup.sh
#
set -euo pipefail

HOST=justwriting                 # алиас из ~/.ssh/config
DEST="$HOME/Backups/justwriting" # куда складывать здесь
KEEP=10                          # сколько копий держать на этом компьютере

# sha256sum есть в Linux, shasum — в macOS.
if command -v sha256sum >/dev/null; then
    SHA() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null; then
    SHA() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
    echo "не нашёл ни sha256sum, ни shasum — нечем проверить копию" >&2
    exit 1
fi

mkdir -p "$DEST"

echo "1/4 · прошу сервер снять свежую копию…"
ssh "$HOST" "sudo /opt/justwriting/backup/pg-backup.sh"

echo "2/4 · ищу самую свежую…"
NAME=$(ssh "$HOST" "sudo ls -1t /var/backups/justwriting/*.dump | head -1 | xargs basename")
if [ -z "$NAME" ]; then
    echo "на сервере нет ни одной копии — что-то пошло не так" >&2
    exit 1
fi

echo "3/4 · забираю $NAME…"
# Через sudo cat, а не scp: файлы принадлежат root, и менять это ради удобства
# значит делать дамп со всеми заметками читаемым для любого процесса под моим
# пользователем.
ssh "$HOST" "sudo cat /var/backups/justwriting/$NAME" > "$DEST/$NAME"
EXPECTED=$(ssh "$HOST" "sudo cat /var/backups/justwriting/$NAME.sha256" | cut -d' ' -f1)

echo "4/4 · сверяю контрольную сумму…"
ACTUAL=$(SHA "$DEST/$NAME")
if [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "СУММА НЕ СОШЛАСЬ — файл повреждён при передаче, удаляю" >&2
    echo "  на сервере: $EXPECTED" >&2
    echo "  здесь:      $ACTUAL" >&2
    rm -f "$DEST/$NAME"
    exit 1
fi
echo "$EXPECTED  $NAME" > "$DEST/$NAME.sha256"

# Ротация локальных копий.
ls -1t "$DEST"/justwriting-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -f "$old" "$old.sha256"
done

SIZE=$(du -h "$DEST/$NAME" | cut -f1)
COUNT=$(ls -1 "$DEST"/justwriting-*.dump 2>/dev/null | wc -l | tr -d ' ')
echo
echo "готово: $DEST/$NAME ($SIZE)"
echo "копий здесь: $COUNT, самая старая — $(ls -1t "$DEST"/justwriting-*.dump | tail -1 | xargs basename)"
echo
echo "Восстановить из этой копии:"
echo "  cat \"$DEST/$NAME\" | ssh $HOST 'docker exec -i supabase-db pg_restore -U postgres -d postgres --clean --no-owner'"
