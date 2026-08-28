#!/bin/bash
# AUDIT-part3 9: храповик cross-feature импортов внутри src/features.
#
# v2 (2026-08-26): v1 ловил только '../features/x' и пропускал настоящий
# класс — '../../admin/services' (соседняя фича относительным путём).
# v2 перебирает фичи и ищет импорты из ЛЮБОЙ другой фичи, кроме
# санкционированного auth (провайдер сессии). Эталон совпадает с зоной
# import/no-restricted-paths «features -> features» в eslint.config.js —
# включить её, когда счётчик дойдёт до нуля.
set -e
feats=$(ls -d src/features/*/ | xargs -n1 basename)
count=0
for f in $feats; do
  [ "$f" = "auth" ] && continue
  others=$(echo "$feats" | tr ' ' '\n' | grep -vx "$f" | grep -vx "auth" | tr '\n' '|' | sed 's/|$//')
  n=$(grep -rEn "from '(\.\./)+($others)/" "src/features/$f" --include='*.ts' --include='*.tsx' 2>/dev/null \
    | grep -v __tests__ | wc -l | tr -d ' ')
  count=$((count + n))
done
baseline=$(cat scripts/cross-feature-baseline.txt 2>/dev/null || echo 0)
echo "cross-feature imports: $count (baseline: $baseline)"
if [ "$count" -gt "$baseline" ]; then
  echo "::error::cross-feature imports grew ($count > $baseline). Move code to core/shared or drop the import."
  for f in $feats; do
    [ "$f" = "auth" ] && continue
    others=$(echo "$feats" | tr ' ' '\n' | grep -vx "$f" | grep -vx "auth" | tr '\n' '|' | sed 's/|$//')
    grep -rEn "from '(\.\./)+($others)/" "src/features/$f" --include='*.ts' --include='*.tsx' 2>/dev/null \
      | grep -v __tests__ || true
  done
  exit 1
fi
