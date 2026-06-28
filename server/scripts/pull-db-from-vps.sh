#!/bin/bash
# ============================================================
# RMPG Flex — Pull Database & Uploads from VPS
# Downloads the production database and uploads to local server/
#
# Usage:
#   bash server/scripts/pull-db-from-vps.sh
#   bash server/scripts/pull-db-from-vps.sh --backup-only
#   bash server/scripts/pull-db-from-vps.sh --db-only
# ============================================================

set -e

VPS_IP="${VPS_IP:?Environment variable VPS_IP not set}"
VPS_USER="${VPS_USER:?Environment variable VPS_USER not set}"

# Ensure that the script is not run as root and that the user is not 'root'
if [ "$EUID" -eq 0 ]; then
  echo "Error: This script should not be run as root."
  exit 1
fi

if [ "$VPS_USER" = "root" ]; then
  echo "Error: Do not use 'root' as VPS_USER. Please use a user with limited privileges."
  exit 1
fi

REMOTE_DB="${REMOTE_DB_PATH:-/opt/rmpg-flex/server/data/rmpg-flex.db}"
REMOTE_UPLOADS="/opt/rmpg-flex/server/uploads/"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_DATA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/data"
LOCAL_UPLOADS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/uploads"
LOCAL_DB="$LOCAL_DATA_DIR/rmpg-flex.db"

mkdir -p "$LOCAL_DATA_DIR"
mkdir -p "$LOCAL_UPLOADS_DIR"

# If local DB exists and has data, back it up first
if [ -f "$LOCAL_DB" ] && [ -s "$LOCAL_DB" ]; then
  TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
  BACKUP="$LOCAL_DATA_DIR/rmpg-flex-local-backup-$TIMESTAMP.db"
  cp "$LOCAL_DB" "$BACKUP"
  echo "  ✓ Existing local DB backed up to: $BACKUP"
fi

if [ "${1:-}" = "--backup-only" ]; then
  echo ""
  echo "  Creating remote backup only (no download)..."
  ssh "$VPS_USER@$VPS_IP" "cd /opt/rmpg-flex && cp server/data/rmpg-flex.db server/data/rmpg-flex-backup-\$(date +%Y-%m-%d_%H-%M-%S).db"
  echo "  ✓ Remote backup created."
  exit 0
fi

echo ""
echo "  Downloading database from $VPS_USER@$VPS_IP..."
echo ""
scp "$VPS_USER@$VPS_IP:$REMOTE_DB" "$LOCAL_DB"

# Download WAL/SHM if they exist
scp "$VPS_USER@$VPS_IP:${REMOTE_DB}-wal" "$LOCAL_DATA_DIR/" 2>/dev/null || true
scp "$VPS_USER@$VPS_IP:${REMOTE_DB}-shm" "$LOCAL_DATA_DIR/" 2>/dev/null || true

# Download any backup files
scp "$VPS_USER@$VPS_IP:/opt/rmpg-flex/server/data/rmpg-flex-backup-*.db" "$LOCAL_DATA_DIR/" 2>/dev/null || true

SIZE=$(du -h "$LOCAL_DB" | cut -f1)
echo ""
echo "  ✓ Database restored: $SIZE"

if [ "${1:-}" = "--db-only" ]; then
  echo ""
  echo "╔══════════════════════════════════════════════════╗"
  echo "║  ✓ Database restored successfully               ║"
  echo "║  Location: server/data/rmpg-flex.db             ║"
  echo "║  Size: $SIZE                                    ║"
  echo "╚══════════════════════════════════════════════════╝"
  echo ""
  exit 0
fi

# Download uploads
echo ""
echo "  Downloading uploads from $VPS_USER@$VPS_IP..."
echo ""
scp -r "$VPS_USER@$VPS_IP:$REMOTE_UPLOADS" "$LOCAL_UPLOADS_DIR/" 2>/dev/null || echo "  ⊘ No uploads found on VPS"

UPLOAD_COUNT=$(find "$LOCAL_UPLOADS_DIR" -type f 2>/dev/null | wc -l)

SIZE=$(du -h "$LOCAL_DB" | cut -f1)
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  ✓ Full data restoration complete               ║"
printf "║  Database: server/data/rmpg-flex.db (%-12s) ║\n" "$SIZE"
printf "║  Uploads:  server/uploads/ (%-8s files) ║\n" "$UPLOAD_COUNT"
echo "╚══════════════════════════════════════════════════╝"
echo ""
