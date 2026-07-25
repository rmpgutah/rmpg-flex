#!/usr/bin/env bash
# kiosk-linux/scripts/publish-os-release.sh
# Publishes a built OS image to the STAGING update channel.
#
#   ./scripts/publish-os-release.sh [version]
#
# Uploads the kernel and root filesystem under version-stamped names, writes a
# manifest the on-device rmpg-update agent can parse, and puts it on STAGING
# ONLY.
#
# It deliberately never touches the stable channel. Promoting to stable — the
# point at which every terminal in the fleet will install this on its next
# restart — is a separate explicit act:
#
#   POST /api/os/promote  { "version": "<version>" }
#
# which requires an admin/manager and requires naming the exact version. That
# separation is the whole safety model: publishing a build must never be the
# same action as deploying it to vehicles. Test staging on one unit first.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$ROOT_DIR/.." && pwd)"
IMAGES_DIR="$ROOT_DIR/output/images"
BUCKET="rmpg-flex-downloads"
BASE_URL="https://api.rmpgutah.us/downloads"

VERSION="${1:-$(cat "$ROOT_DIR/rootfs-overlay/etc/rmpg-os-version" 2>/dev/null | tr -d '[:space:]')}"
[ -n "$VERSION" ] || { echo "ERROR: no version given and /etc/rmpg-os-version is empty" >&2; exit 1; }

KERNEL="$IMAGES_DIR/bzImage"
ROOTFS="$IMAGES_DIR/rootfs.cpio.gz"
for f in "$KERNEL" "$ROOTFS"; do
  [ -f "$f" ] || { echo "ERROR: $f not found — run ./build.sh first" >&2; exit 1; }
done

# Refuse to publish an image that has not been boot-verified. A published
# manifest is an instruction to a fleet; "it compiled" is not evidence it boots.
BOOT_LOG="$ROOT_DIR/test/boot-desktop.log"
if [ "${SKIP_BOOT_CHECK:-0}" != "1" ]; then
  if [ ! -f "$BOOT_LOG" ]; then
    echo "ERROR: no boot log at $BOOT_LOG — run test/run-qemu-desktop.sh before publishing." >&2
    echo "       (SKIP_BOOT_CHECK=1 overrides, but then say so in the release notes.)" >&2
    exit 1
  fi
  if ! grep -q "KIOSK_LINUX_DESKTOP_OK\|KIOSK_LINUX_CONSOLE_FALLBACK_OK" "$BOOT_LOG"; then
    echo "ERROR: $BOOT_LOG shows no healthy session marker." >&2
    echo "       Expected KIOSK_LINUX_DESKTOP_OK or KIOSK_LINUX_CONSOLE_FALLBACK_OK." >&2
    exit 1
  fi
  echo "Boot verification found in $BOOT_LOG"
fi

sha() { shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1 || sha256sum "$1" | cut -d' ' -f1; }

KERNEL_NAME="kiosk-os-${VERSION}-bzImage"
ROOTFS_NAME="kiosk-os-${VERSION}-rootfs.cpio.gz"
KERNEL_SHA="$(sha "$KERNEL")"
ROOTFS_SHA="$(sha "$ROOTFS")"

echo "Publishing RMPG Flex OS $VERSION to the STAGING channel"
echo "  kernel: $(du -h "$KERNEL" | cut -f1)  sha256 ${KERNEL_SHA:0:16}…"
echo "  rootfs: $(du -h "$ROOTFS" | cut -f1)  sha256 ${ROOTFS_SHA:0:16}…"

cd "$REPO_DIR"

# Payloads first, manifest last. A terminal that polls mid-publish must never
# receive a manifest naming files that are not fully uploaded yet.
echo "Uploading kernel ..."
npx wrangler r2 object put "$BUCKET/$KERNEL_NAME" --file="$KERNEL" --remote >/dev/null

# NOTE ON THE LARGE UPLOAD (observed 2026-07-25):
# `wrangler r2 object put` on the ~244 MiB rootfs stalled for 1h21m without
# completing or erroring, while the 13 MB kernel uploaded in seconds on the same
# run. It is a single-shot PUT with no resume and no progress output, so a slow
# or lossy uplink looks identical to a hang — and killing it leaves the payload
# absent while the kernel is already up.
#
# That partial state is SAFE by construction: the manifest is written last, so a
# terminal can never discover a release whose payload did not finish uploading.
# Do not reorder these steps.
#
# If this stalls, the workarounds in preference order are:
#   1. Re-run — the kernel step is idempotent and quick, so only the rootfs
#      retries.
#   2. Upload the rootfs from a machine with better upstream bandwidth, then
#      re-run with SKIP_PAYLOAD=1 to write just the manifest.
#   3. Use the Cloudflare dashboard's R2 uploader, which does multipart.
if [ "${SKIP_PAYLOAD:-0}" = "1" ]; then
  echo "SKIP_PAYLOAD=1 — assuming payloads are already uploaded; writing the manifest only."
else
  echo "Uploading root filesystem (large — see the note in this script if it stalls) ..."
  npx wrangler r2 object put "$BUCKET/$ROOTFS_NAME" --file="$ROOTFS" --remote >/dev/null
fi

MANIFEST_FILE="$(mktemp -t rmpg-os-manifest)"
cat > "$MANIFEST_FILE" <<MANIFEST
# RMPG Flex OS update manifest — staging channel
# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ)
version=$VERSION
kernel_url=$BASE_URL/$KERNEL_NAME
kernel_sha256=$KERNEL_SHA
rootfs_url=$BASE_URL/$ROOTFS_NAME
rootfs_sha256=$ROOTFS_SHA
MANIFEST

echo "Uploading manifest ..."
npx wrangler r2 object put "$BUCKET/os/staging/manifest.txt" \
  --file="$MANIFEST_FILE" --content-type "text/plain" --remote >/dev/null
rm -f "$MANIFEST_FILE"

echo
echo "Published to STAGING. Verify, then promote deliberately:"
echo "  curl -s 'https://api.rmpgutah.us/api/os/manifest?channel=staging'"
echo "  # test on ONE terminal, then:"
echo "  curl -X POST https://api.rmpgutah.us/api/os/promote \\"
echo "    -H 'Authorization: Bearer <admin token>' -H 'Content-Type: application/json' \\"
echo "    -d '{\"version\":\"$VERSION\"}'"
