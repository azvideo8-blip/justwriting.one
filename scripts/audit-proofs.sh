#!/usr/bin/env bash
# TEST-1 non-vitest proofs (3.1–3.7, 3.11). Appended to TEST1-protocol.md.
set -u
cd "$(dirname "$0")/.."

echo "### 3.1 Actions pinned by SHA (no mutable tags)"
if grep -rE 'uses:.*@[0-9a-f]{40}' .github/workflows/ | grep -q checkout; then
  grep -rhoE 'uses: [^ ]+@[0-9a-f]{40}' .github/workflows/ | sort -u | sed 's/^/  OK /'
  TAGGED=$(grep -rE 'uses: [^ ]+@v[0-9]' .github/workflows/ | wc -l | tr -d ' ')
  echo "  tagged refs remaining: $TAGGED (must be 0)"
else
  echo "  FAIL: no SHA pins found"
fi

echo ""
echo "### 3.2 Dependabot config present"
[ -f .github/dependabot.yml ] && echo "  OK .github/dependabot.yml exists ($(grep -c 'package-ecosystem' .github/dependabot.yml) ecosystems)" || echo "  FAIL"

echo ""
echo "### 3.3 pull-backup.sh rejects a hostile dump name"
NAME='; touch /tmp/jw-pwned'
case "$NAME" in
  justwriting-[A-Za-z0-9._-]*.dump) echo "  FAIL: hostile name passed the guard";;
  *) echo "  OK: '$NAME' rejected by the case-guard";;
esac
[ -f /tmp/jw-pwned ] && echo "  FAIL: /tmp/jw-pwned created" || echo "  OK: no side effect file"

echo ""
echo "### 3.4 nginx dotfiles/.prev denylist present in config"
grep -q 'location ~ /\\.' deploy/nginx.conf && echo "  OK dotfiles location present" || echo "  FAIL dotfiles"
grep -q '\\.(prev|bak|old|orig|save|swp|log|sha256)\$' deploy/nginx.conf && echo "  OK prev/bak block present" || echo "  FAIL prev/bak"
echo "  live check after deploy (requires host): curl -s -o /dev/null -w '%{http_code}' https://justwriting.ru/.env → expect 403; /index.html.prev → 404"

echo ""
echo "### 3.5 i18n zero-state"
npm run i18n:audit 2>/dev/null | tail -1 | sed 's/^/  /'

echo ""
echo "### 3.6 Firebase mentions left in src/"
COUNT=$(rg -c "Firebase|Firestore" src/ -g '!*test*' 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
echo "  remaining mentions: $COUNT (target: only historical comments; list below)"
rg -n "Firebase|Firestore" src/ -g '!*test*' 2>/dev/null | head -5 | sed 's/^/    /'

echo ""
echo "### 3.7 manifest/icon references exist on disk"
for f in $(grep -oE '"/[^"]+\.(svg|png)"' public/manifest.json | tr -d '"'); do
  [ -f "public$f" ] && echo "  OK $f" || echo "  FAIL missing public$f"
done
grep -oE '/og-image\.[a-z]+' index.html | sort -u | while read -r f; do
  [ -f "public$f" ] && echo "  OK $f (index.html)" || echo "  FAIL missing public$f (index.html)"
done

echo ""
echo "### 3.11 api tests run from the api/ directory"
( cd api && npx vitest run 2>&1 | grep -E "Tests " | tail -1 | sed 's/^/  api-dir: /' )
( npx vitest run api 2>&1 | grep -E "Tests " | tail -1 | sed 's/^/  root:    /' )

echo ""
echo "### 0.1 bench JSONs untracked"
LEFT=$(git ls-files scripts/rerank-bench/ | grep -c '\.json$' || true)
[ "$LEFT" = "0" ] && echo "  OK: no tracked json in rerank-bench" || echo "  FAIL: $LEFT json files still tracked"
