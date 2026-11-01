#!/usr/bin/env bash
# Нужен ли мобильный e2e этому прогону: печатает run=true|false (в GITHUB_OUTPUT).
# Аргументы: <event_name> <ref> <before> <sha>.
#
# 31.10 (разбор Qoder): сравнение с прошлым push врало. Новый push отменяет
# прошлый прогон, и правка кода, за которой следом ушли одни тесты, e2e не
# проходила ни разу — CI зелёный. Ветка сравнивается со своей базой на main.
set -euo pipefail
event="$1"; ref="$2"; before="${3:-}"; sha="${4:-HEAD}"

if [ "$event" != "push" ]; then echo "run=true"; exit 0; fi
if [ "$ref" = "refs/heads/main" ]; then
  base="$before"
else
  base=$(git merge-base origin/main "$sha" 2>/dev/null || true)
fi
if [ -z "$base" ] || [ "$base" = "0000000000000000000000000000000000000000" ] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  echo "база неизвестна — гоняем" >&2; echo "run=true"; exit 0
fi

changed=$(git diff --name-only "$base" "$sha")
echo "$changed" >&2
if echo "$changed" | grep -v '/__tests__/' | grep -qE '^(src/|e2e/|api/|supabase/|public/|scripts/stand/|scripts/ci/|playwright\.mobile\.config\.ts$|package(-lock)?\.json$|index\.html$|vite\.config\.ts$|tsconfig[^/]*\.json$|\.github/workflows/ci\.yml$)'; then
  echo "run=true"
else
  echo "run=false"
fi
