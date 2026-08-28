#!/usr/bin/env bash
# CI guard: fails if the shared/serveIntake/ re-export shims have drifted into
# real logic.  Both src/utils/serveIntakeDefendants.ts and
# client/src/utils/serveIntakeDefendants.ts must remain thin re-exports.
# Add this to .github/workflows/ci.yml as a step after checkout:
#   - run: bash scripts/check-serve-intake-dupes.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SHARED="$ROOT/shared/serveIntake/defendants.ts"
SERVER="$ROOT/src/utils/serveIntakeDefendants.ts"
CLIENT="$ROOT/client/src/utils/serveIntakeDefendants.ts"
JUDGE_TYPES="$ROOT/client/src/types/serveIntakeJudge.ts"
JUDGE_SERVER="$ROOT/src/utils/serveIntakeJudge.ts"

fail=0

check_slim() {
  local file="$1" label="$2" max_lines="$3"
  if [[ ! -f "$file" ]]; then
    echo "FAIL  $label: file not found ($file)"
    fail=1
    return
  fi
  local lines
  lines=$(wc -l < "$file")
  if (( lines > max_lines )); then
    echo "FAIL  $label: $lines lines exceeds max $max_lines — logic crept into re-export shim?"
    cat "$file" >&2
    fail=1
  else
    echo "OK    $label: $lines lines"
  fi
}

check_slim "$SERVER"  "src/utils/serveIntakeDefendants.ts" 6
check_slim "$CLIENT"  "client/src/utils/serveIntakeDefendants.ts" 6
check_slim "$JUDGE_TYPES" "client/src/types/serveIntakeJudge.ts" 6

# Verify shims contain only re-exports (no function bodies)
if grep -qP '^\s*(const|let|var|function|export function|export const)' "$SERVER" 2>/dev/null; then
  echo "FAIL  src/utils/serveIntakeDefendants.ts: contains logic, not a re-export"
  fail=1
fi
if grep -qP '^\s*(const|let|var|function|export function|export const)' "$CLIENT" 2>/dev/null; then
  echo "FAIL  client/src/utils/serveIntakeDefendants.ts: contains logic, not a re-export"
  fail=1
fi

if (( fail )); then
  echo ""
  echo "Shared-package guard FAILED. Keep logic in shared/serveIntake/ only."
  exit 1
fi
echo ""
echo "Shared-package guard passed."
