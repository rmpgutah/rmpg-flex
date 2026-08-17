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

# Mode flag for wrangler d1 execute (--local / --remote).
d1_mode_flag() {
  case "$DB_MODE" in
    local)  echo "--local" ;;
    remote) echo "--remote" ;;
  esac
}

# Fetch the ENTIRE live schema in one round-trip: sqlite_master stores the
# full (SQLite-maintained) CREATE TABLE DDL per table, and SQLite rewrites
# that stored DDL whenever ALTER TABLE ADD COLUMN runs — so one query yields
# both the table list and every column name. The previous implementation did
# one `wrangler d1 execute` per table AND per column (~400 sequential remote
# round-trips at >1s each), which blew CI's 3-minute step timeout — and its
# result parsing grepped for a QUOTED number ('"[0-9]+"') that wrangler's
# JSON output (unquoted numbers, e.g. `"ok": 1`) can never produce, so every
# probe returned "missing" and the check was a pure false-positive generator.
#
# Writes:
#   $1 — file to receive one live table name per line
#   $2 — file to receive "table<TAB>column" per line
fetch_live_schema() {
  local tables_out="$1"
  local cols_out="$2"
  local raw
  raw=$(mktemp)
  if ! npx wrangler d1 execute "$DB_NAME" "$(d1_mode_flag)" --json \
      --command "SELECT name, sql FROM sqlite_master WHERE type='table'" \
      > "$raw" 2>/dev/null; then
    rm -f "$raw"
    return 1
  fi
  # Parse with node (repo already requires it; avoids jq dependency).
  # Column detection here is a word-boundary scan of the stored DDL — a
  # present column ALWAYS appears in the DDL, so a name found in the DDL is
  # treated as present. (A constraint mentioning the name could in theory
  # mask a genuinely missing column; suspected misses get an exact
  # pragma_table_info confirmation query below, so no false alarms either way.)
  node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const results = (Array.isArray(data) ? data : [data]).flatMap(r => r.results || []);
    const tables = [];
    const cols = [];
    for (const row of results) {
      if (!row.name) continue;
      tables.push(row.name);
      const idents = new Set((row.sql || "").match(/[A-Za-z_][A-Za-z0-9_]*/g) || []);
      for (const id of idents) cols.push(row.name + "\t" + id);
    }
    fs.writeFileSync(process.argv[2], tables.join("\n") + (tables.length ? "\n" : ""));
    fs.writeFileSync(process.argv[3], cols.join("\n") + (cols.length ? "\n" : ""));
  ' "$raw" "$tables_out" "$cols_out"
  local rc=$?
  rm -f "$raw"
  return $rc
}

# Exact column-existence probe (used ONLY to confirm suspected misses from
# the DDL scan — normally zero calls). Note `SELECT 1 AS ok` + grep for the
# unquoted JSON value wrangler actually emits.
check_column_exists_exact() {
  local table="$1"
  local column="$2"
  local result
  result=$(npx wrangler d1 execute "$DB_NAME" "$(d1_mode_flag)" --json \
    --command "SELECT 1 AS ok FROM pragma_table_info('$table') WHERE name='$column'" 2>/dev/null)
  echo "$result" | grep -q '"ok": 1'
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

  # Skip migrations explicitly marked local-only (e.g. FZ-55 local DB tables).
  if head -3 "$f" | grep -qi 'local-only'; then
    log "skipping local-only migration: $fname"
    continue
  fi

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

LIVE_TABLES_FILE=$(mktemp)
LIVE_COLS_FILE=$(mktemp)
trap 'rm -f "$TABLES_FILE" "$COLUMNS_FILE" "$LIVE_TABLES_FILE" "$LIVE_COLS_FILE"' EXIT

if ! fetch_live_schema "$LIVE_TABLES_FILE" "$LIVE_COLS_FILE"; then
  err "failed to fetch live schema snapshot from $DB_MODE D1 — cannot verify"
  exit 2
fi

LIVE_TABLE_COUNT=$(grep -c . "$LIVE_TABLES_FILE" || true)
if [ "$LIVE_TABLE_COUNT" -eq 0 ]; then
  err "live schema snapshot came back EMPTY — refusing to report every table as drift"
  exit 2
fi
log "live snapshot: $LIVE_TABLE_COUNT tables"

while IFS= read -r tname; do
  [ -z "$tname" ] && continue
  # `*_new` tables are table-rebuild temporaries (CREATE x_new → copy →
  # DROP x → RENAME x_new TO x) — they are supposed to be gone afterward.
  case "$tname" in *_new) continue ;; esac
  if ! grep -qxF "$tname" "$LIVE_TABLES_FILE"; then
    err "MISSING TABLE: $tname (expected by $(table_source "$tname"))"
    MISSING_TABLES+=("$tname")
    DRIFT_COUNT=$((DRIFT_COUNT + 1))
  fi
done <<< "$UNIQUE_TABLES"

while IFS= read -r colkey; do
  [ -z "$colkey" ] && continue
  tname="${colkey%%.*}"
  cname="${colkey#*.}"
  # Skip column checks for tables already reported missing.
  if ! grep -qxF "$tname" "$LIVE_TABLES_FILE"; then
    continue
  fi
  # Capped tables (calls_for_service, persons — D1's ~100-column SELECT cap)
  # keep newer columns in a 1:1 `<table>_ext` overflow table; a column found
  # there counts as present.
  if grep -qxF "$(printf '%s_ext\t%s' "$tname" "$cname")" "$LIVE_COLS_FILE"; then
    continue
  fi
  if ! grep -qxF "$(printf '%s\t%s' "$tname" "$cname")" "$LIVE_COLS_FILE"; then
    # DDL scan says missing — confirm with an exact pragma probe before alarming.
    if ! check_column_exists_exact "$tname" "$cname"; then
      err "MISSING COLUMN: $tname.$cname (expected by $(column_source "$colkey"))"
      MISSING_COLUMNS+=("$colkey")
      DRIFT_COUNT=$((DRIFT_COUNT + 1))
    fi
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
