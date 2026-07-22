#!/usr/bin/env bash
# kiosk-linux/test/run-qemu-net.sh
# Boots the built kernel+initramfs under QEMU with a virtio-net NIC on a SLIRP
# (-netdev user) NAT interface, giving the guest real outbound internet access
# for testing without any host firewall/bridge configuration. This is a test
# harness convenience, not a claim about how a real deployed device gets
# network access (that's a real-hardware concern, explicitly deferred).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${1:-$SCRIPT_DIR/boot-net.log}"
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

rm -f "$LOG_FILE"

"$TIMEOUT_CMD" 30 qemu-system-x86_64 \
  -kernel "$KERNEL" \
  -initrd "$INITRD" \
  -append "console=ttyS0" \
  -netdev user,id=net0 \
  -device virtio-net-pci,netdev=net0 \
  -serial file:"$LOG_FILE" \
  -display none \
  -nographic \
  -no-reboot || true

echo "wrote $LOG_FILE"
