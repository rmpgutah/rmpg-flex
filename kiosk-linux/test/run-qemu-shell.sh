#!/usr/bin/env bash
# kiosk-linux/test/run-qemu-shell.sh
# Boots the image, logs in on the serial console, runs commands, prints output.
#
#   ./test/run-qemu-shell.sh "cat /var/log/Xorg.0.log" "dmesg | tail -20"
#
# Exists because the alternative is guess-rebuild-boot, and each of those
# cycles costs ~10 minutes. Reading the log the failing component actually
# wrote takes one boot. Two wrong hypotheses about an X startup failure —
# DRM-master contention, then PCI device class — were each "fixed", rebuilt and
# re-booted before anyone looked at /var/log/Xorg.0.log, which is inside the
# guest and never reaches the serial console.
#
# QEMU's `-serial unix:...,server` chardev serves ONE client, so all input and
# output must share a single socat session; a second connection for input is
# silently ignored and the guest sees nothing typed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DISK_IMG="$ROOT_DIR/output/images/disk.img"
LOG_FILE="${KIOSK_SHELL_LOG:-$SCRIPT_DIR/shell-session.log}"
BOOT_WAIT="${KIOSK_SHELL_BOOT_WAIT:-100}"

[ $# -ge 1 ] || { echo "usage: $0 <command> [command ...]" >&2; exit 1; }
[ -f "$DISK_IMG" ] || { echo "disk image not found at $DISK_IMG" >&2; exit 1; }

if command -v timeout >/dev/null 2>&1; then TIMEOUT_CMD="timeout"; else TIMEOUT_CMD="gtimeout"; fi

SERIAL_SOCK="$(mktemp -u /tmp/kiosk-shell-ser.XXXXXX.sock)"
rm -f "$LOG_FILE" "$SERIAL_SOCK"

# 3 GB / 2 cores: the desktop initramfs does not fit in less, and the failure
# mode is an early kernel panic rather than a clear message.
"$TIMEOUT_CMD" $((BOOT_WAIT + 20 * $# + 90)) qemu-system-x86_64 \
  -drive file="$DISK_IMG",if=virtio,format=raw \
  -m 3072 -smp 2 \
  -netdev user,id=net0 -device virtio-net-pci,netdev=net0 \
  -vga none -device virtio-gpu-pci \
  -serial unix:"$SERIAL_SOCK",server,nowait \
  -display none -no-reboot &
QEMU_PID=$!

for _ in $(seq 1 80); do [ -S "$SERIAL_SOCK" ] && break; sleep 0.5; done

{
  sleep "$BOOT_WAIT"
  printf '\r'; sleep 2
  printf 'root\r'; sleep 4          # Buildroot root login, no password
  for cmd in "$@"; do
    printf '\r'; sleep 1
    printf 'echo ===== %s =====\r' "$cmd"; sleep 1
    printf '%s\r' "$cmd"
    sleep 12
  done
  printf 'echo ===== SESSION COMPLETE =====\r'; sleep 3
} | socat - UNIX-CONNECT:"$SERIAL_SOCK" > "$LOG_FILE" 2>/dev/null || true

kill "$QEMU_PID" 2>/dev/null || true
wait "$QEMU_PID" 2>/dev/null || true
rm -f "$SERIAL_SOCK"

# Strip CR and ANSI colour so the transcript greps cleanly.
tr -d '\r' < "$LOG_FILE" | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' > "$LOG_FILE.clean"
mv "$LOG_FILE.clean" "$LOG_FILE"
echo "transcript: $LOG_FILE"
