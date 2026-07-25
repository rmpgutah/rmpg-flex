#!/usr/bin/env bash
# kiosk-linux/test/run-qemu-desktop.sh
# Boots the desktop image under QEMU and captures a screenshot of the running
# desktop (taskbar, Start menu, RMPG Flex window).
#
# Differences from run-qemu-browser.sh, all of them load-bearing:
#
#   -m 3072  The desktop rootfs is far larger than the kiosk one (X.org, GTK3,
#            WebKitGTK, midori-class browser), and it is an INITRAMFS — the
#            whole thing is decompressed into RAM at boot. 1024 MB was enough
#            for the kiosk image but cannot hold this one, and the failure mode
#            is an early kernel panic ("Unable to mount root fs"), not a
#            civilised out-of-memory message.
#
#   -smp 2   X plus a window manager plus a browser on a single emulated core
#            under TCG is painfully slow to reach a painted desktop.
#
#   longer   X startup + window manager + panel + a real HTTPS page load, all
#   capture  without KVM, is slower than the kiosk browser alone.
#   delay
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${1:-$SCRIPT_DIR/boot-desktop.log}"
SCREENSHOT_FILE="${2:-$SCRIPT_DIR/desktop-screenshot.ppm}"
CAPTURE_DELAY="${KIOSK_DESKTOP_CAPTURE_DELAY:-240}"
DISK_IMG="$ROOT_DIR/output/images/disk.img"

[ -f "$DISK_IMG" ] || { echo "disk image not found at $DISK_IMG — run ./build.sh first" >&2; exit 1; }

if command -v timeout >/dev/null 2>&1; then TIMEOUT_CMD="timeout"
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_CMD="gtimeout"
else echo "ERROR: install GNU coreutils (brew install coreutils)" >&2; exit 1; fi
command -v socat >/dev/null 2>&1 || { echo "ERROR: socat not found (brew install socat)" >&2; exit 1; }

# Monitor sockets must live directly under /tmp: a path inside this worktree
# exceeds the 104-byte sockaddr_un limit and QEMU fails to create the socket.
MONITOR_SOCK="$(mktemp -u /tmp/kiosk-desktop-mon.XXXXXX.sock)"
rm -f "$LOG_FILE" "$SCREENSHOT_FILE" "$MONITOR_SOCK"

echo "Booting the desktop image (capture at t+${CAPTURE_DELAY}s) ..."
"$TIMEOUT_CMD" $((CAPTURE_DELAY + 120)) qemu-system-x86_64 \
  -drive file="$DISK_IMG",if=virtio,format=raw \
  -m 3072 \
  -smp 2 \
  -netdev user,id=net0 \
  -device virtio-net-pci,netdev=net0 \
  -vga none \
  -device virtio-gpu-pci \
  -serial file:"$LOG_FILE" \
  -monitor unix:"$MONITOR_SOCK",server,nowait \
  -display none \
  -no-reboot &
QEMU_PID=$!

for _ in $(seq 1 60); do [ -S "$MONITOR_SOCK" ] && break; sleep 0.5; done

sleep "$CAPTURE_DELAY"

# QEMU parses `screendump` arguments on spaces with no quoting, so an absolute
# path containing a space (this repo lives under "RMPG Flex/") is read as two
# arguments and fails with "Device ... not found". Dump to a space-free temp
# path and move it into place afterwards.
DUMP_TMP="$(mktemp -u /tmp/kiosk-desktop-dump.XXXXXX.ppm)"
(echo "screendump $DUMP_TMP"; sleep 3) | socat - UNIX-CONNECT:"$MONITOR_SOCK" >/dev/null 2>&1 \
  || echo "WARNING: screendump command failed" >&2
sleep 2
[ -s "$DUMP_TMP" ] && mv "$DUMP_TMP" "$SCREENSHOT_FILE"

kill "$QEMU_PID" 2>/dev/null || true
wait "$QEMU_PID" 2>/dev/null || true
rm -f "$MONITOR_SOCK"

echo
echo "=== boot markers ==="
grep -E "KIOSK_LINUX_" "$LOG_FILE" 2>/dev/null || echo "(none found — see $LOG_FILE)"

echo
echo "=== crashes ==="
if grep -qiE "segfault|Kernel panic|Oops" "$LOG_FILE" 2>/dev/null; then
  grep -iE "segfault|Kernel panic|Oops" "$LOG_FILE" | head -5
else
  echo "none"
fi

echo
echo "log:        $LOG_FILE"
if [ -s "$SCREENSHOT_FILE" ]; then
  echo "screenshot: $SCREENSHOT_FILE"
  # A uniform screenshot means the desktop never painted. Distinct-colour count
  # is the same cheap check that caught the blank-white browser regression, and
  # it is far more reliable than eyeballing a thumbnail.
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$SCREENSHOT_FILE" <<'PY'
import sys
from collections import Counter
data = open(sys.argv[1], 'rb').read()
parts = data.split(b'\n', 3)
if len(parts) < 4 or parts[0] != b'P6':
    print("colours:    (not a P6 PPM — cannot analyse)"); sys.exit()
px = parts[3]
counts = Counter(px[i:i+3] for i in range(0, len(px) - 2, 3))
n = len(counts)
top, freq = counts.most_common(1)[0]
print(f"colours:    {n} distinct; most common #{top.hex()} covers {100*freq/max(1,sum(counts.values())):.1f}%")
print("verdict:    " + ("LIKELY BLANK — desktop did not paint" if n < 20
                        else "desktop painted real content"))
PY
  fi
else
  echo "NO SCREENSHOT CAPTURED"
fi
