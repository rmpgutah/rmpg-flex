#!/bin/bash
# ==============================================================================
# RMPG Flex — Sync Desktop & Mobile Installers/Artifacts to Cloudflare R2 DOWNLOADS Bucket
# ==============================================================================
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_DOWNLOADS="$PROJECT_DIR/server/downloads"

echo "╔══════════════════════════════════════════════════╗"
echo "║   Syncing local downloads directory to R2...     ║"
echo "╚══════════════════════════════════════════════════╝"

if [ ! -d "$LOCAL_DOWNLOADS" ]; then
  echo "Error: Local downloads directory ($LOCAL_DOWNLOADS) does not exist."
  exit 1
fi

echo ">>> Scanning $LOCAL_DOWNLOADS for installer artifacts..."

# Supported formats: .dmg, .exe, .blockmap, .yml, .yaml, .zip, .apk, .png, .html
for file_path in "$LOCAL_DOWNLOADS"/*; do
  [ -e "$file_path" ] || continue
  filename=$(basename "$file_path")
  ext="${filename##*.}"
  
  # Filter extensions defensively
  case "$ext" in
    dmg|exe|blockmap|yml|yaml|zip|apk|png|html)
      echo ">>> Uploading $filename to Cloudflare R2 bucket..."
      npx wrangler r2 object put "rmpg-flex-downloads/$filename" --file="$file_path" --remote
      ;;
    *)
      echo "    Skipping unsupported file type: $filename"
      ;;
  esac
done

echo ""
echo "✅ Local downloads synced successfully to Cloudflare R2!"
echo ""
