#!/usr/bin/env bash
# F-2: мутационный проход по слою синхронизации. Для каждой поломки из
# scripts/mutations/sync-sweep.json: применить, прогнать целевые тесты, записать
# сколько упало, вернуть файл. Результат — docs/sync-mutation-sweep.md.
#
#   bash scripts/sync-mutation-sweep.sh            # весь список
#   bash scripts/sync-mutation-sweep.sh ss-01 cr-03 # только эти id
#
# Выживший = все тесты зелёные при сломанном коде. Это главный результат.
set -eu
cd "$(dirname "$0")/.."
LIST=scripts/mutations/sync-sweep.json
# Полный прогон пишет docs/sync-mutation-sweep.md; прогон по выбранным id — во
# временный файл: иначе он затирал таблицу по всем поломкам своими строками.
if [ $# -gt 0 ]; then
  OUT="${SWEEP_OUT:-${TMPDIR:-/tmp}/sync-mutation-sweep.partial.md}"
else
  OUT="${SWEEP_OUT:-docs/sync-mutation-sweep.md}"
fi
only="$*"

# Проверка: каждая запись обязана содержать непустой массив 'tests'
python3 - "$LIST" <<'PY' || exit 1
import json, sys
data = json.load(open(sys.argv[1]))
for m in data:
    if not m.get('tests') or not isinstance(m['tests'], list) or len(m['tests']) == 0:
        print(f"❌ {m.get('id')}: отсутствует или пустое поле 'tests'", file=sys.stderr)
        sys.exit(1)
PY

ids=$(python3 -c "import json;print(' '.join(m['id'] for m in json.load(open('$LIST'))))")
[ -n "$only" ] && ids="$only"

for f in $(python3 -c "import json;print(' '.join(sorted({m['file'] for m in json.load(open('$LIST'))})))"); do
  if ! git diff --quiet -- "$f"; then echo "❌ $f с незакоммиченными правками — прогон не начинаю" >&2; exit 2; fi
done

# Базовый прогон без поломок обязан быть зелёным: иначе посторонний красный
# тест засчитывается «поймавшим» любую поломку.
base_tests=$(python3 -c "import json; print(' '.join(sorted({t for m in json.load(open('$LIST')) for t in m.get('tests', [])})))")
set +e
base=$(npx vitest run $base_tests 2>&1)
base_exit=$?
set -e

if ! echo "$base" | grep -qE "^\s*Tests "; then
  echo "❌ базовый прогон не вернул строку Tests — сбой vitest (exit $base_exit):" >&2
  echo "$base" >&2
  exit 3
fi

base_failed=$(echo "$base" | grep -E "^\s*Tests " | grep -oE "[0-9]+ failed" | grep -oE "[0-9]+" || echo 0)
if [ "${base_failed:-0}" != "0" ] || [ $base_exit -ne 0 ]; then
  echo "❌ без поломок уже падает ${base_failed} тест(ов) — прогон не начинаю:" >&2
  echo "$base" | grep -E "^\s*×" >&2
  exit 3
fi

commit=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
date_str=$(date '+%Y-%m-%d %H:%M')

: > "$OUT"
echo "# Sync mutation sweep — ${date_str} (${commit})" >> "$OUT"
echo "" >> "$OUT"
echo "| id | файл:строка | что сломано | упало | вердикт |" >> "$OUT"
echo "|---|---|---|---|---|" >> "$OUT"
survived=0; total=0
for id in $ids; do
  total=$((total+1))
  mutation_info=$(python3 - "$LIST" "$id" <<'PY'
import json,sys
m=next(x for x in json.load(open(sys.argv[1])) if x['id']==sys.argv[2])
assert m.get('tests') and len(m['tests']) > 0, f"missing tests for {m['id']}"
s=open(m['file']).read()
assert s.count(m['old'])==1, f"old not unique for {m['id']}"
open(m['file'],'w').write(s.replace(m['old'],m['new'],1))
tests_str = ' '.join(m['tests'])
print(f"{m['file']}:{m.get('line','?')}\t{m['why']}\t{tests_str}")
PY
  ) || { echo "❌ $id: не применилась" >&2; continue; }

  file=$(echo "$mutation_info" | cut -f1 | cut -d: -f1)
  location=$(echo "$mutation_info" | cut -f1)
  why=$(echo "$mutation_info" | cut -f2)
  mutation_tests=$(echo "$mutation_info" | cut -f3)

  if git diff --quiet -- "$file"; then
    echo "❌ $id: мутация пустая" >&2
    echo "| $id | $location | $why | — | ❌ пустая |" >> "$OUT"
    continue
  fi

  set +e
  res=$(npx vitest run $mutation_tests 2>&1)
  set -e

  failed=$(echo "$res" | grep -E "^\s*Tests " | grep -oE "[0-9]+ failed" | grep -oE "[0-9]+" || echo 0)
  names=$(echo "$res" | grep -E "^\s*×" | sed -E 's/^\s*× //; s/ [0-9]+ms$//' | head -5 | tr '\n' ';' | sed 's/;$//')
  git checkout -- "$file"

  if [ "${failed:-0}" = "0" ]; then
    verdict="🔴 ВЫЖИЛА"; survived=$((survived+1))
  else
    verdict="✅ поймана: ${names}"
  fi
  echo "| $id | $location | $why | ${failed:-0} | $verdict |" >> "$OUT"
  echo "$id → failed=${failed:-0} ($verdict)"
done
echo "" >> "$OUT"
echo "Итого: $total поломок, выжило $survived." >> "$OUT"
echo "Итого: $total поломок, выжило $survived."

if [ $survived -ne 0 ]; then
  exit 1
fi
