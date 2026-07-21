#!/usr/bin/env bash
# uefi-bootsplash/test/run-qemu.sh
# Boots build/BOOTX64.EFI under QEMU+OVMF against a scratch FAT image, capturing
# serial console output to a log file for assertion by the calling test.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ESP_IMAGE="${1:-$SCRIPT_DIR/scratch-esp.img}"
LOG_FILE="${2:-$SCRIPT_DIR/boot.log}"
OVMF_CODE="$SCRIPT_DIR/ovmf/OVMF_CODE.fd"
OVMF_VARS="$SCRIPT_DIR/ovmf/OVMF_VARS.fd"

[ -f "$ESP_IMAGE" ] || { echo "ESP image not found: $ESP_IMAGE (run build-scratch-esp.sh first)" >&2; exit 1; }
[ -f "$OVMF_CODE" ] || { echo "OVMF_CODE.fd not found at $OVMF_CODE (these OVMF_*.fd files are committed at uefi-bootsplash/test/ovmf/, copied from Homebrew's bundled qemu edk2 firmware — see uefi-bootsplash/Makefile's header comment and build-gnuefi-pe.sh for the toolchain writeup)" >&2; exit 1; }
[ -f "$OVMF_VARS" ] || { echo "OVMF_VARS.fd not found at $OVMF_VARS (these OVMF_*.fd files are committed at uefi-bootsplash/test/ovmf/, copied from Homebrew's bundled qemu edk2 firmware — see uefi-bootsplash/Makefile's header comment and build-gnuefi-pe.sh for the toolchain writeup)" >&2; exit 1; }

rm -f "$LOG_FILE"

qemu-system-x86_64 \
  -machine q35 \
  -m 256M \
  -drive if=pflash,format=raw,readonly=on,file="$OVMF_CODE" \
  -drive if=pflash,format=raw,file="$OVMF_VARS" \
  -drive format=raw,file="$ESP_IMAGE" \
  -serial file:"$LOG_FILE" \
  -display none \
  -no-reboot \
  -no-shutdown &
QEMU_PID=$!

# Give the firmware+app time to run, then kill QEMU — this app either halts in a
# Stall loop (never exits) or successfully chainloads (also never returns), so we
# always need a timeout-based kill rather than waiting for a natural exit.
sleep 8
kill "$QEMU_PID" 2>/dev/null || true
wait "$QEMU_PID" 2>/dev/null || true

echo "wrote $LOG_FILE"
