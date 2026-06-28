#!/usr/bin/env bash
# Apply a D1 migration to live `rmpg-flex` AND mark it tracked in d1_migrations,
# in one atomic step so wrangler's tracker stays honest.
#
# Why this exists:
#   `deploy.yml` runs `wrangler d1 migrations apply rmpg-flex --remote` with
#   `continue-on-error: true`, so a re-applied ALTER ("duplicate column name")
#   never fails the deploy. But if the migration was applied directly via the
#   D1 MCP / wrangler execute and nobody inserted the matching d1_migrations
#   row, wrangler keeps retrying the file on every deploy forever — a 19-row
#   drift event in June 2026 surfaced the cost.
#
# Usage:
#   scripts/apply-migration.sh 0147_my_new_migration.sql
#   scripts/apply-migration.sh migrations/0147_my_new_migration.sql   # also fine
#
# Behavior:
#   1. Applies the file to live D1 via wrangler.
#   2. If wrangler errors, asks before marking tracked (re-apply errors are
#      usually safe; real failures are not).
#   3. INSERT OR IGNORE into d1_migrations — idempotent on re-runs.

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <migration-filename>" >&2
  echo "example: $0 0147_my_new_migration.sql" >&2
  exit 64
fi

INPUT="$1"
FILENAME="${INPUT#migrations/}"
FILEPATH="migrations/${FILENAME}"

if [ ! -f "$FILEPATH" ]; then
  echo "error: $FILEPATH does not exist" >&2
  exit 66
fi

case "$FILENAME" in
  *.sql) ;;
  *) echo "error: $FILENAME is not a .sql file" >&2; exit 65 ;;
esac

echo "→ applying $FILEPATH to live D1 (rmpg-flex)..."
APPLY_OK=1
if ! npx wrangler d1 execute rmpg-flex --remote --file "$FILEPATH"; then
  APPLY_OK=0
  echo >&2
  echo "⚠️  wrangler reported errors. If these are 'duplicate column name' /" >&2
  echo "   'table already exists' from idempotent re-apply, it's safe to mark" >&2
  echo "   tracked. If they look like a genuine failure, investigate first." >&2
  printf "   Mark %s as tracked in d1_migrations anyway? [y/N] " "$FILENAME" >&2
  read -r ANS
  case "$ANS" in
    y|Y|yes|YES) ;;
    *) echo "aborted — d1_migrations not updated" >&2; exit 1 ;;
  esac
fi

echo "→ inserting d1_migrations row for $FILENAME..."
npx wrangler d1 execute rmpg-flex --remote \
  --command "INSERT OR IGNORE INTO d1_migrations (name, applied_at) VALUES ('$FILENAME', datetime('now'))"

if [ "$APPLY_OK" = "1" ]; then
  echo "✓ $FILENAME applied + tracked"
else
  echo "✓ $FILENAME tracked (apply had errors — review above)"
fi
