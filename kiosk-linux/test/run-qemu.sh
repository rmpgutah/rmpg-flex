#!/usr/bin/env bash
# kiosk-linux/test/run-qemu.sh
# Boots the built kernel+initramfs under QEMU with a serial console, capturing
# output to a log file for assertion.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${1:-$SCRIPT_DIR/boot.log}"
KERNEL="$ROOT_DIR/output/images/bzImage"
INITRD="$ROOT_DIR/output/images/rootfs.cpio.gz"

[ -f "$KERNEL" ] || { echo "kernel not found at $KERNEL — run ./build.sh first" >&2; exit 1; }
[ -f "$INITRD" ] || { echo "initramfs not found at $INITRD — run ./build.sh first" >&2; exit 1; }

rm -f "$LOG_FILE"

# `timeout` is GNU coreutils and isn't present on a stock macOS host — prefer
# it if available (e.g. inside CI/Linux), otherwise fall back to Homebrew
# coreutils' `gtimeout` (`brew install coreutils`).
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_CMD="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_CMD="gtimeout"
else
  echo "ERROR: neither 'timeout' nor 'gtimeout' found on PATH. Install GNU coreutils:" >&2
  echo "  brew install coreutils" >&2
  exit 1
fi

"$TIMEOUT_CMD" 30 qemu-system-x86_64 \
  -kernel "$KERNEL" \
  -initrd "$INITRD" \
  -append "console=ttyS0" \
  -serial file:"$LOG_FILE" \
  -display none \
  -nographic \
  -no-reboot || true

echo "wrote $LOG_FILE"
