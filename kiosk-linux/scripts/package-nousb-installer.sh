#!/usr/bin/env bash
# kiosk-linux/scripts/package-nousb-installer.sh
#
# Assembles the no-USB (install-from-Windows) bundle.
#
# ── WHY THIS IS A SCRIPT AND NOT A DOC STEP ──────────────────────────────────
#
# The no-USB path is the PRIMARY install method for this fleet: it needs no USB
# stick carried to each vehicle. Its installer refuses to run unless three files
# sit beside it — bzImage, rootfs.cpio.gz and grubx64.efi.
#
# The build does produce all three, but the third one is not called grubx64.efi.
# Buildroot emits it as output/images/efi-part/EFI/BOOT/bootx64.efi, and
# RELEASE.md never mentioned packaging it at all — so anyone following the
# documented release process produced a download that could not perform a no-USB
# install, and the failure appeared as the installer refusing to start on the
# operator machine.
#
# A rename buried in prose is exactly the sort of step that gets skipped, so it
# lives here instead.
#
# Usage: kiosk-linux/scripts/package-nousb-installer.sh [output-dir]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGES="$ROOT_DIR/output/images"
OUT_DIR="${1:-$ROOT_DIR/output}"

VERSION="$(tr -d '[:space:]' < "$ROOT_DIR/rootfs-overlay/etc/rmpg-os-version")"
[ -n "$VERSION" ] || { echo "ERROR: could not read the OS version" >&2; exit 1; }

BUNDLE="rmpg-flex-os-nousb-installer-$VERSION"
STAGE="$OUT_DIR/$BUNDLE"

KERNEL="$IMAGES/bzImage"
ROOTFS="$IMAGES/rootfs.cpio.gz"
# Buildroot names the EFI application bootx64.efi (the removable-media default
# name firmware looks for). The installer copies it to the ESP under its own
# vendor directory and points a firmware boot entry at it by the name below.
EFI_SRC="$IMAGES/efi-part/EFI/BOOT/bootx64.efi"

missing=0
for f in "$KERNEL" "$ROOTFS" "$EFI_SRC"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: missing build artifact: $f" >&2
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  echo "" >&2
  echo "Run ./build.sh first. If only the .efi is missing, check that" >&2
  echo "BR2_TARGET_GRUB2_X86_64_EFI=y survived into the Buildroot .config." >&2
  exit 1
fi

rm -rf "$STAGE"
mkdir -p "$STAGE"

cp "$KERNEL" "$STAGE/bzImage"
cp "$ROOTFS" "$STAGE/rootfs.cpio.gz"
cp "$EFI_SRC" "$STAGE/grubx64.efi"
cp "$ROOT_DIR/installer-windows/Install-RmpgFlexOS.ps1"   "$STAGE/"
cp "$ROOT_DIR/installer-windows/Uninstall-RmpgFlexOS.ps1" "$STAGE/"
cp "$ROOT_DIR/installer-windows/INSTALL - Double-click me.bat" "$STAGE/"

# Space note in the bundle itself. The installer seeds BOTH A/B slots, so the
# requirement is twice the payload — the single most likely reason an install
# stops partway on a nearly-full vehicle laptop.
payload_mb=$(( ( $(stat -f %z "$STAGE/bzImage" 2>/dev/null || stat -c %s "$STAGE/bzImage") \
               + $(stat -f %z "$STAGE/rootfs.cpio.gz" 2>/dev/null || stat -c %s "$STAGE/rootfs.cpio.gz") ) / 1024 / 1024 ))
cat > "$STAGE/READ-ME-FIRST.txt" <<EOF
RMPG Flex OS $VERSION - install from Windows, no USB stick required

Right-click "INSTALL - Double-click me.bat" and choose "Run as administrator".

What it does:
  - copies the OS into C:\\RMPG-Flex-OS\\slot_a and \\slot_b
  - copies a bootloader to the EFI System Partition
  - adds a firmware boot entry named "RMPG Flex OS"
  - leaves Windows installed and bootable; the menu offers both

Free space required on C: about $(( payload_mb * 2 + 200 )) MB
  (${payload_mb} MB per slot, and it installs two slots so a bad update can
   roll back to the previous one without a site visit)

To remove it, run Uninstall-RmpgFlexOS.ps1 as administrator.

IMPORTANT before installing: fully shut Windows down at least once with Fast
Startup disabled, or hibernated. A volume left dirty by Fast Startup cannot be
written by the OS updater, so over-the-air updates will report the store as
read-only.
EOF

if command -v zip >/dev/null 2>&1; then
  ( cd "$OUT_DIR" && rm -f "$BUNDLE.zip" && zip -9 -r -q "$BUNDLE.zip" "$BUNDLE" )
  echo "Bundle: $OUT_DIR/$BUNDLE.zip ($(du -h "$OUT_DIR/$BUNDLE.zip" | cut -f1))"
else
  echo "WARNING: zip not found — the staging directory is ready but not archived" >&2
fi

echo "Staged: $STAGE"
ls -la "$STAGE"
echo ""
echo "A .zip is used rather than .tar.gz on purpose: these installs are done from"
echo "Windows machines, which cannot open a .tar.gz by double-clicking."
