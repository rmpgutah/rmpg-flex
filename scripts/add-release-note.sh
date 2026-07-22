#!/usr/bin/env bash
# Insert a release note into live D1 `download_releases` for the Downloads
# page's "What's New" section.
#
# Usage:
#   scripts/add-release-note.sh <version> <release_date YYYY-MM-DD> <notes-file>
#
# <notes-file> is a plain text file, one bullet point per line.
#
# Example:
#   echo -e "Added Kiosk Linux OS image download\nFixed ALPR capture retry bug" > /tmp/notes.txt
#   scripts/add-release-note.sh 5.8.5 2026-07-22 /tmp/notes.txt

set -euo pipefail

if [ $# -ne 3 ]; then
  echo "usage: $0 <version> <release_date YYYY-MM-DD> <notes-file>" >&2
  exit 64
fi

VERSION="$1"
RELEASE_DATE="$2"
NOTES_FILE="$3"

if [ ! -f "$NOTES_FILE" ]; then
  echo "error: $NOTES_FILE does not exist" >&2
  exit 66
fi

if ! [[ "$RELEASE_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "error: release_date must be YYYY-MM-DD, got: $RELEASE_DATE" >&2
  exit 65
fi

# Escape single quotes for the SQL literal (' -> '')
NOTES_ESCAPED=$(sed "s/'/''/g" "$NOTES_FILE")
VERSION_ESCAPED=$(printf '%s' "$VERSION" | sed "s/'/''/g")

echo "→ inserting release note for v$VERSION ($RELEASE_DATE) into live D1 (rmpg-flex)..."
npx wrangler d1 execute rmpg-flex --remote --command \
  "INSERT INTO download_releases (version, release_date, notes) VALUES ('$VERSION_ESCAPED', '$RELEASE_DATE', '$NOTES_ESCAPED')"

echo "✓ release note for v$VERSION inserted"
