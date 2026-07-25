#!/usr/bin/env bash
# kiosk-linux/scripts/prune-stale-overlay.sh
# Buildroot BR2_ROOTFS_POST_BUILD_SCRIPT — runs after the target directory is
# assembled, before any filesystem image is generated. $1 is TARGET_DIR.
#
# WHY THIS EXISTS
# Buildroot's target/ directory is incremental. The rootfs overlay is COPIED
# over it on every build, but a file DELETED from (or renamed within) the
# overlay is never removed from target/ — it lingers forever until someone
# runs a full clean, which on this project means rebuilding WebKit and losing
# an hour.
#
# That has now bitten twice, both times costing a full build-and-boot cycle to
# diagnose:
#
#   1. S99kiosk-net-marker was renamed to S98kiosk-net-marker so it would run
#      before the browser. Both files then existed in target/, so the network
#      check ran twice and the second (stale) run reported a contradictory
#      result in the boot log.
#
#   2. S99kiosk-browser-marker was retired when the desktop session replaced
#      the fullscreen-cog launcher. The stale copy kept starting cog, which
#      took DRM master, so X.Org could never acquire the display and died with
#      the extremely unhelpful "no screens found" — after ten restart attempts.
#      Worse, the leftover cog rendered a perfectly good Flex login page, so a
#      screenshot check that only asked "did anything paint?" called it a
#      success.
#
# The overlay is the single source of truth for /etc/init.d/S??kiosk-*, so any
# such script in target/ with no counterpart in the overlay is by definition
# stale and is removed here.
set -euo pipefail

TARGET_DIR="${1:?usage: prune-stale-overlay.sh <TARGET_DIR>}"
OVERLAY_DIR="/kiosk-linux/rootfs-overlay"

[ -d "$OVERLAY_DIR/etc/init.d" ] || exit 0

pruned=0
for script in "$TARGET_DIR"/etc/init.d/S[0-9][0-9]kiosk-*; do
  [ -e "$script" ] || continue
  name="$(basename "$script")"
  if [ ! -e "$OVERLAY_DIR/etc/init.d/$name" ]; then
    echo "prune-stale-overlay: removing stale init script $name (no longer in the overlay)"
    rm -f "$script"
    pruned=$((pruned + 1))
  fi
done

if [ "$pruned" -gt 0 ]; then
  echo "prune-stale-overlay: removed $pruned stale init script(s) from the target"
fi

exit 0
