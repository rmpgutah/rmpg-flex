#!/bin/bash
# ============================================================
# RMPG Flex — VPS-Side Deploy Script
# Install at: /opt/deploy-rmpg.sh
#
# Called by the webhook listener after a push to main, or
# run manually on the VPS:
#   sudo /opt/deploy-rmpg.sh
#
# Handles everything: git fetch + reset, deps, build,
# restart, and health check.
# ============================================================

set -euo pipefail

APP_DIR="/opt/rmpg-flex"
LOG_FILE="/var/log/rmpg-deploy.log"
LOCK_FILE="/tmp/rmpg-deploy.lock"
DOMAIN="rmpgutah.us"

# ── Logging ──
log() {
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[$ts] $*"
  echo "[$ts] $*" >> "$LOG_FILE" 2>/dev/null || true
}

# ── Deploy lock (flock) ──
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  log "ERROR: Another deploy is already running (lock held: $LOCK_FILE)"
  exit 1
fi

log "=== Deploy started ==="

cd "$APP_DIR"

# ── Record current SHA for change detection ──
OLD_SHA="$(git rev-parse HEAD 2>/dev/null || echo none)"

# ── Pull latest if not already up-to-date ──
REMOTE_SHA="$(git ls-remote origin refs/heads/main | cut -f1 || echo unknown)"
if [ "$OLD_SHA" != "$REMOTE_SHA" ]; then
  log "Fetching origin/main ($OLD_SHA → $REMOTE_SHA)..."
  git fetch origin main
  git reset --hard origin/main
else
  log "Already at origin/main ($OLD_SHA)"
fi

NEW_SHA="$(git rev-parse HEAD)"
log "HEAD is now $NEW_SHA"

# ── Change detection ──
if [ "$OLD_SHA" != "none" ] && [ "$OLD_SHA" != "$NEW_SHA" ]; then
  CHANGED_FILES="$(git diff --name-only "$OLD_SHA" "$NEW_SHA" 2>/dev/null || echo "")"
  CLIENT_CHANGED=false
  SERVER_DEPS_CHANGED=false
  CLIENT_DEPS_CHANGED=false

  echo "$CHANGED_FILES" | grep -q '^client/' && CLIENT_CHANGED=true || true
  echo "$CHANGED_FILES" | grep -q '^server/package' && SERVER_DEPS_CHANGED=true || true
  echo "$CHANGED_FILES" | grep -q '^client/package' && CLIENT_DEPS_CHANGED=true || true

  log "changes: client=$CLIENT_CHANGED server-deps=$SERVER_DEPS_CHANGED client-deps=$CLIENT_DEPS_CHANGED"
else
  # First run or forced — do everything
  CLIENT_CHANGED=true
  SERVER_DEPS_CHANGED=true
  CLIENT_DEPS_CHANGED=true
  log "changes: full rebuild (no prior SHA or forced)"
fi

# ── Server dependencies ──
if [ "$SERVER_DEPS_CHANGED" = true ]; then
  log "Installing server dependencies..."
  cd server
  if [ -f package-lock.json ]; then
    npm ci --legacy-peer-deps --no-audit --no-fund 2>&1 | tail -3
  else
    npm install --legacy-peer-deps --no-audit --no-fund 2>&1 | tail -3
  fi
  cd ..
  log "Server deps installed"
else
  log "Skipping server deps (no package*.json changes)"
fi

# ── Client dependencies + build ──
if [ "$CLIENT_CHANGED" = true ] || [ "$CLIENT_DEPS_CHANGED" = true ]; then
  if [ "$CLIENT_DEPS_CHANGED" = true ]; then
    log "Installing client dependencies..."
    cd client
    if [ -f package-lock.json ]; then
      npm ci --no-audit --no-fund 2>&1 | tail -3
    else
      npm install --no-audit --no-fund 2>&1 | tail -3
    fi
    cd ..
    log "Client deps installed"
  fi

  log "Building client..."
  cd client && npx vite build 2>&1 | tail -5 && cd ..
  log "Client built"
else
  log "Skipping client build (no client/* changes)"
fi

# ── Restart service ──
log "Restarting rmpg-flex service..."
systemctl restart rmpg-flex

# ── Health check ──
log "Waiting for server to start..."
sleep 3

HEALTH=""
for i in 1 2 3 4 5; do
  HEALTH="$(curl -sf http://localhost:3001/api/health 2>/dev/null || echo "")"
  if [ -n "$HEALTH" ]; then
    break
  fi
  log "Health check attempt $i failed, retrying in 2s..."
  sleep 2
done

if [ -n "$HEALTH" ]; then
  VERSION="$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','?'))" 2>/dev/null || echo "?")"
  log "=== Deploy SUCCESS — v$VERSION ($NEW_SHA) ==="
else
  log "=== Deploy FAILED — health check unreachable after restart ==="
  log "Check logs: journalctl -u rmpg-flex -n 50"
  exit 1
fi
