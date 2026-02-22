#!/bin/bash
# ============================================================
# RMPG Flex — Upload Code to VPS
# Run this from your Mac to sync code to the production server
# Usage:
#   ./upload-to-vps.sh           — Upload code only
#   ./upload-to-vps.sh --all     — Upload code + installers
#   ./upload-to-vps.sh --downloads — Upload installers only
# ============================================================

VPS_IP="194.113.64.90"
VPS_USER="root"
APP_DIR="/opt/rmpg-flex"

# Get the project root (parent of deploy/)
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

UPLOAD_CODE=true
UPLOAD_DOWNLOADS=false

# Parse arguments
case "${1:-}" in
  --all)
    UPLOAD_CODE=true
    UPLOAD_DOWNLOADS=true
    ;;
  --downloads)
    UPLOAD_CODE=false
    UPLOAD_DOWNLOADS=true
    ;;
  *)
    UPLOAD_CODE=true
    UPLOAD_DOWNLOADS=false
    ;;
esac

echo ""
echo "Project directory: $PROJECT_DIR"
echo ""

# ─── Upload Code ──────────────────────────────────────────
if [ "$UPLOAD_CODE" = true ]; then
  echo ">>> Uploading RMPG Flex code to $VPS_IP..."
  rsync -avz --progress \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='server/data/*.db' \
    --exclude='server/.env' \
    --exclude='client/dist' \
    --exclude='desktop' \
    --exclude='.DS_Store' \
    --exclude='deploy' \
    "$PROJECT_DIR/" "$VPS_USER@$VPS_IP:$APP_DIR/"
  echo ""
  echo ">>> Code upload complete!"
fi

# ─── Upload Installers (Downloads) ────────────────────────
if [ "$UPLOAD_DOWNLOADS" = true ]; then
  echo ""
  echo ">>> Uploading installers to $VPS_IP..."
  echo "    (This may take a while — installers are large files)"
  rsync -avz --progress \
    "$PROJECT_DIR/server/downloads/" "$VPS_USER@$VPS_IP:$APP_DIR/server/downloads/"
  echo ""
  echo ">>> Installer upload complete!"
fi

echo ""
echo "Now SSH into the VPS and run the deploy script:"
echo "  ssh root@$VPS_IP"
echo "  /opt/deploy-rmpg.sh"
echo ""
