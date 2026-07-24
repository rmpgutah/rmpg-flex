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
        # ($1=ALTER $2=TABLE $3=foo $4=ADD $5=COLUMN-or-bar $6=bar-if-$5-was-COLUMN).
        # A prior version checked $4 against "COLUMN" — $4 is always "ADD"
        # (the grep pattern requires it), so that check was always false
        # and every extraction silently returned the literal string "ADD"
        # as the column name. Every ALTER in a file then collapsed to the
        # same "table.ADD" dedup key, so only one bogus entry was ever
        # recorded per table regardless of how many real columns exist —
        # this went unnoticed because `declare -A` failing on bash 3.2
        # (see below) meant the whole script never actually ran the check.
        table = $3
        col = ($5 == "COLUMN" || $5 == "column") ? $6 : $5
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

# table_name<TAB>source_file / table.column<TAB>source_file, one per line.
# Temp files instead of `declare -A` (bash 4+ only) — macOS's system
# /bin/bash is 3.2, which has no associative arrays. `declare -A` failing
# there does NOT trip `set -e` (a known bash quirk: a failing `declare` is
# not a "simple command" for errexit purposes), so the script used to
# silently no-op with exit 0 on macOS instead of erroring loudly.
TABLES_FILE=$(mktemp)
COLUMNS_FILE=$(mktemp)
trap 'rm -f "$TABLES_FILE" "$COLUMNS_FILE"' EXIT

log "scanning $MIGRATIONS_DIR/*.sql for expected schema..."

shopt -s nullglob
for f in "$MIGRATIONS_DIR"/*.sql; do
  fname=$(basename "$f")
  sql=$(cat "$f")

  # Extract CREATE TABLE statements. Last file wins per table name,
  # matching the original associative-array overwrite semantics.
  while IFS= read -r tname; do
    [ -z "$tname" ] && continue
    printf '%s\t%s\n' "$tname" "$fname" >> "$TABLES_FILE"
  done < <(extract_tables "$sql")

  # Extract ALTER TABLE ADD COLUMN statements. First file wins per
  # table.column, matching the original's explicit first-wins guard.
  while IFS= read -r pair; do
    [ -z "$pair" ] && continue
    tname=$(echo "$pair" | awk '{print $1}')
    cname=$(echo "$pair" | awk '{print $2}')
    [ -z "$tname" ] || [ -z "$cname" ] && continue
    colkey="${tname}.${cname}"
    if ! grep -qF "$(printf '%s\t' "$colkey")" "$COLUMNS_FILE" 2>/dev/null; then
      printf '%s\t%s\n' "$colkey" "$fname" >> "$COLUMNS_FILE"
    fi
  done < <(extract_columns "$sql")
done
shopt -u nullglob

# Unique table names (last-file-wins) and their unique column keys.
UNIQUE_TABLES=$(cut -f1 "$TABLES_FILE" | sort -u)
UNIQUE_COLUMNS=$(cut -f1 "$COLUMNS_FILE" | sort -u)
TABLE_COUNT=$( [ -z "$UNIQUE_TABLES" ] && echo 0 || printf '%s\n' "$UNIQUE_TABLES" | wc -l | tr -d ' ')
COLUMN_COUNT=$( [ -z "$UNIQUE_COLUMNS" ] && echo 0 || printf '%s\n' "$UNIQUE_COLUMNS" | wc -l | tr -d ' ')

# Look up a key's source file: tables use the LAST matching line, columns
# use the FIRST (each already has at most one line, so head/tail agree).
table_source() { grep -F "$(printf '%s\t' "$1")" "$TABLES_FILE" | tail -1 | cut -f2; }
column_source() { grep -F "$(printf '%s\t' "$1")" "$COLUMNS_FILE" | head -1 | cut -f2; }

log "found $TABLE_COUNT expected tables, $COLUMN_COUNT expected column additions"

# ── If dry-run, just report what would be checked ────────────
if [ "$DB_MODE" = "dry" ]; then
  log "DRY-RUN MODE (no DB_MODE set). Expected schema:"
  log ""
  log "=== Tables ==="
  while IFS= read -r tname; do
    [ -z "$tname" ] && continue
    log "  $tname  (from $(table_source "$tname"))"
  done <<< "$UNIQUE_TABLES"
  log ""
  log "=== Column additions ==="
  while IFS= read -r colkey; do
    [ -z "$colkey" ] && continue
    log "  $colkey  (from $(column_source "$colkey"))"
  done <<< "$UNIQUE_COLUMNS"
  log ""
  log "To run the live check, set DB_MODE=local or DB_MODE=remote."
  exit 0
fi

# ── Verify against live D1 ───────────────────────────────────

log "verifying schema against $DB_MODE D1 ($DB_NAME)..."

while IFS= read -r tname; do
  [ -z "$tname" ] && continue
  if ! table_exists "$tname"; then
    err "MISSING TABLE: $tname (expected by $(table_source "$tname"))"
    MISSING_TABLES+=("$tname")
    DRIFT_COUNT=$((DRIFT_COUNT + 1))
  fi
done <<< "$UNIQUE_TABLES"

while IFS= read -r colkey; do
  [ -z "$colkey" ] && continue
  tname="${colkey%%.*}"
  cname="${colkey#*.}"
  if ! check_column_exists "$tname" "$cname"; then
    err "MISSING COLUMN: $tname.$cname (expected by $(column_source "$colkey"))"
    MISSING_COLUMNS+=("$colkey")
    DRIFT_COUNT=$((DRIFT_COUNT + 1))
  fi
done <<< "$UNIQUE_COLUMNS"

# ── Report ───────────────────────────────────────────────────
log ""
if [ "$DRIFT_COUNT" -eq 0 ]; then
  log "OK — no drift detected ($TABLE_COUNT tables, $COLUMN_COUNT column additions verified)"
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
    err "  - $t  (expected by $(table_source "$t"))"
  done
fi

if [ "${#MISSING_COLUMNS[@]}" -gt 0 ]; then
  err "Missing columns (${#MISSING_COLUMNS[@]}):"
  for c in "${MISSING_COLUMNS[@]}"; do
    tname="${c%%.*}"
    cname="${c#*.}"
    err "  - $tname.$cname  (expected by $(column_source "$c"))"
  done
fi

err ""
err "Resolution: apply the missing migration(s) via:"
err "  scripts/apply-migration.sh <filename>.sql"
err ""

exit 1
