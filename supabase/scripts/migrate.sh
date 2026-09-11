#!/usr/bin/env bash
# supabase/scripts/migrate.sh — Track and apply SQL migrations for JustWriting.
#
# Usage:
#   bash supabase/scripts/migrate.sh                # Apply pending migrations
#   bash supabase/scripts/migrate.sh --status       # Show applied vs pending migrations
#   bash supabase/scripts/migrate.sh --baseline <file> # Mark up to <file> as applied without running
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATIONS_DIR="$SUPABASE_DIR/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "Error: Migrations directory not found at $MIGRATIONS_DIR" >&2
  exit 1
fi

run_sql() {
  if [ -n "${DATABASE_URL:-}" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q "$@"
  elif [ -f "/opt/justwriting/supabase/docker-compose.yml" ] && command -v docker >/dev/null 2>&1; then
    (cd "/opt/justwriting/supabase" && docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@")
  elif [ -f "$SUPABASE_DIR/docker-compose.yml" ] && command -v docker >/dev/null 2>&1; then
    (cd "$SUPABASE_DIR" && docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@")
  elif command -v psql >/dev/null 2>&1; then
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"
  else
    echo "Error: Neither psql nor docker compose found to execute SQL." >&2
    exit 1
  fi
}

init_table() {
  run_sql -c "CREATE TABLE IF NOT EXISTS public.applied_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  );"
}

get_applied() {
  run_sql -t -A -c "SELECT filename FROM public.applied_migrations ORDER BY filename ASC;" 2>/dev/null || true
}

get_all_migrations() {
  (cd "$MIGRATIONS_DIR" && ls -1 *.sql 2>/dev/null | sort)
}

show_status() {
  init_table
  local applied
  applied=$(get_applied)
  
  echo "=== Migration Status ==="
  printf "%-45s %s\n" "Migration" "Status"
  printf "%-45s %s\n" "---------------------------------------------" "-------------"
  
  local count=0
  local pending_count=0
  for f in $(get_all_migrations); do
    count=$((count + 1))
    if echo "$applied" | grep -q "^$f$"; then
      local ts
      ts=$(run_sql -t -A -c "SELECT to_char(applied_at, 'YYYY-MM-DD HH24:MI:SS') FROM public.applied_migrations WHERE filename = '$f';" 2>/dev/null || echo "applied")
      printf "%-45s [applied %s]\n" "$f" "$ts"
    else
      pending_count=$((pending_count + 1))
      printf "%-45s [PENDING]\n" "$f"
    fi
  done
  
  echo "---------------------------------------------"
  echo "Total migrations: $count, Pending: $pending_count"
}

set_baseline() {
  local target="$1"
  init_table
  local applied
  applied=$(get_applied)
  
  local found=0
  for f in $(get_all_migrations); do
    if ! echo "$applied" | grep -q "^$f$"; then
      run_sql -c "INSERT INTO public.applied_migrations (filename) VALUES ('$f') ON CONFLICT DO NOTHING;"
      echo "Baselined: $f"
    else
      echo "Already recorded: $f"
    fi
    if [ "$f" = "$target" ]; then
      found=1
      break
    fi
  done
  
  if [ "$found" -eq 0 ]; then
    echo "Warning: Target migration '$target' was not found in migrations directory." >&2
  fi
  echo "Baseline set up to '$target'."
}

apply_pending() {
  init_table
  local applied
  applied=$(get_applied)
  
  local applied_count=0
  for f in $(get_all_migrations); do
    if echo "$applied" | grep -q "^$f$"; then
      continue
    fi
    
    echo "Applying migration: $f..."
    (cat "$MIGRATIONS_DIR/$f"; printf "\nINSERT INTO public.applied_migrations (filename) VALUES ('%s');\n" "$f") | run_sql --single-transaction
    echo "✓ Applied and recorded: $f"
    applied_count=$((applied_count + 1))
  done
  
  if [ "$applied_count" -eq 0 ]; then
    echo "Database schema is up to date (no pending migrations)."
  else
    echo "Successfully applied $applied_count migration(s)."
  fi
}

# Parse CLI arguments
case "${1:-apply}" in
  --status|-s)
    show_status
    ;;
  --baseline|-b)
    if [ -z "${2:-}" ]; then
      echo "Usage: $0 --baseline <migration_file.sql>" >&2
      exit 1
    fi
    set_baseline "$2"
    ;;
  apply|up|"")
    apply_pending
    ;;
  *)
    echo "Usage: $0 [--status | --baseline <file> | apply]" >&2
    exit 1
    ;;
esac
