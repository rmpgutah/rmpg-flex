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

# THE ROOTFS IS UPLOADED IN CHUNKS, NOT AS ONE OBJECT.
#
# `wrangler r2 object put` on the ~244 MiB rootfs stalled for 1h21m twice
# without completing or erroring, while the 13 MB kernel uploaded in seconds on
# the same runs. It is a single-shot PUT with no resume and no progress output,
# so a slow or lossy uplink is indistinguishable from a hang.
#
# Chunking fixes the same problem at BOTH ends, which is why it is worth doing
# properly rather than retrying:
#   * Publishing: each part is small enough to succeed or fail fast, and a
#     re-run skips parts already uploaded instead of restarting 244 MiB.
#   * Installing: a terminal on field Wi-Fi downloads and verifies one part at a
#     time and can resume. A single 250 MB GET that dies at 90% previously threw
#     the whole transfer away — on the exact connection these terminals have.
#
# 16 MiB parts: small enough that one failure costs seconds, large enough that a
# 244 MiB payload is ~16 requests rather than hundreds.
CHUNK_MB="${CHUNK_MB:-16}"

if [ "${SKIP_PAYLOAD:-0}" = "1" ]; then
  echo "SKIP_PAYLOAD=1 — assuming payloads are already uploaded; writing the manifest only."
  # Recompute the chunk list so the manifest still describes reality.
  CHUNK_DIR="$(mktemp -d -t rmpg-os-chunks)"
  split -b "${CHUNK_MB}m" "$ROOTFS" "$CHUNK_DIR/part-"
else
  CHUNK_DIR="$(mktemp -d -t rmpg-os-chunks)"
  echo "Splitting the root filesystem into ${CHUNK_MB} MiB parts ..."
  # split's default suffixes are alphabetic (part-aa, part-ab, ...), which sort
  # correctly lexically, so `cat` in glob order reassembles the original exactly
  # — verified byte-for-byte against the source with sha256. Two letters allow
  # 676 parts; a 244 MiB payload at 16 MiB each uses 16.
  split -b "${CHUNK_MB}m" "$ROOTFS" "$CHUNK_DIR/part-"

  CHUNK_TOTAL="$(ls "$CHUNK_DIR" | wc -l | tr -d ' ')"
  echo "Uploading $CHUNK_TOTAL parts ..."
  n=0
  for part in "$CHUNK_DIR"/part-*; do
    n=$((n + 1))
    part_name="kiosk-os-${VERSION}-rootfs.part-$(basename "$part" | sed 's/^part-//')"
    printf "  [%2d/%2d] %s ... " "$n" "$CHUNK_TOTAL" "$part_name"
    # Skip parts already present so an interrupted publish resumes rather than
    # re-uploading everything.
    if npx wrangler r2 object get "$BUCKET/$part_name" --remote --file=/dev/null >/dev/null 2>&1; then
      echo "already uploaded"
      continue
    fi
    if npx wrangler r2 object put "$BUCKET/$part_name" --file="$part" --remote >/dev/null 2>&1; then
      echo "ok"
    else
      echo "FAILED"
      echo "ERROR: part $part_name failed to upload. Re-run this script — completed parts are skipped." >&2
      rm -rf "$CHUNK_DIR"
      exit 1
    fi
  done
fi

# Per-part digests go in the manifest so the terminal can verify each part as it
# arrives and re-fetch just the bad one, instead of discovering corruption only
# after reassembling the whole 244 MiB.
CHUNK_LIST=""
for part in "$CHUNK_DIR"/part-*; do
  suffix="$(basename "$part" | sed 's/^part-//')"
  CHUNK_LIST="${CHUNK_LIST}rootfs_part=${BASE_URL}/kiosk-os-${VERSION}-rootfs.part-${suffix} $(sha "$part")
"
done
CHUNK_COUNT="$(ls "$CHUNK_DIR" | wc -l | tr -d ' ')"
rm -rf "$CHUNK_DIR"

MANIFEST_FILE="$(mktemp -t rmpg-os-manifest)"
cat > "$MANIFEST_FILE" <<MANIFEST
# RMPG Flex OS update manifest — staging channel
# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ)
version=$VERSION
kernel_url=$BASE_URL/$KERNEL_NAME
kernel_sha256=$KERNEL_SHA
rootfs_sha256=$ROOTFS_SHA
rootfs_parts=$CHUNK_COUNT
$CHUNK_LIST
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
