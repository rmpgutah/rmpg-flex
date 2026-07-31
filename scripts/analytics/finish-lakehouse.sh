#!/usr/bin/env bash
# ============================================================
# finish-lakehouse.sh — complete the analytics lakehouse
# ============================================================
# Creates the two R2 Data Catalog sinks and the two pipelines that connect the
# already-provisioned streams to them. Idempotent-ish: re-running after partial
# success will report "already exists" for whatever landed, which is safe.
#
# WHAT IS ALREADY DONE (2026-07-30, see wrangler.toml):
#   R2 bucket rmpg-flex-analytics ......... created (location wnam)
#   R2 Data Catalog ....................... enabled, status active
#   Stream rmpg_alpr_reads ................ 940a2ab71ee54ace9e534fd91e342f89
#   Stream rmpg_flex_events ............... 622585b17623479190bbecb141d606ce
#   R2_ANALYTICS_WAREHOUSE var ............ set in wrangler.toml [vars]
#
# WHY THIS SCRIPT EXISTS RATHER THAN THE STEPS BEING DONE FOR YOU:
#   `wrangler pipelines sinks create --type r2-data-catalog` REQUIRES
#   --catalog-token, a Cloudflare API token. There is no wrangler command that
#   mints one, so it must be created in the dashboard. This script reads it from
#   your environment so the token never has to be pasted into a chat, a commit,
#   or a command line that lands in your shell history.
#
# ── STEP 1: create the WRITE token (dashboard) ──────────────────────────────
#   https://dash.cloudflare.com/  →  R2  →  API  →  Manage API tokens
#   Permissions: "R2 Data Catalog: Edit" + "Object Read & Write"
#   Scope: the rmpg-flex-analytics bucket only.
#
# ── STEP 2: export it and run this script ──────────────────────────────────
#   read -rs CF_CATALOG_TOKEN && export CF_CATALOG_TOKEN
#   bash scripts/analytics/finish-lakehouse.sh
#
#   (`read -rs` keeps the token off your screen AND out of shell history, which
#    `export CF_CATALOG_TOKEN=abc123` would not.)
#
# ── STEP 3: create the READ token for querying (dashboard, separate token) ──
#   Permissions: "R2 SQL: Read" + "R2 Data Catalog: Read" + "Object Read"
#   Then:  npx wrangler secret put R2_SQL_TOKEN
#   (interactive prompt — do not pass the value as an argument)
#
# ── STEP 4: enable the Worker bindings ─────────────────────────────────────
#   Uncomment the two [[pipelines]] blocks in wrangler.toml, then deploy.
#   Verify: GET /api/analytics/health → query_ready:true
# ============================================================

set -euo pipefail

BUCKET="rmpg-flex-analytics"
NAMESPACE="default"
ALPR_STREAM="rmpg_alpr_reads"
EVENTS_STREAM="rmpg_flex_events"
ALPR_SINK="rmpg_alpr_sink"
EVENTS_SINK="rmpg_events_sink"
# 300s roll interval: analytics here is dashboard/reporting, not real-time, so
# fewer + larger Parquet files beats low latency (cheaper queries, less
# compaction work). Lower it only if a view genuinely needs fresher data.
ROLL_INTERVAL=300

log() { printf '[lakehouse] %s\n' "$*"; }
die() { printf '[lakehouse] ERROR: %s\n' "$*" >&2; exit 1; }

# ── Preflight ───────────────────────────────────────────────
[ -n "${CF_CATALOG_TOKEN:-}" ] || die "CF_CATALOG_TOKEN is not set. See STEP 1/2 in the header of this script."

npx wrangler whoami >/dev/null 2>&1 || die "wrangler is not logged in. Run 'npx wrangler login' first."

# Fail early if the catalog isn't active — a sink against a disabled catalog
# fails in a much less obvious way.
npx wrangler r2 bucket catalog get "$BUCKET" 2>&1 | grep -qi 'active' \
  || die "Data Catalog is not active on '$BUCKET'. Run: npx wrangler r2 bucket catalog enable $BUCKET"

log "Catalog active on $BUCKET. Creating sinks..."

# ── Sinks (one Iceberg table each) ──────────────────────────
# NOTE: the token is passed via "$CF_CATALOG_TOKEN" so it is never written into
# this file. It WILL be visible in this process's argv while running — that is a
# wrangler interface constraint (--catalog-token is the only way in), not a
# choice made here. Run this on a machine you trust.
create_sink() {
  local name="$1" table="$2"
  log "sink: $name -> ${NAMESPACE}.${table}"
  if npx wrangler pipelines sinks create "$name" \
      --type r2-data-catalog \
      --bucket "$BUCKET" \
      --namespace "$NAMESPACE" \
      --table "$table" \
      --catalog-token "$CF_CATALOG_TOKEN" \
      --roll-interval "$ROLL_INTERVAL" 2>&1 | tee /dev/stderr | grep -qiE 'already exists'; then
    log "  (already existed — continuing)"
  fi
}

create_sink "$ALPR_SINK"   "alpr_reads"
create_sink "$EVENTS_SINK" "flex_events"

# ── Pipelines (stream -> sink) ──────────────────────────────
# `SELECT *` is correct here: each stream's schema was authored to match its
# destination table 1:1 (scripts/analytics/*.schema.json), so no projection or
# filtering is needed. A fan-out would need one INSERT per table instead.
create_pipeline() {
  local name="$1" sink="$2" stream="$3"
  log "pipeline: $name ($stream -> $sink)"
  if npx wrangler pipelines create "$name" \
      --sql "INSERT INTO ${sink} SELECT * FROM ${stream}" 2>&1 | tee /dev/stderr | grep -qiE 'already exists'; then
    log "  (already existed — continuing)"
  fi
}

create_pipeline "rmpg_alpr_pipeline"   "$ALPR_SINK"   "$ALPR_STREAM"
create_pipeline "rmpg_events_pipeline" "$EVENTS_SINK" "$EVENTS_STREAM"

log ""
log "=== Sinks ==="
npx wrangler pipelines sinks list || true
log "=== Pipelines ==="
npx wrangler pipelines list || true

log ""
log "Done with the token-gated infrastructure. Remaining (see header):"
log "  STEP 3 — create the READ token, then: npx wrangler secret put R2_SQL_TOKEN"
log "  STEP 4 — uncomment the two [[pipelines]] blocks in wrangler.toml, deploy,"
log "           then check GET /api/analytics/health for query_ready:true"
log ""
log "Until STEP 3+4 are done, /api/analytics/* correctly reports"
log "200 {ok:false, code:'not_configured'} rather than erroring."
