#!/usr/bin/env bash
# F-2: мутационный проход по слою синхронизации. Для каждой поломки из
# scripts/mutations/sync-sweep.json: применить, прогнать целевые тесты, записать
# сколько упало, вернуть файл. Результат — docs/sync-mutation-sweep.md.
#
#   bash scripts/sync-mutation-sweep.sh            # весь список
#   bash scripts/sync-mutation-sweep.sh ss-01 cr-03 # только эти id
#
# Выживший = все тесты зелёные при сломанном коде. Это главный результат.
# Неприменившаяся поломка — тоже провал: её якорь устарел, и участок кода
# сейчас не проверяет ни один тест (R2-015).
set -eu
# L-10 (sweep encoding): mutation-скрипты открывают файлы без encoding — на
# cp1251 кириллица ломалась, и 84 мутации «не применились». UTF-8 принудительно.
export PYTHONUTF8=1
# На раннере VPS (4 ядра, ~3 ГБ свободных) базовый прогон с 4 форками плюс
# вложенный vitest из postulatesCommand.test.ts не давали воркеру стартовать
# («Timeout waiting for worker to respond»), и базовый прогон краснел без
# единой настоящей ошибки. В CI — два форка; локально — как обычно.
VITEST_ARGS="${SWEEP_VITEST_ARGS:-${CI:+--maxWorkers=2}}"
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
# S-16 (R6Q-014) / S-44.7: гейт не должен быть зелёным при пустом списке — и
# узнать это надо до базового прогона, а не после всего набора тестов.
[ -n "${ids// /}" ] || { echo "❌ список мутаций пуст — нечего проверять" >&2; exit 1; }

# Метаданные (файл:строка, описание) — заранее, для строк отчёта о поломках,
# которые не применились: сама команда применения в этот момент падает.
meta_file=$(mktemp)
trap 'rm -f "$meta_file"' EXIT
python3 - "$LIST" > "$meta_file" <<'PY'
import json, sys
for m in json.load(open(sys.argv[1])):
    print('\t'.join([m['id'], f"{m.get('file','?')}:{m.get('line','?')}", m.get('why','?')]))
PY
meta() { awk -F'\t' -v id="$1" '$1==id {print $2; exit}' "$meta_file"; }
meta_why() { awk -F'\t' -v id="$1" '$1==id {print $3; exit}' "$meta_file"; }

for f in $(python3 -c "import json;print(' '.join(sorted({m['file'] for m in json.load(open('$LIST'))})))"); do
  if ! git diff --quiet -- "$f"; then echo "❌ $f с незакоммиченными правками — прогон не начинаю" >&2; exit 2; fi
done

# Базовый прогон без поломок обязан быть зелёным: иначе посторонний красный
# тест засчитывается «поймавшим» любую поломку.
base_tests=$(python3 -c "import json; print(' '.join(sorted({t for m in json.load(open('$LIST')) for t in m.get('tests', [])})))")
set +e
base=$(npx vitest run $VITEST_ARGS $base_tests 2>&1)
base_exit=$?
# Вывод разбирается grep'ом по «^\s*Tests »: в CI он цветной, и ANSI-код перед
# словом ломал разбор базового прогона.
base=$(printf '%s\n' "$base" | sed $'s/\x1b\\[[0-9;]*m//g')
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
survived=0; total=0; unapplied=0
for id in $ids; do
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
  ) || {
    # Поломка не применилась — значит её якорь устарел, и этот участок кода
    # сейчас не проверяет ни один тест. Это провал гейта, а не «просто пропуск».
    echo "❌ $id: не применилась" >&2
    unapplied=$((unapplied+1))
    echo "| $id | $(meta "$id") | $(meta_why "$id") | — | ❌ не применилась |" >> "$OUT"
    continue; }
  total=$((total+1))

  file=$(echo "$mutation_info" | cut -f1 | cut -d: -f1)
  location=$(echo "$mutation_info" | cut -f1)
  why=$(echo "$mutation_info" | cut -f2)
  mutation_tests=$(echo "$mutation_info" | cut -f3)

  if git diff --quiet -- "$file"; then
    echo "❌ $id: мутация пустая" >&2
    unapplied=$((unapplied+1))
    echo "| $id | $location | $why | — | ❌ пустая |" >> "$OUT"
    continue
  fi

  set +e
  res=$(npx vitest run $VITEST_ARGS $mutation_tests 2>&1)
  set -e
  res=$(printf '%s\n' "$res" | sed $'s/\x1b\\[[0-9;]*m//g')  # см. базовый прогон

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
echo "Итого: $total поломок, выжило $survived, не применилось $unapplied." >> "$OUT"
echo "Итого: $total поломок, выжило $survived, не применилось $unapplied."

if [ $survived -ne 0 ] || [ $unapplied -ne 0 ]; then
  exit 1
fi

