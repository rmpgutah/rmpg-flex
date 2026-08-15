#!/usr/bin/env bash
# Toughbook cold-standby activation — Step 1 of the runbook.
# Dumps the Turso secondary DB and imports it into wrangler dev's local D1.
# Prerequisites on the Toughbook:
#   - turso CLI installed (curl -sSfL https://get.tur.so/install.sh | bash)
#   - TURSO_AUTH_TOKEN set in environment or .dev.vars
set -euo pipefail

DB_NAME="rmpg-flex-secondary"
DUMP_FILE="/tmp/turso-restore-$(date +%Y%m%d-%H%M%S).sql"

echo "==> Dumping Turso '${DB_NAME}' → ${DUMP_FILE} ..."
turso db shell "${DB_NAME}" .dump > "${DUMP_FILE}"

echo "==> Importing into local D1 (wrangler dev SQLite) ..."
npx wrangler d1 execute rmpg-flex --local --file="${DUMP_FILE}"

echo ""
echo "==> Done. Run the fallback stack:"
echo "    npm run dev                      # Worker API on :8787"
echo "    npx serve client/dist -p 3000   # SPA on :3000"
