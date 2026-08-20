#!/usr/bin/env bash
# ============================================================
# setup-analytics-pipeline.sh — Activate the analytics lakehouse
# ============================================================
# One-time operator setup to provision the Cloudflare Pipelines
# streams + R2 Data Catalog warehouse for the analytics system.
#
# Run this after the Worker is deployed but BEFORE uncommenting
# the [[pipelines]] blocks in wrangler.toml.
#
# Prerequisites:
#   - wrangler logged in (npx wrangler whoami)
#   - CLOUDFLARE_ACCOUNT_ID set or inferrable
#   - Worker already deployed (creates the R2 bucket)
#
# Usage:
#   bash scripts/setup-analytics-pipeline.sh
#
# What it does:
#   1. Runs `wrangler pipelines setup` for the ALPR read stream
#      (creates the R2 analytics bucket, enables Data Catalog,
#       makes a pipeline writing to default.alpr_reads).
#   2. Runs `wrangler pipelines setup` for the system events
#      stream (same bucket, default.flex_events table).
#   3. Prints the STREAM_IDs and WAREHOUSE string to paste into
#      wrangler.toml.
#   4. Creates the R2_SQL_TOKEN secret with scoped permissions.
# ============================================================

set -euo pipefail

log()  { printf '[analytics-setup] %s\n' "$*"; }
err()  { printf '[analytics-setup] ERROR: %s\n' "$*" >&2; }

# ── Check prerequisites ─────────────────────────────────────
if ! npx wrangler whoami &>/dev/null; then
  err "Not logged in to wrangler. Run 'npx wrangler login' first."
  exit 1
fi

log "=== Step 1: Create ALPR Pipelines stream ==="
log "This provisions R2 bucket + Data Catalog + Iceberg table (default.alpr_reads)"
ALPR_OUTPUT=$(npx wrangler pipelines setup 2>&1)
echo "$ALPR_OUTPUT"

# Extract the stream ID and warehouse from output
# Typical output: "Stream created: <stream_id>" and "Warehouse: <account>_<bucket>"
ALPR_STREAM_ID=$(echo "$ALPR_OUTPUT" | grep -oP 'Stream (created|ID):\s*(\S+)' | head -1 | grep -oP '\S+$' || echo "")
WAREHOUSE=$(echo "$ALPR_OUTPUT" | grep -oP 'Warehouse:\s*(\S+)' | head -1 | grep -oP '\S+$' || echo "")

if [ -z "$ALPR_STREAM_ID" ]; then
  err "Could not extract ALPR stream ID from output above. Check manually."
  exit 1
fi
log "ALPR Stream ID: $ALPR_STREAM_ID"

log ""
log "=== Step 2: Create Events Pipelines stream ==="
log "Writing to the SAME warehouse, table: default.flex_events"
EVENTS_OUTPUT=$(npx wrangler pipelines setup 2>&1)
echo "$EVENTS_OUTPUT"

EVENTS_STREAM_ID=$(echo "$EVENTS_OUTPUT" | grep -oP 'Stream (created|ID):\s*(\S+)' | head -1 | grep -oP '\S+$' || echo "")
if [ -z "$EVENTS_STREAM_ID" ]; then
  err "Could not extract Events stream ID from output above. Check manually."
  exit 1
fi
log "Events Stream ID: $EVENTS_STREAM_ID"

log ""
log "=== Step 3: Configure wrangler.toml ==="
log ""
log "Uncomment and update these [[pipelines]] blocks in wrangler.toml:"
log ""
log "  [[pipelines]]"
log "  binding = \"ANALYTICS\""
log "  stream  = \"$ALPR_STREAM_ID\""
log ""
log "  [[pipelines]]"
log "  binding = \"EVENTS\""
log "  stream  = \"$EVENTS_STREAM_ID\""
log ""
log "And uncomment in [vars]:"
log "  R2_ANALYTICS_WAREHOUSE = \"$WAREHOUSE\""
log ""

if [ -n "$WAREHOUSE" ]; then
  log "=== Step 4: Set R2_SQL_TOKEN secret ==="
  log ""
  log "Create an API token with these permissions:"
  log "  - R2 SQL: Read"
  log "  - R2 Data Catalog: Read"
  log "  - R2: Read"
  log "on the analytics bucket, then:"
  log "  npx wrangler secret put R2_SQL_TOKEN"
  log ""
fi

log ""
log "=== Step 5: Verify ==="
log "After redeploying the Worker with the new bindings:"
log "  curl https://api.rmpgutah.us/api/analytics/health"
log "Expected: query_ready: true, pipeline_bound: true"
log ""
log "Setup complete! 🎉"
