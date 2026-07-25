#!/bin/sh
# kiosk-linux/scripts/prune-firmware.sh
#
# Buildroot ROOTFS_POST_BUILD script (second entry in the defconfig's
# BR2_ROOTFS_POST_BUILD_SCRIPT list, after prune-stale-overlay.sh). Runs against
# the assembled target/ directory before the initramfs is packed. $1 is
# TARGET_DIR, passed by Buildroot.
#
# WHY THIS EXISTS
#
# BR2_PACKAGE_LINUX_FIRMWARE_I915 is all-or-nothing: it installs the entire
# i915 firmware directory, 26.9 MB, because Buildroot's linux-firmware.mk just
# adds "i915" to LINUX_FIRMWARE_DIRS and copies it wholesale.
#
# The split, measured on linux-firmware-20240115:
#   *_dmc*.bin   888 KB across 30 files  <- display power management, WANTED
#   *_guc*/huc*  25.0 MB                 <- GPU submission + media offload
#
# GuC submission is not enabled in this image and is not default on the Gen9.5
# parts the FZ-55 ships, so those 25 MB would ride in RAM on every terminal
# forever. This whole image is an INITRAMFS — every byte is resident memory on
# a machine that may only have 8 GB, and every byte is also OTA payload on a
# release channel that already cannot finish a single-shot upload.
#
# Keeping ALL DMC blobs rather than only the one the current hardware wants is
# deliberate: it is 888 KB, and i915 picks its blob by runtime platform
# detection (intel_dmc.c maps KBL/CFL/CML -> kbl_dmc_ver1_04.bin, ADL-P ->
# adlp_dmc.bin, and so on). Pruning per-model would silently break the day
# someone racks an FZ-55 revision nobody predicted, and that failure would look
# like a graphics bug rather than a missing file.
#
# Idempotent: Buildroot re-runs post-build scripts on every build, and the
# firmware package reinstalls its files each time, so this must tolerate both
# "already pruned" and "freshly reinstalled".
set -eu

TARGET_DIR="${1:-}"
if [ -z "$TARGET_DIR" ] || [ ! -d "$TARGET_DIR" ]; then
  echo "prune-firmware.sh: expected TARGET_DIR as \$1 (got '${TARGET_DIR}')" >&2
  exit 1
fi

FW_DIR="$TARGET_DIR/lib/firmware/i915"

# Not an error: a lean (KIOSK_LINUX_DESKTOP=0) build has no desktop fragment
# and therefore no i915 firmware package at all.
[ -d "$FW_DIR" ] || exit 0

before_kb="$(du -sk "$FW_DIR" | awk '{print $1}')"

# Delete everything that is not a DMC blob. Anything unrecognised is dropped
# rather than kept: a future linux-firmware bump that adds a new large blob
# family should NOT silently start riding along in the initramfs.
removed=0
for f in "$FW_DIR"/*; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in
    *dmc*) : ;;
    *) rm -rf "$f"; removed=$((removed + 1)) ;;
  esac
done

after_kb="$(du -sk "$FW_DIR" | awk '{print $1}')"
kept="$(find "$FW_DIR" -name '*dmc*' | wc -l | tr -d ' ')"

echo "prune-firmware.sh: i915 firmware ${before_kb}K -> ${after_kb}K (kept ${kept} DMC blob(s), removed ${removed} non-DMC entr(y|ies))"

# A build that keeps zero DMC blobs has silently lost the whole point of
# enabling the firmware package — fail loudly rather than shipping an image
# whose display power management is quietly dead.
if [ "$kept" -eq 0 ]; then
  echo "prune-firmware.sh: ERROR — no *dmc* blobs survived in $FW_DIR." >&2
  echo "  Either linux-firmware changed its i915 layout or the package did not install." >&2
  exit 1
fi
