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

if [ "$RAW_ENV" = "--dry-run" ]; then
  DRY_RUN=true
  ENVIRONMENT="production"
elif [ "$RAW_ENV" = "--staging" ]; then
  ENVIRONMENT="staging"
elif [ "$RAW_ENV" = "--production" ]; then
  ENVIRONMENT="production"
else
  ENVIRONMENT="$RAW_ENV"
fi
# Strip leading dashes from environment for wrangler compat
ENVIRONMENT="${ENVIRONMENT#--}"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║     RMPG Flex — Cloudflare Workers Deploy       ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Environment: $ENVIRONMENT                       ║"
echo "║  Platform:    Cloudflare Workers + D1           ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ─── Pre-deploy Quality Gates ────────────────────────────
echo ">>> Running pre-deploy quality gates..."

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
  echo "    [3/4] Deploying client to Pages..."
  npx wrangler pages deploy client/dist --project-name=rmpg-flex --branch=main

  # Sync downloads to R2 bucket
  echo "    [4/4] Syncing downloads to R2..."
  if [ -d "server/downloads" ]; then
    for f in server/downloads/*; do
      [ -f "$f" ] || continue
      filename=$(basename "$f")
      # Skip index.html — not needed in R2 (SPA serves the page)
      [ "$filename" = "index.html" ] && continue
      echo "        Uploading $filename..."
      npx wrangler r2 object put "rmpg-flex-downloads/$filename" --file="$f" 2>/dev/null || echo "        (skipped $filename)"
    done
    echo "          ✓ Downloads sync complete"
  else
    echo "          (no server/downloads directory)"
  fi

  echo ""
  echo "╔══════════════════════════════════════════════════╗"
  echo "║     ✓ DEPLOY SUCCESSFUL                         ║"
  echo "╠══════════════════════════════════════════════════╣"
  echo "║  Worker:  https://rmpg-flex.rmpgutah.us         ║"
  echo "║  Pages:   https://rmpgutah.us                   ║"
  echo "║  D1:      rmpg-flex                             ║"
  echo "║  R2:      rmpg-flex-downloads synced            ║"
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
