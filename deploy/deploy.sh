#!/bin/bash
# ============================================================
# RMPG Flex — Cloudflare Workers Deploy Script
# Deploys to Cloudflare Workers + D1 + R2 + KV
#
# Usage:
#   bash deploy/deploy.sh           — Deploy to production
#   bash deploy/deploy.sh --staging — Deploy to staging
#   bash deploy/deploy.sh --dry-run — Preview changes only
# ============================================================

set -e

RAW_ENV="${1:-production}"
DRY_RUN=false

# Deploy-lock acquisition lives further down (see "Acquiring deploy lock..." block)
# and uses an ownership-checked EXIT trap. The earlier duplicate implementation
# was removed 2026-04-24 — its unconditional `rm -f` on EXIT clobbered sibling
# locks, turning concurrent deploys into a lock-churn storm where every attempt
# failed with BUSY while no code actually shipped. See memory:
# project_deploy_sh_lock_race_bug.md.

# Get the project root (parent of deploy/)
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

UPLOAD_CODE=true
UPLOAD_DOWNLOADS=false
FULL_SETUP=false
SSL_SETUP=false

case "${1:-}" in
  --all)
    UPLOAD_CODE=true
    UPLOAD_DOWNLOADS=true
    ;;
  --setup)
    UPLOAD_CODE=true
    UPLOAD_DOWNLOADS=true
    FULL_SETUP=true
    SSL_SETUP=true
    ;;
  --downloads)
    UPLOAD_CODE=false
    UPLOAD_DOWNLOADS=true
    ;;
  --ssl)
    UPLOAD_CODE=false
    SSL_SETUP=true
    ;;
esac

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║     RMPG Flex — Cloudflare Workers Deploy       ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Environment: $ENVIRONMENT                       ║"
echo "║  Platform:    Cloudflare Workers + D1           ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ─── Deploy Lock (Gotcha #43 — prevent parallel worktree clobbers) ──
# Holds /tmp/rmpg-deploy.lock on the VPS for the duration of this deploy.
# A stale lock older than 15 min is auto-cleared. Other deploys running
# concurrently fail fast instead of racing.
LOCK_FILE="/tmp/rmpg-deploy.lock"
LOCK_ID="$(hostname)-$$-$(date +%s)"
LOCK_MAX_AGE_SEC=900

echo ">>> Acquiring deploy lock..."
LOCK_RESULT=$(ssh "$VPS_USER@$VPS_IP" "bash -s" <<LOCKEOF
  set -e
  if [ -f "$LOCK_FILE" ]; then
    AGE=\$(( \$(date +%s) - \$(stat -c %Y "$LOCK_FILE" 2>/dev/null || echo 0) ))
    if [ "\$AGE" -lt "$LOCK_MAX_AGE_SEC" ]; then
      HOLDER=\$(cat "$LOCK_FILE" 2>/dev/null || echo unknown)
      echo "BUSY: held by \$HOLDER (age \${AGE}s)"
      exit 1
    else
      echo "STALE: clearing lock (age \${AGE}s > ${LOCK_MAX_AGE_SEC}s)"
    fi
  fi
  echo "$LOCK_ID" > "$LOCK_FILE"
  echo "OK"
LOCKEOF
) || {
  echo ""
  echo "ERROR: Another deploy is in progress on the VPS."
  echo "       $LOCK_RESULT"
  echo ""
  echo "If you're sure no other deploy is running, clear the stale lock:"
  echo "  ssh $VPS_USER@$VPS_IP 'rm $LOCK_FILE'"
  echo ""
  exit 1
}
echo "    Lock acquired: $LOCK_ID"

# Release lock on exit regardless of success/failure
trap 'ssh "$VPS_USER@$VPS_IP" "[ \"\$(cat $LOCK_FILE 2>/dev/null)\" = \"$LOCK_ID\" ] && rm -f $LOCK_FILE" >/dev/null 2>&1 || true' EXIT

# ─── Pre-deploy Quality Gates ────────────────────────────
echo ">>> Running pre-deploy quality gates..."

# Parse special flags
UPLOAD_DOWNLOADS=false
for arg in "$@"; do
  if [ "$arg" = "--downloads" ]; then
    UPLOAD_DOWNLOADS=true
  fi
done

# Ensure dependencies
ensure_deps() {
  local dir="$1"
  if [ ! -d "$dir/node_modules" ]; then
    echo "    (installing $dir deps)"
    (cd "$dir" && npm install --silent --no-audit --no-fund) \
      || { echo "FAILED: npm install in $dir"; exit 1; }
  fi
}

ensure_deps "server"
ensure_deps "client"

echo "    [1/3] Server typecheck..."
(cd server && npx tsc --noEmit) || { echo "FAILED: Server typecheck errors"; exit 1; }
echo "          ✓ Server types OK"

echo "    [2/3] Client typecheck..."
(cd client && npx tsc --noEmit) || { echo "FAILED: Client typecheck errors"; exit 1; }
echo "          ✓ Client types OK"

echo "    [3/3] Server tests..."
(cd server && npm test --silent) || { echo "FAILED: Server tests"; exit 1; }
echo "          ✓ Server tests pass"

echo ""
echo "    All quality gates passed ✓"
echo ""

# ─── Build Client ────────────────────────────────────────
echo ">>> Building client..."
(cd client && npx vite build)
echo "    Client build complete"
echo ""

# ─── Deploy to Cloudflare ────────────────────────────────
# Build env flags: only pass --env for non-production (has an [env.X] section in wrangler.toml)
if [ "$ENVIRONMENT" = "production" ]; then
  ENV_FLAG=""
else
  ENV_FLAG="--env $ENVIRONMENT"
fi

if [ "$DRY_RUN" = true ]; then
  echo ">>> [DRY RUN] Previewing deployment..."
  npx wrangler deploy --dry-run $ENV_FLAG
else
  echo ">>> Deploying to Cloudflare Workers..."

  # Deploy D1 migrations first
  echo "    [1/3] Applying D1 migrations..."
  npx wrangler d1 migrations apply rmpg-flex $ENV_FLAG || echo "    (no new migrations or already applied)"

  # Deploy Worker
  echo "    [2/3] Deploying Worker..."
  npx wrangler deploy $ENV_FLAG

  # Deploy client to Cloudflare Pages
  echo "    [3/3] Deploying client to Pages..."
  npx wrangler pages deploy client/dist --project-name=rmpg-flex --branch=main

  # Deploy downloads to R2 if requested
  if [ "$UPLOAD_DOWNLOADS" = true ]; then
    echo "    [Extra] Syncing installers to R2..."
    bash deploy/deploy-downloads-r2.sh
  fi

  echo ""
  echo "╔══════════════════════════════════════════════════╗"
  echo "║     ✓ DEPLOY SUCCESSFUL                         ║"
  echo "╠══════════════════════════════════════════════════╣"
  echo "║  Worker:  https://rmpg-flex.rmpgutah.us         ║"
  echo "║  Pages:   https://rmpgutah.us                   ║"
  echo "║  D1:      rmpg-flex                             ║"
  echo "╚══════════════════════════════════════════════════╝"
fi

echo ""
echo ">>> Verifying deployment..."
sleep 2
HEALTH=$(curl -sf https://rmpgutah.us/api/health || echo "")

if [ -n "$HEALTH" ]; then
  echo "    ✓ Health check passed"
  echo "    $HEALTH" | python3 -m json.tool 2>/dev/null || echo "    $HEALTH"
else
  echo "    ⚠ Health check failed (deployment may still be propagating)"
fi

echo ""
echo ">>> Deploy complete!"
echo ""
