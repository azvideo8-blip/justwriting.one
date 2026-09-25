#!/bin/bash
# AUDIT-part2 3.1 & AG-GATE-1 & AUDIT-L6: raw overlay gate.
# Modals and sheets must use shared/components/ModalShell instead of raw fixed inset-0 divs.
# Deliberate full-screen surfaces (screens, countdown takeovers, preview backdrops, slide-overs)
# are marked with `{/* not-a-modal: ... */}` in code and excluded by marker adjacent to the overlay.
# Any remaining raw overlays are checked against scripts/raw-overlay-baseline.txt.
set -e

TARGET_DIR="${1:-.}"
BASELINE_FILE="${2:-$TARGET_DIR/scripts/raw-overlay-baseline.txt}"

active_baseline=""
if [ -f "$BASELINE_FILE" ]; then
  active_baseline=$(grep -v '^#' "$BASELINE_FILE" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | grep -v '^$' || true)
fi

if [ -n "${RAW_OVERLAY_TEST_MATCHES:-}" ]; then
  raw_matches="$RAW_OVERLAY_TEST_MATCHES"
else
  raw_matches=$(grep -rn "fixed inset-0" "$TARGET_DIR/src/features" "$TARGET_DIR/src/app" --include='*.tsx' 2>/dev/null || true)
fi

offenders=""

while IFS= read -r match_line; do
  [ -z "$match_line" ] && continue

  # R4-10: путь — всё до первого «:цифра», а не cut -d: -f1: на Windows путь
  # начинается с «C:», и cut отдавал только букву диска.
  file="${match_line%%:[0-9]*}"
  lineno="${match_line#"$file":}"
  lineno="${lineno%%:*}"

  # TB-05 / GT-3: нормализация пути перед сравнением с baseline:
  # на Windows обратные слэши заменяются на прямые, а префикс TARGET_DIR снимается
  norm_target="${TARGET_DIR//\\//}"
  norm_target="${norm_target%/}"
  norm_file="${file//\\//}"

  rel_file="${norm_file#"$norm_target"/}"
  rel_file="${rel_file#/}"

  # Check if covered by baseline (by file or file:line)
  if [ -n "$active_baseline" ]; then
    if echo "$active_baseline" | grep -qxF "$rel_file" || echo "$active_baseline" | grep -qxF "${rel_file}:${lineno}"; then
      continue
    fi
  fi

  # Check if a not-a-modal marker is within adjacent lines (-8 to +2)
  start_line=$((lineno > 8 ? lineno - 8 : 1))
  end_line=$((lineno + 2))

  if [ -f "$file" ] && sed -n "${start_line},${end_line}p" "$file" 2>/dev/null | grep -q "not-a-modal"; then
    continue
  fi

  offenders="${offenders}${rel_file}:${lineno}"$'\n'
done <<< "$raw_matches"

offenders=$(echo -n "$offenders" | sed '/^$/d' || true)

if [ -n "$offenders" ]; then
  echo "::error::Raw overlay divs outside ModalShell found:"
  echo "$offenders"
  exit 1
fi

echo "Raw overlay check: 0 unmanaged raw overlays found (OK)"
