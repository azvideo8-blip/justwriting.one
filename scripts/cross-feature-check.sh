#!/bin/bash
# AUDIT-part2 1.4 / слой 9: храповик cross-feature импортов.
# Зона import/no-restricted-paths для features->features будет включена,
# когда долг (см. число ниже) сойдёт к нулю. Пока: количество не растёт.
# Санкционированное исключение: features/auth (провайдер сессии).
# features/calendar расформирована (Calendar переехал в features/archive) —
# в фильтре ниже она оставлена намеренно: строка исключает и путь ИМПОРТИРУЮЩЕГО
# файла, поэтому счётчик слегка занижен. Сужать фильтр можно только вместе с
# пересчётом baseline, иначе CI покраснеет на ровном месте.
set -e
count=$(grep -rEn "^import .*from '(\.\./)+features/[a-z]+" src/features src/app --include='*.ts' --include='*.tsx' 2>/dev/null \
  | grep -vE "/(auth|calendar)/" | grep -v __tests__ | wc -l | tr -d ' ')
baseline=$(cat scripts/cross-feature-baseline.txt 2>/dev/null || echo 0)
echo "cross-feature imports: $count (baseline: $baseline)"
if [ "$count" -gt "$baseline" ]; then
  echo "::error::cross-feature imports grew ($count > $baseline). Move code to core/shared or drop the import."
  grep -rEn "^import .*from '(\.\./)+features/[a-z]+" src/features src/app --include='*.ts' --include='*.tsx' | grep -vE "/(auth|calendar)/" | grep -v __tests__
  exit 1
fi
