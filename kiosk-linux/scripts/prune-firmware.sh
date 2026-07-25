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
# adds "i915" to LINUX_FIRMWARE_DIRS and copies it wholesale. This image is an
# INITRAMFS, so every byte is resident RAM on every terminal forever.
#
# ⚠️ CORRECTED 2026-07-25 — DO NOT REINSTATE THE DMC-ONLY PRUNE.
#
# The first version of this script kept only *_dmc*.bin (888 KB) and deleted all
# GuC/HuC (25 MB), reasoning that "GuC submission is not enabled in this image
# and is not default on the Gen9.5 parts the FZ-55 ships". That reasoning was
# right for the Mk1 (Whiskey Lake, Gen9.5) and WRONG for the Mk3:
#
#   i915's uc_expand_default_options() excludes only TGL and RKL, then defaults
#   to ENABLE_GUC_LOAD_HUC | ENABLE_GUC_SUBMISSION. Alder/Raptor Lake-P — the
#   Mk3 — therefore REQUIRES i915/adlp_guc_*, and a DMC-only rootfs breaks it.
#
# That was established by the parallel FZ-55 hardware audit, which had to repair
# exactly this: a target/ carrying 33 DMC files while images/ held all 125 from
# the same tarball. Deleting GuC here would have silently re-broken their fix on
# the very hardware generation being bought now.
#
# So the prune is now narrow: drop ONLY the discrete-GPU families, which cannot
# physically be in a Toughbook, and keep every integrated-platform blob
# regardless of type. The saving is smaller and the correctness is not a guess.
#
# The size pressure that motivated the aggressive prune has also eased: OTA
# payloads are published and fetched in 16 MiB resumable chunks now, so a few
# extra MB no longer risks an unpublishable release.
#
# Keeping every integrated blob rather than only this quarter's model is
# deliberate for the same reason as before: i915 selects firmware by RUNTIME
# platform detection, so a per-model prune breaks the day someone racks a
# revision nobody predicted — and it fails looking like a graphics bug rather
# than a missing file.
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

# DENY-LIST, not an allow-list. The families below are discrete add-in GPUs (dg1,
# dg2/Alchemist) which cannot be fitted to a Toughbook. Everything else is kept
# whatever its type — DMC, GuC and HuC alike — because an integrated platform in
# or near this fleet may need any of the three, and getting that wrong is a dead
# display or a GPU that will not initialise.
#
# Deliberately the opposite structure to prune-stale-overlay.sh, which denies by
# default. There, an unrecognised file is junk; here, an unrecognised file is
# probably firmware some future revision needs, and the cost of keeping it is a
# few MB of RAM against the cost of dropping it being a bricked display.
removed=0
for f in "$FW_DIR"/*; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in
    dg1_*|dg2_*) rm -rf "$f"; removed=$((removed + 1)) ;;
    *) : ;;
  esac
done

after_kb="$(du -sk "$FW_DIR" | awk '{print $1}')"
dmc="$(find "$FW_DIR" -name '*dmc*' | wc -l | tr -d ' ')"
guc="$(find "$FW_DIR" -name '*guc*' | wc -l | tr -d ' ')"
huc="$(find "$FW_DIR" -name '*huc*' | wc -l | tr -d ' ')"

echo "prune-firmware.sh: i915 firmware ${before_kb}K -> ${after_kb}K (kept ${dmc} DMC / ${guc} GuC / ${huc} HuC, removed ${removed} discrete-GPU blob(s))"

# Assert on the blob families the fleet actually needs, so a linux-firmware
# layout change or a package that failed to install fails the BUILD rather than
# shipping a terminal whose display or GPU quietly does not come up.
#   DMC  — display power management, every generation
#   GuC  — required on Alder/Raptor Lake-P (Mk3); i915 enables submission by
#          default there, so its absence is not a degradation but a failure
missing=0
[ "$dmc" -eq 0 ] && { echo "prune-firmware.sh: ERROR — no *dmc* blobs in $FW_DIR." >&2; missing=1; }
if ! ls "$FW_DIR"/adlp_guc_*.bin >/dev/null 2>&1; then
  echo "prune-firmware.sh: ERROR — no adlp_guc_* blob in $FW_DIR." >&2
  echo "  The Mk3 (Raptor Lake-P) needs it: i915 uc_expand_default_options()" >&2
  echo "  defaults to ENABLE_GUC_SUBMISSION on that platform." >&2
  missing=1
fi
if [ "$missing" -ne 0 ]; then
  echo "  Either linux-firmware changed its i915 layout, or the package did not" >&2
  echo "  install (see the linux-firmware:fz55 entry in build.sh DESKTOP_STALE_PKGS —" >&2
  echo "  an already-built linux-firmware does NOT re-extract on a config change)." >&2
  exit 1
fi
