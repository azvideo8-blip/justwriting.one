#!/usr/bin/env bash
# F-2: мутационный проход по слою синхронизации. Для каждой поломки из
# scripts/mutations/sync-sweep.json: применить, прогнать тесты слоя, записать
# сколько упало, вернуть файл. Результат — docs/sync-mutation-sweep.md.
#
#   bash scripts/sync-mutation-sweep.sh            # весь список
#   bash scripts/sync-mutation-sweep.sh ss-01 cr-03 # только эти id
#
# Выживший = все тесты зелёные при сломанном коде. Это главный результат.
set -u
cd "$(dirname "$0")/.."
LIST=scripts/mutations/sync-sweep.json
# Полный прогон пишет docs/sync-mutation-sweep.md; прогон по выбранным id — во
# временный файл: иначе он затирал таблицу по всем поломкам своими 11 строками.
if [ $# -gt 0 ]; then
  OUT="${SWEEP_OUT:-${TMPDIR:-/tmp}/sync-mutation-sweep.partial.md}"
else
  OUT="${SWEEP_OUT:-docs/sync-mutation-sweep.md}"
fi
TESTS=(src/core src/features/*/services src/testing)
only="$*"

ids=$(python3 -c "import json;print(' '.join(m['id'] for m in json.load(open('$LIST'))))")
[ -n "$only" ] && ids="$only"

for f in $(python3 -c "import json;print(' '.join(sorted({m['file'] for m in json.load(open('$LIST'))})))"); do
  if ! git diff --quiet -- "$f"; then echo "❌ $f с незакоммиченными правками — прогон не начинаю" >&2; exit 2; fi
done

# Базовый прогон без поломок обязан быть зелёным: иначе посторонний красный
# тест засчитывается «поймавшим» любую поломку (так и было 2026-09-27 —
# ночной флак с датой «поймал» 11 выживших).
base=$(npx vitest run "${TESTS[@]}" --maxWorkers=4 2>&1)
base_failed=$(echo "$base" | grep -E "^\s*Tests " | grep -oE "[0-9]+ failed" | grep -oE "[0-9]+" || echo 0)
if [ "${base_failed:-0}" != "0" ]; then
  echo "❌ без поломок уже падает ${base_failed} тест(ов) — прогон не начинаю:" >&2
  echo "$base" | grep -E "^\s*×" >&2
  exit 3
fi

: > "$OUT"
echo "# Sync mutation sweep — $(date '+%Y-%m-%d %H:%M')" >> "$OUT"
echo "" >> "$OUT"
echo "| id | файл:строка | что сломано | упало | вердикт |" >> "$OUT"
echo "|---|---|---|---|---|" >> "$OUT"
survived=0; total=0
for id in $ids; do
  total=$((total+1))
  info=$(python3 - "$LIST" "$id" <<'PY'
import json,sys
m=next(x for x in json.load(open(sys.argv[1])) if x['id']==sys.argv[2])
s=open(m['file']).read()
assert s.count(m['old'])==1, f"old not unique for {m['id']}"
open(m['file'],'w').write(s.replace(m['old'],m['new'],1))
print(f"{m['file']}:{m.get('line','?')}\t{m['why']}")
PY
  ) || { echo "❌ $id: не применилась" >&2; continue; }
  file=${info%%:*}
  if git diff --quiet -- "$file"; then echo "❌ $id: мутация пустая" >&2; echo "| $id | ${info%%$'\t'*} | ${info#*$'\t'} | — | ❌ пустая |" >> "$OUT"; continue; fi
  res=$(npx vitest run "${TESTS[@]}" --maxWorkers=4 2>&1)
  failed=$(echo "$res" | grep -E "^\s*Tests " | grep -oE "[0-9]+ failed" | grep -oE "[0-9]+" || echo 0)
  names=$(echo "$res" | grep -E "^\s*×" | sed -E 's/^\s*× //; s/ [0-9]+ms$//' | head -5 | tr '\n' ';')
  git checkout -- "$file"
  if [ "${failed:-0}" = "0" ]; then
    verdict="🔴 ВЫЖИЛА"; survived=$((survived+1))
  else
    verdict="✅ поймана: ${names}"
  fi
  echo "| $id | ${info%%$'\t'*} | ${info#*$'\t'} | ${failed:-0} | $verdict |" >> "$OUT"
  echo "$id → failed=${failed:-0}"
done
echo "" >> "$OUT"
echo "Итого: $total поломок, выжило $survived." >> "$OUT"
echo "Итого: $total поломок, выжило $survived."
