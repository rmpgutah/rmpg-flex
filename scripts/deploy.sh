#!/usr/bin/env bash
# ============================================================
# RMPG Flex — Production Deploy Script
# Syncs code to VPS, installs deps, restarts service.
# IMPORTANT: Excludes ALL SQLite DB files to protect prod data.
# ============================================================

set -euo pipefail

VPS="root@194.113.64.90"
REMOTE_DIR="/opt/rmpg-flex"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "━━━ RMPG Flex Deploy ━━━"
echo "Source:  $LOCAL_DIR"
echo "Target:  $VPS:$REMOTE_DIR"
echo ""

# Sync code — exclude ALL database files and sensitive data
rsync -avz --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='*.db' \
  --exclude='*.db-wal' \
  --exclude='*.db-shm' \
  --exclude='*.db-journal' \
  --exclude='uploads/' \
  --exclude='.env' \
  "$LOCAL_DIR/" "$VPS:$REMOTE_DIR/"

echo ""
echo "━━━ Installing server deps ━━━"
ssh "$VPS" "cd $REMOTE_DIR/server && npm install --omit=dev"

echo ""
echo "━━━ Restarting service ━━━"
ssh "$VPS" "systemctl restart rmpg-flex && sleep 2 && systemctl is-active rmpg-flex"

echo ""
echo "━━━ Health check ━━━"
ssh "$VPS" "curl -sk https://localhost/api/health | python3 -m json.tool 2>/dev/null || curl -sk https://localhost/api/health"

echo ""
echo "✅ Deploy complete"
