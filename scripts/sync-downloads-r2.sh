#!/bin/bash
# ============================================================
# RMPG Flex — Sync installers to Cloudflare R2 DOWNLOADS Bucket
# ============================================================
set -e

LOCAL_DOWNLOADS="server/downloads"

echo ">>> Syncing installers from $LOCAL_DOWNLOADS to R2 (rmpg-flex-downloads)..."

if [ ! -d "$LOCAL_DOWNLOADS" ]; then
  echo "Error: $LOCAL_DOWNLOADS directory not found."
  echo "Create it or run the desktop build scripts first."
  exit 1
fi

for file_path in "$LOCAL_DOWNLOADS"/*; do
  [ -e "$file_path" ] || continue
  filename=$(basename "$file_path")
  ext="${filename##*.}"
  case "$ext" in
    dmg|exe|blockmap|yml|yaml|zip|apk|png|html)
      echo "  Uploading $filename..."
      npx wrangler r2 object put "rmpg-flex-downloads/$filename" --file="$file_path" --remote
      ;;
    *)
      echo "  Skipping $filename (unsupported type)"
      ;;
  esac
done

echo "✅ Done!"
