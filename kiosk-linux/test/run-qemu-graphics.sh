#!/usr/bin/env bash
# kiosk-linux/test/run-qemu-graphics.sh
# Boots the built kernel+initramfs under QEMU WITH a virtio-gpu display device
# (unlike test/run-qemu.sh's -nographic, which has no display device at all),
# capturing both the serial console log and a screenshot for visual proof.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${1:-$SCRIPT_DIR/boot-graphics.log}"
SCREENSHOT_FILE="${2:-$SCRIPT_DIR/drm-screenshot.ppm}"
KERNEL="$ROOT_DIR/output/images/bzImage"
INITRD="$ROOT_DIR/output/images/rootfs.cpio.gz"

[ -f "$KERNEL" ] || { echo "kernel not found at $KERNEL — run ./build.sh first" >&2; exit 1; }
[ -f "$INITRD" ] || { echo "initramfs not found at $INITRD — run ./build.sh first" >&2; exit 1; }

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

# The monitor socket path must live under /tmp, not $SCRIPT_DIR — a Unix domain
# socket path is capped at 104 bytes (sockaddr_un), and this repo's deeply nested
# git-worktree paths (e.g. .../worktrees/<long-name>/kiosk-linux/test/...) routinely
# exceed that, failing with "UNIX socket path ... is too long". mktemp keeps this
# collision-free across concurrent runs/worktrees.
MONITOR_SOCK="$(mktemp -u /tmp/kiosk-linux-qemu-monitor.XXXXXX.sock)"

rm -f "$LOG_FILE" "$SCREENSHOT_FILE" "$MONITOR_SOCK"

# Runs QEMU with a real virtio-gpu display, a monitor socket for the screendump
# command, and serial console logging — same screenshot-capture technique
# uefi-bootsplash's Task 2 established for verifying GOP rendering. socat (real
# method that worked in this environment — `brew install socat`) bridges stdio
# to the QEMU monitor unix socket to issue `screendump`.
#
# -vga none is required: the default q35/pc machine type also instantiates a
# standard VGA adapter unless explicitly disabled, and QEMU's `screendump`
# captures from that default/primary display, not necessarily the added
# virtio-gpu-pci device. Without -vga none, every screendump here captured a
# stale early-boot VGA text frame (SeaBIOS/kernel decompression text) — the
# same frame every run — even though the serial log genuinely showed
# KIOSK_LINUX_DRM_OK and modetest had actually committed a mode on
# virtio-gpu-pci. Confirmed by re-running with -vga none and getting a
# different, real captured frame.
"$TIMEOUT_CMD" 30 qemu-system-x86_64 \
  -kernel "$KERNEL" \
  -initrd "$INITRD" \
  -append "console=ttyS0" \
  -vga none \
  -device virtio-gpu-pci \
  -serial file:"$LOG_FILE" \
  -monitor unix:"$MONITOR_SOCK",server,nowait \
  -display none \
  -no-reboot &
QEMU_PID=$!

# Give the kernel+initramfs time to boot to the DRM-marker init script and
# actually draw a frame via modetest before we snapshot the framebuffer.
sleep 8

# Wait for the monitor socket to exist (QEMU creates it early, but not
# instantly) before handing off to socat.
for _ in $(seq 1 20); do
  [ -S "$MONITOR_SOCK" ] && break
  sleep 0.5
done

echo "screendump $SCREENSHOT_FILE" | socat - UNIX-CONNECT:"$MONITOR_SOCK" 2>/dev/null || \
  echo "WARNING: screendump failed via socat" >&2

# Give QEMU a moment to finish writing the screendump file before we kill it.
sleep 1

kill "$QEMU_PID" 2>/dev/null || true
wait "$QEMU_PID" 2>/dev/null || true
rm -f "$MONITOR_SOCK"

echo "wrote $LOG_FILE"
[ -f "$SCREENSHOT_FILE" ] && echo "wrote $SCREENSHOT_FILE"
