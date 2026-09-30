#!/usr/bin/env bash
# TEST-1 non-vitest proofs (3.1–3.7, 3.11). Appended to TEST1-protocol.md.
set -u
cd "$(dirname "$0")/.."

fails=()
fail() { echo "  FAIL: $*"; fails+=("$*"); }

echo "### 3.1 Actions pinned by SHA (no mutable tags)"
if grep -rE 'uses:.*@[0-9a-f]{40}' .github/workflows/ | grep -q checkout; then
  grep -rhoE 'uses: [^ ]+@[0-9a-f]{40}' .github/workflows/ | sort -u | sed 's/^/  OK /'
  TAGGED=$(grep -rE 'uses: [^ ]+@v[0-9]' .github/workflows/ | wc -l | tr -d ' ')
  if [ "$TAGGED" -gt 0 ]; then
    fail "tagged refs remaining: $TAGGED (must be 0)"
  else
    echo "  tagged refs remaining: 0 (must be 0)"
  fi
else
  fail "no SHA pins found"
fi

echo ""
echo "### 3.2 Dependabot config present"
[ -f .github/dependabot.yml ] && echo "  OK .github/dependabot.yml exists ($(grep -c 'package-ecosystem' .github/dependabot.yml) ecosystems)" || fail "dependabot config missing"

echo ""
echo "### 3.3 pull-backup.sh rejects a hostile dump name"
# R4-069: раньше 3.3 проверяла собственный case-glob, а не regex в самом
# pull-backup.sh — сдвиг источника оставался бы незамеченным. Извлекаем
# настоящий regex и проверяем его им.
GUARD_LINE=$(grep -F '[[ "$NAME" =~ ' deploy/backup/pull-backup.sh | head -1 || true)
if [ -z "$GUARD_LINE" ]; then
  fail "guard regex not found in deploy/backup/pull-backup.sh"
else
  RE=${GUARD_LINE#* =~ }
  RE=${RE%%\]\]*}
  NAME='; touch /tmp/jw-pwned'
  if [[ "$NAME" =~ $RE ]]; then
    fail "hostile name passed the real guard regex ($RE)"
  else
    echo "  OK: hostile name rejected by the guard regex from pull-backup.sh"
  fi
  GOOD='justwriting-20260930-120000.dump'
  if [[ "$GOOD" =~ $RE ]]; then
    echo "  OK: legal dump name passes the same regex"
  else
    fail "legal dump name rejected — guard regex is broken ($RE)"
  fi
fi
[ -f /tmp/jw-pwned ] && fail "/tmp/jw-pwned created" || echo "  OK: no side effect file"

echo ""
echo "### 3.4 nginx dotfiles/.prev denylist present in config"
grep -q 'location ~ /\\.' deploy/nginx.conf && echo "  OK dotfiles location present" || fail "dotfiles location missing"
grep -q '\\.(prev|bak|old|orig|save|swp|log|sha256)\$' deploy/nginx.conf && echo "  OK prev/bak block present" || fail "prev/bak block missing"
echo "  SKIP: live check — see TB-16"

echo ""
echo "### 3.5 i18n zero-state"
# F-045: код пайпа был кодом sed — красный аудит этот пункт не ронял.
if I18N_OUT=$(npm run i18n:audit 2>&1); then
  echo "$I18N_OUT" | tail -1 | sed 's/^/  /'
else
  echo "$I18N_OUT" | tail -5 | sed 's/^/  /'
  fail "i18n audit is red"
fi

echo ""
echo "### 3.6 Firebase mentions left in src/"
COUNT=$(rg -c "Firebase|Firestore" src/ -g '!*test*' 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
# R4-069: раньше 3.6 не умела падать. Храповик: фактический остаток 29 —
# потолок; рост или новая упоминание в коде красит гейт, сдвиг вниз двигает и его.
FIREBASE_RATCHET=29
echo "  remaining mentions: $COUNT (ratchet ceiling: $FIREBASE_RATCHET — only moves down)"
if [ "$COUNT" -gt "$FIREBASE_RATCHET" ]; then
  fail "Firebase/Firestore mentions grew: $COUNT > $FIREBASE_RATCHET"
fi
rg -n "Firebase|Firestore" src/ -g '!*test*' 2>/dev/null | head -5 | sed 's/^/    /'

echo ""
echo "### 3.7 manifest/icon references exist on disk"
for f in $(grep -oE '"/[^"]+\.(svg|png)"' public/manifest.json | tr -d '"'); do
  [ -f "public$f" ] && echo "  OK $f" || fail "missing public$f"
done
for f in $(grep -oE '/og-image\.[a-z]+' index.html | sort -u); do
  [ -f "public$f" ] && echo "  OK $f (index.html)" || fail "missing public$f (index.html)"
done

echo ""
echo "### 3.8 deploy.yml rollback restores node_modules (L-9 / R4-064)"
# rsync --delete заменяет зависимости до запуска службы; откат, возвращающий
# только server.mjs, оставляет службу без её пакетов. Красный на выкатке без
# снимка: grep не находит node_modules.prev.
grep -q 'node_modules.prev' .github/workflows/deploy.yml \
  && echo "  OK: node_modules snapshot + restore present in deploy/rollback" \
  || fail "deploy.yml has no node_modules snapshot/restore"

echo ""
echo "### 3.11 api tests run from the api/ directory"
# Из корня 'npx vitest run api' матчил по подстроке 'api' файлы путей,
# включая src/features/ai/utils/__tests__/prepareApiMessages.test.ts (3 теста).
# Поэтому фильтр из корня — строго 'api/' (39 файлов, 239 тестов), делая наборы
# тестов между прогоном из каталога api/ и прогоном из корня идентичными.

api_dir_out=$( ( cd api && npx vitest run ) 2>&1 )
api_dir_rc=$?
api_dir_summary=$(echo "$api_dir_out" | grep -E "Tests " | tail -1)

root_out=$(npx vitest run 'api/' 2>&1)
root_rc=$?
root_summary=$(echo "$root_out" | grep -E "Tests " | tail -1)

echo "  api-dir: ${api_dir_summary:-NO_TESTS_LINE}"
echo "  root:    ${root_summary:-NO_TESTS_LINE}"

if [ $api_dir_rc -ne 0 ]; then
  fail "api-dir vitest exited with code $api_dir_rc"
fi
if [ -z "$api_dir_summary" ]; then
  fail "api-dir missing 'Tests ' line"
elif echo "$api_dir_summary" | grep -qE '[1-9][0-9]* failed'; then
  fail "api-dir has failed tests: $api_dir_summary"
fi

if [ $root_rc -ne 0 ]; then
  fail "root vitest exited with code $root_rc"
fi
if [ -z "$root_summary" ]; then
  fail "root missing 'Tests ' line"
elif echo "$root_summary" | grep -qE '[1-9][0-9]* failed'; then
  fail "root has failed tests: $root_summary"
fi

api_dir_total=$(echo "$api_dir_summary" | grep -oE '\([0-9]+\)' | tr -d '()' || true)
root_total=$(echo "$root_summary" | grep -oE '\([0-9]+\)' | tr -d '()' || true)
if [ -n "$api_dir_total" ] && [ -n "$root_total" ] && [ "$api_dir_total" -ne "$root_total" ]; then
  fail "test count mismatch: api-dir has $api_dir_total, root has $root_total"
fi

echo ""
echo "### 0.1 bench JSONs untracked"
LEFT=$(git ls-files scripts/rerank-bench/ | grep -c '\.json$' || true)
[ "$LEFT" = "0" ] && echo "  OK: no tracked json in rerank-bench" || fail "$LEFT json files still tracked"

if [ ${#fails[@]} -gt 0 ]; then
  echo ""
  echo "FAILURES (${#fails[@]}):"
  for f in "${fails[@]}"; do
    echo "  - $f"
  done
fi

[ ${#fails[@]} -eq 0 ]
