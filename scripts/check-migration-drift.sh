#!/usr/bin/env bash
# ============================================================
# check-migration-drift.sh — verify D1 schema matches migrations
# ============================================================
# CI guard that reads every migration SQL file, strips comments,
# extracts every CREATE TABLE and ALTER TABLE ADD COLUMN, then
# queries the live D1 to confirm each table/column exists.
#
# Usage:
#   # Dry-run (just print expected schema):
#   scripts/check-migration-drift.sh
#
#   # Local D1 check:
#   DB_MODE=local scripts/check-migration-drift.sh
#
#   # Remote (live D1) check:
#   DB_MODE=remote CLOUDFLARE_ACCOUNT_ID=<acct> scripts/check-migration-drift.sh
#
# Exit codes:
#   0 — all tables and columns present (or dry-run mode)
#   1 — drift found (missing tables or columns)
#   2 — fatal error (bad args, missing deps)
# ============================================================

set -euo pipefail

DB_NAME="rmpg-flex"
DB_MODE="${DB_MODE:-dry}"
MIGRATIONS_DIR="migrations"

DRIFT_COUNT=0
MISSING_TABLES=()
MISSING_COLUMNS=()

# ── Helpers ──────────────────────────────────────────────────

log()  { printf '[drift] %s\n' "$*"; }
err()  { printf '[drift] ERROR: %s\n' "$*" >&2; }

# Strip SQL single-line (--) comments. Block comments (/* */) are
# handled by the awk extractors below which split on statement
# boundaries; a /* */ across lines would need tr -d '\n' which
# would break the per-line awk logic, so we only strip -- here.
# This is sufficient for all our migration files (none use /* */
# with CREATE/ALTER on the same logical line).
strip_line_comments() {
  sed 's/--.*//'
}

# Extract CREATE TABLE statements from SQL, skipping commented lines.
# Uses awk for portability (no grep -P on macOS). Handles IF NOT EXISTS.
extract_tables() {
  local sql="$1"
  echo "$sql" \
    | strip_line_comments \
    | grep -oiE 'CREATE[[:space:]]+TABLE[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*' \
    | sed 's/CREATE TABLE //I' | sed 's/IF NOT EXISTS //I' \
    | tr -d '`"'
}

# Extract ALTER TABLE ADD COLUMN statements from SQL, skipping commented lines.
extract_columns() {
  local sql="$1"
  echo "$sql" \
    | strip_line_comments \
    | grep -oiE 'ALTER[[:space:]]+TABLE[[:space:]]+[A-Za-z_][A-Za-z0-9_]*[[:space:]]+ADD[[:space:]]+(COLUMN[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*' \
    | awk '{
        # Input: "ALTER TABLE foo ADD COLUMN bar" or "ALTER TABLE foo ADD bar"
        table = $3
        col = ($4 == "COLUMN" || $4 == "column") ? $5 : $4
        if (table && col) print table " " col
      }' \
    | tr -d '`"'
}

# Query D1 to check if a table exists
table_exists() {
  local table="$1"
  local result
  case "$DB_MODE" in
    local)
      result=$(npx wrangler d1 execute "$DB_NAME" --local \
        --command "SELECT 1 FROM sqlite_master WHERE type='table' AND name='$table'" 2>/dev/null)
      echo "$result" | grep -qE '"[0-9]+"' && return 0 || return 1
      ;;
    remote)
      result=$(npx wrangler d1 execute "$DB_NAME" --remote \
        --command "SELECT 1 FROM sqlite_master WHERE type='table' AND name='$table'" 2>/dev/null)
      echo "$result" | grep -qE '"[0-9]+"' && return 0 || return 1
      ;;
    *)
      # dry-run: assume exists
      return 0
      ;;
  esac
}

# Query D1 to check if a column exists in a table
check_column_exists() {
  local table="$1"
  local column="$2"
  local result
  case "$DB_MODE" in
    local)
      result=$(npx wrangler d1 execute "$DB_NAME" --local \
        --command "SELECT 1 FROM pragma_table_info('$table') WHERE name='$column'" 2>/dev/null)
      echo "$result" | grep -qE '"[0-9]+"' && return 0 || return 1
      ;;
    remote)
      result=$(npx wrangler d1 execute "$DB_NAME" --remote \
        --command "SELECT 1 FROM pragma_table_info('$table') WHERE name='$column'" 2>/dev/null)
      echo "$result" | grep -qE '"[0-9]+"' && return 0 || return 1
      ;;
    *)
      # dry-run: assume exists
      return 0
      ;;
  esac
}

# ── Collect expected schema from migrations ──────────────────

if [ ! -d "$MIGRATIONS_DIR" ]; then
  err "migrations directory not found: $MIGRATIONS_DIR"
  exit 2
fi

declare -A EXPECTED_TABLES  # table_name → source_file
declare -A EXPECTED_COLUMNS # table.column → source_file

log "scanning $MIGRATIONS_DIR/*.sql for expected schema..."

shopt -s nullglob
for f in "$MIGRATIONS_DIR"/*.sql; do
  fname=$(basename "$f")
  sql=$(cat "$f")

  # Extract CREATE TABLE statements
  while IFS= read -r tname; do
    [ -z "$tname" ] && continue
    # Skip if it's a temp table or view
    EXPECTED_TABLES["$tname"]="$fname"
  done < <(extract_tables "$sql")

  # Extract ALTER TABLE ADD COLUMN statements
  while IFS= read -r pair; do
    [ -z "$pair" ] && continue
    tname=$(echo "$pair" | awk '{print $1}')
    cname=$(echo "$pair" | awk '{print $2}')
    [ -z "$tname" ] || [ -z "$cname" ] && continue
    colkey="${tname}.${cname}"
    if [ -z "${EXPECTED_COLUMNS[$colkey]:-}" ]; then
      EXPECTED_COLUMNS["$colkey"]="$fname"
    fi
  done < <(extract_columns "$sql")
done
shopt -u nullglob

log "found ${#EXPECTED_TABLES[@]} expected tables, ${#EXPECTED_COLUMNS[@]} expected column additions"

# ── If dry-run, just report what would be checked ────────────
if [ "$DB_MODE" = "dry" ]; then
  log "DRY-RUN MODE (no DB_MODE set). Expected schema:"
  log ""
  log "=== Tables ==="
  while IFS= read -r tname; do
    [ -z "$tname" ] && continue
    log "  $tname  (from ${EXPECTED_TABLES[$tname]})"
  done < <(printf '%s\n' "${!EXPECTED_TABLES[@]}" | sort -u)
  log ""
  log "=== Column additions ==="
  while IFS= read -r colkey; do
    [ -z "$colkey" ] && continue
    log "  $colkey  (from ${EXPECTED_COLUMNS[$colkey]})"
  done < <(printf '%s\n' "${!EXPECTED_COLUMNS[@]}" | sort -u)
  log ""
  log "To run the live check, set DB_MODE=local or DB_MODE=remote."
  exit 0
fi

# ── Verify against live D1 ───────────────────────────────────

log "verifying schema against $DB_MODE D1 ($DB_NAME)..."

for tname in "${!EXPECTED_TABLES[@]}"; do
  if ! table_exists "$tname"; then
    err "MISSING TABLE: $tname (expected by ${EXPECTED_TABLES[$tname]})"
    MISSING_TABLES+=("$tname")
    DRIFT_COUNT=$((DRIFT_COUNT + 1))
  fi
done

for colkey in "${!EXPECTED_COLUMNS[@]}"; do
  tname="${colkey%%.*}"
  cname="${colkey#*.}"
  if ! check_column_exists "$tname" "$cname"; then
    err "MISSING COLUMN: $tname.$cname (expected by ${EXPECTED_COLUMNS[$colkey]})"
    MISSING_COLUMNS+=("$colkey")
    DRIFT_COUNT=$((DRIFT_COUNT + 1))
  fi
done

# ── Report ───────────────────────────────────────────────────
log ""
if [ "$DRIFT_COUNT" -eq 0 ]; then
  log "OK — no drift detected (${#EXPECTED_TABLES[@]} tables, ${#EXPECTED_COLUMNS[@]} column additions verified)"
  exit 0
fi

err ""
err "============================================"
err "  SCHEMA DRIFT DETECTED: $DRIFT_COUNT issue(s)"
err "============================================"
err ""

if [ "${#MISSING_TABLES[@]}" -gt 0 ]; then
  err "Missing tables (${#MISSING_TABLES[@]}):"
  for t in "${MISSING_TABLES[@]}"; do
    err "  - $t  (expected by ${EXPECTED_TABLES[$t]})"
  done
fi

if [ "${#MISSING_COLUMNS[@]}" -gt 0 ]; then
  err "Missing columns (${#MISSING_COLUMNS[@]}):"
  for c in "${MISSING_COLUMNS[@]}"; do
    tname="${c%%.*}"
    cname="${c#*.}"
    err "  - $tname.$cname  (expected by ${EXPECTED_COLUMNS[$c]})"
  done
fi

err ""
err "Resolution: apply the missing migration(s) via:"
err "  scripts/apply-migration.sh <filename>.sql"
err ""

exit 1
