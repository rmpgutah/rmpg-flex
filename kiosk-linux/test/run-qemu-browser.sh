#!/usr/bin/env bash
# kiosk-linux/test/run-qemu-browser.sh
# Boots the built kernel+initramfs under QEMU with both a virtio-net NIC
# (SLIRP NAT, real outbound access) and a virtio-gpu display device, capturing
# the serial log plus a screenshot once the kiosk browser has had time to load
# the real page — reuses run-qemu-graphics.sh's proven screenshot technique
# (-vga none + virtio-gpu-pci + socat screendump over the QEMU monitor socket),
# with a longer capture delay: WPE WebKit + a real network page load takes
# noticeably longer than modetest's near-instant run in sub-project 2.
#
# -m 1024: sub-project 1/2's default QEMU memory (no -m flag => 128MB) is
# nowhere near enough once WPE WebKit + Cog are in the initramfs (rootfs.cpio.gz
# grew from ~3MB to ~71MB gzipped, likely 300MB+ uncompressed). Without this,
# the kernel's initramfs population fails silently under memory pressure and
# boot panics almost immediately with "VFS: Unable to mount root fs on
# unknown-block(0,0)" / "/dev/root: Can't open blockdev" — confirmed by a real
# run that hit exactly this panic with no -m flag set.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${1:-$SCRIPT_DIR/boot-browser.log}"
SCREENSHOT_FILE="${2:-$SCRIPT_DIR/browser-screenshot.ppm}"
DISK_IMG="$ROOT_DIR/output/images/disk.img"

[ -f "$DISK_IMG" ] || { echo "disk image not found at $DISK_IMG — run ./build.sh first" >&2; exit 1; }

if command -v timeout >/dev/null 2>&1; then TIMEOUT_CMD="timeout"
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_CMD="gtimeout"
else
  echo "ERROR: neither 'timeout' nor 'gtimeout' found. Install GNU coreutils:" >&2
  echo "  brew install coreutils" >&2
  exit 1
fi

if ! command -v socat >/dev/null 2>&1; then
  echo "ERROR: socat not found. Install it:" >&2
  echo "  brew install socat" >&2
  exit 1
fi

MONITOR_SOCK="$(mktemp -u /tmp/kiosk-linux-qemu-monitor.XXXXXX.sock)"

rm -f "$LOG_FILE" "$SCREENSHOT_FILE" "$MONITOR_SOCK"

# format=raw: disk.img (assembled by assemble-disk-image.sh) is a plain raw
# image, not qcow2/vmdk — this silences QEMU's raw-format-probe warning and
# skips the (irrelevant) format auto-detection.
#
# -no-reboot: A/B boot partition (sub-project 5) — if S01kiosk-boot-slot-check
# force-reboots after 3 failed attempts (flipping extlinux.conf's default
# slot), -no-reboot makes QEMU EXIT on that guest reboot instead of actually
# rebooting inside this same process/log. This is intentional, not a bug: the
# flipped default and reset boot_attempts counter are already persisted to
# disk.img by that point, so the self-heal is real — verifying it just takes
# a SEPARATE run of this script afterward (which will show a fresh
# KIOSK_LINUX_BOOT_ATTEMPT 1 on the now-recovered slot) rather than a second
# boot cycle appearing in the same log file. Also prevents an actual
# both-slots-broken infinite reboot loop from hanging this test harness.
"$TIMEOUT_CMD" 150 qemu-system-x86_64 \
  -drive file="$DISK_IMG",if=virtio,format=raw \
  -m 1024 \
  -netdev user,id=net0 \
  -device virtio-net-pci,netdev=net0 \
  -vga none \
  -device virtio-gpu-pci \
  -serial file:"$LOG_FILE" \
  -monitor unix:"$MONITOR_SOCK",server,nowait \
  -display none \
  -no-reboot &
QEMU_PID=$!

# DHCP + HTTP reachability check (Task 1) + WPE WebKit startup + a real page
# load over the network all take meaningfully longer than sub-project 2's
# modetest-only boot. A first real run with a 25s wait was too short — the
# boot log showed KIOSK_LINUX_BOOT_OK reached at ~t=24s with the net/browser
# marker scripts still running (no software KVM acceleration under QEMU TCG
# means cold WebKit process startup + a real HTTPS round-trip is slow) — 90s
# gives real headroom for the full net+browser marker chain to complete.
sleep 90

for _ in $(seq 1 20); do
  [ -S "$MONITOR_SOCK" ] && break
  sleep 0.5
done

echo "screendump $SCREENSHOT_FILE" | socat - UNIX-CONNECT:"$MONITOR_SOCK" 2>/dev/null || \
  echo "WARNING: screendump failed via socat" >&2

sleep 1

kill "$QEMU_PID" 2>/dev/null || true
wait "$QEMU_PID" 2>/dev/null || true
rm -f "$MONITOR_SOCK"

echo "wrote $LOG_FILE"
[ -f "$SCREENSHOT_FILE" ] && echo "wrote $SCREENSHOT_FILE"
