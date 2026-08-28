#!/bin/bash
# AUDIT-part2 3.1 & AG-GATE-1: raw overlay gate.
# Modals and sheets must use shared/components/ModalShell instead of raw fixed inset-0 divs.
# Deliberate full-screen surfaces (screens, countdown takeovers, preview backdrops, slide-overs)
# are marked with `{/* not-a-modal: ... */}` in code and excluded by marker.
# Any remaining raw overlays are checked against scripts/raw-overlay-baseline.txt.
set -e

TARGET_DIR="${1:-.}"
BASELINE_FILE="${2:-$TARGET_DIR/scripts/raw-overlay-baseline.txt}"

candidates=$(grep -rl "fixed inset-0" "$TARGET_DIR/src/features" "$TARGET_DIR/src/app" --include='*.tsx' 2>/dev/null || true)

unmarked=""
for file in $candidates; do
  if grep -q "not-a-modal" "$file"; then
    continue
  fi
  rel_file="${file#$TARGET_DIR/}"
  rel_file="${rel_file#/}"
  unmarked="${unmarked}${rel_file}"$'\n'
done

if [ -f "$BASELINE_FILE" ]; then
  active_baseline=$(grep -v '^#' "$BASELINE_FILE" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | grep -v '^$' || true)
  if [ -n "$active_baseline" ]; then
    offenders=$(echo -n "$unmarked" | sed '/^$/d' | grep -vxFf <(echo "$active_baseline") || true)
  else
    offenders=$(echo -n "$unmarked" | sed '/^$/d' || true)
  fi
else
  offenders=$(echo -n "$unmarked" | sed '/^$/d' || true)
fi

if [ -n "$offenders" ]; then
  echo "::error::Raw overlay divs outside ModalShell found:"
  echo "$offenders"
  exit 1
fi

echo "Raw overlay check: 0 unmanaged raw overlays found (OK)"
