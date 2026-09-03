#!/bin/bash
# AUDIT-part3 9: храповик cross-feature импортов внутри src/features.
set -e
feats=$(ls -d src/features/*/ | xargs -n1 basename)
count=0
for f in $feats; do
  if [ "$f" = "auth" ]; then
    # auth is feature-import-free (ARCHITECTURE.md): cannot import ANY other feature
    others=$(echo "$feats" | tr ' ' '\n' | grep -vx "auth" | tr '\n' '|' | sed 's/|$//')
  else
    # other features can only import themselves and auth
    others=$(echo "$feats" | tr ' ' '\n' | grep -vx "$f" | grep -vx "auth" | tr '\n' '|' | sed 's/|$//')
  fi
  n=$(grep -rEn "(from |import\()['\"][.][.](/|\.\./)+($others)/" "src/features/$f" --include='*.ts' --include='*.tsx' 2>/dev/null \
    | grep -v __tests__ | wc -l | tr -d ' ')
  count=$((count + n))
done
baseline=$(cat scripts/cross-feature-baseline.txt 2>/dev/null || echo 0)
echo "cross-feature imports: $count (baseline: $baseline)"
if [ "$count" -gt "$baseline" ]; then
  echo "::error::cross-feature imports grew ($count > $baseline). Move code to core/shared or drop the import."
  for f in $feats; do
    if [ "$f" = "auth" ]; then
      others=$(echo "$feats" | tr ' ' '\n' | grep -vx "auth" | tr '\n' '|' | sed 's/|$//')
    else
      others=$(echo "$feats" | tr ' ' '\n' | grep -vx "$f" | grep -vx "auth" | tr '\n' '|' | sed 's/|$//')
    fi
    grep -rEn "(from |import\()['\"][.][.](/|\.\./)+($others)/" "src/features/$f" --include='*.ts' --include='*.tsx' 2>/dev/null \
      | grep -v __tests__ || true
  done
  exit 1
fi

# Ensure no eslint-disable suppressions bypass the boundary
suppressions=$(grep -rn 'eslint-disable.*import/no-restricted-paths' src/ | wc -l | tr -d ' ')
if [ "$suppressions" -gt 0 ]; then
  echo "::error::Found $suppressions eslint-disable comments for import/no-restricted-paths in src/:"
  grep -rn 'eslint-disable.*import/no-restricted-paths' src/
  exit 1
fi
