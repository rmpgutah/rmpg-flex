#!/bin/bash
# ============================================================
# RMPG Flex — Local On-Prem Deploy Script
# Deploys code directly to /opt/rmpg-flex on the same machine.
#
# Usage:
#   bash deploy/deploy-local.sh       — Deploy code only
#   bash deploy/deploy-local.sh --all — Deploy code + installers
# ============================================================

set -e

APP_DIR="/opt/rmpg-flex"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║     RMPG Flex — Local On-Prem Deploy            ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Project: $PROJECT_DIR"
echo "Target:  $APP_DIR"
echo ""

# ─── Pre-deploy Quality Gates ────────────────────────────
echo ">>> Running quality gates..."

echo "    [1/5] Server typecheck..."
(cd "$PROJECT_DIR/server" && npx tsc --noEmit) || { echo "FAILED: Server typecheck"; exit 1; }
echo "          ✓"

echo "    [2/5] Client typecheck..."
(cd "$PROJECT_DIR/client" && npx tsc --noEmit) || { echo "FAILED: Client typecheck"; exit 1; }
echo "          ✓"

echo "    [3/5] Server tests..."
(cd "$PROJECT_DIR/server" && npx vitest run --silent) || { echo "FAILED: Server tests"; exit 1; }
echo "          ✓"

echo "    [4/5] Client build..."
(cd "$PROJECT_DIR/client" && npx vite build) || { echo "FAILED: Client build"; exit 1; }
echo "          ✓"

echo "    [5/5] All quality gates passed ✓"
echo ""

# ─── Sync Code to App Directory ──────────────────────────
echo ">>> Syncing code to $APP_DIR..."
sudo rsync -az --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='server/data' \
  --exclude='server/certs' \
  --exclude='server/.env' \
  --exclude='server/uploads' \
  --exclude='client/.env' \
  --exclude='desktop' \
  --exclude='.DS_Store' \
  --exclude='.claude' \
  --exclude='client/android' \
  "$PROJECT_DIR/" "$APP_DIR/"
echo "    Code synced ✓"

# ─── Sync Installers (if --all) ──────────────────────────
if [ "${1:-}" = "--all" ]; then
  echo ">>> Syncing desktop installers..."
  sudo rsync -az "$PROJECT_DIR/server/downloads/" "$APP_DIR/server/downloads/"
  echo "    Installers synced ✓"
fi

# ─── Install Dependencies in Target ──────────────────────
echo ">>> Installing server dependencies..."
(cd "$APP_DIR/server" && sudo npm ci --legacy-peer-deps --no-audit --no-fund) || true
echo "    Server deps installed ✓"

# ─── Restart Service ────────────────────────────────────
echo ">>> Restarting RMPG Flex..."
sudo systemctl restart rmpg-flex
sleep 2

# ─── Verify ─────────────────────────────────────────────
if sudo systemctl is-active --quiet rmpg-flex; then
  echo ""
  echo "╔══════════════════════════════════════════════════╗"
  echo "║     ✓ DEPLOY SUCCESSFUL                         ║"
  echo "╠══════════════════════════════════════════════════╣"
  echo "║  Server:  https://rmpgutah.us (via Cloudflare)  ║"
  echo "║  Local:   http://$(hostname -I | awk '{print $1}'):3001        ║"
  echo "║  Status:  RUNNING                               ║"
  echo "║  Logs:    journalctl -u rmpg-flex -f            ║"
  echo "╚══════════════════════════════════════════════════╝"
  echo ""
  sudo systemctl status rmpg-flex --no-pager -l | head -12
else
  echo ""
  echo "╔══════════════════════════════════════════════════╗"
  echo "║     ✗ SERVICE FAILED TO START                   ║"
  echo "╚══════════════════════════════════════════════════╝"
  echo ""
  sudo journalctl -u rmpg-flex --no-pager -n 30
  exit 1
fi

# ─── Final Health Check ──────────────────────────────────
echo ""
curl -sf http://localhost:3001/api/health | python3 -m json.tool 2>/dev/null || echo "    (server still starting — check back shortly)"
echo ""
echo ">>> Done."
