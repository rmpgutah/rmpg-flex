#!/usr/bin/env bash
# kiosk-linux/test/run-qemu-nvme.sh
#
# Boots the SAME disk image as run-qemu-desktop.sh, but presents it to the guest
# as an NVMe namespace (or an AHCI/SATA disk) instead of a virtio-blk device.
#
# ── WHY THIS TEST EXISTS ─────────────────────────────────────────────────────
#
# Every other test in this directory boots with `-drive if=virtio`, so the guest
# always sees /dev/vda and its single partition as /dev/vda1. Both the A/B
# failed-boot counter and the OTA updater used to hardcode that name. The result
# was a fleet-wide defect that no test could see: under QEMU rollback and OTA
# worked perfectly, while on a Panasonic Toughbook FZ-55 — whose stock storage is
# an NVMe SSD, enumerated as /dev/nvme0n1p1 — the mount failed, the counter never
# incremented, and A/B rollback could not fire on any fielded unit.
#
# Changing the emulated storage controller reproduces that exact condition on a
# developer machine. There is nothing FZ-55-specific about the failure; it needed
# only a disk that is not virtio.
#
# ── WHAT IT ASSERTS ──────────────────────────────────────────────────────────
#
#   1. boot-store discovery finds the store, and reports the NON-virtio device
#   2. the failed-boot counter INCREMENTS (rollback protection is live)
#   3. the counter is RESET once the session is healthy
#
# Point 3 matters as much as the others. Fixing discovery without fixing the
# reset path would make every healthy boot increment the counter until it passed
# the 3-strike limit, at which point a perfectly working terminal would roll back
# to the other slot, work fine, roll back again, and flip between slots forever.
#
# Usage:
#   test/run-qemu-nvme.sh                 # NVMe (default)
#   KIOSK_TEST_BUS=ahci test/run-qemu-nvme.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUS="${KIOSK_TEST_BUS:-nvme}"
LOG_FILE="${1:-$SCRIPT_DIR/boot-$BUS.log}"
CAPTURE_DELAY="${KIOSK_NVME_CAPTURE_DELAY:-300}"
DISK_IMG="$ROOT_DIR/output/images/disk.img"

[ -f "$DISK_IMG" ] || { echo "disk image not found at $DISK_IMG — run ./build.sh first" >&2; exit 1; }

if command -v timeout >/dev/null 2>&1; then TIMEOUT_CMD="timeout"
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_CMD="gtimeout"
else echo "ERROR: install GNU coreutils (brew install coreutils)" >&2; exit 1; fi

# The device name the guest is expected to report, which is the whole point of
# the exercise.
case "$BUS" in
  nvme)
    # SeaBIOS has supported booting from NVMe since 1.12, which is older than any
    # QEMU this project runs on, so the MBR/extlinux path still works.
    DRIVE_ARGS=(-drive "file=$DISK_IMG,if=none,id=nvm,format=raw"
                -device "nvme,serial=rmpgtest01,drive=nvm")
    EXPECT_DEV="/dev/nvme0n1p1"
    ;;
  ahci)
    DRIVE_ARGS=(-drive "file=$DISK_IMG,if=none,id=sata0,format=raw"
                -device ahci,id=ahci
                -device "ide-hd,drive=sata0,bus=ahci.0")
    EXPECT_DEV="/dev/sda1"
    ;;
  *)
    echo "ERROR: KIOSK_TEST_BUS must be nvme or ahci (got '$BUS')" >&2
    exit 1
    ;;
esac

rm -f "$LOG_FILE"

echo "Booting the desktop image with the disk on $BUS (expecting $EXPECT_DEV) ..."
echo "Waiting ${CAPTURE_DELAY}s for the session to settle — the counter reset only"
echo "happens once the desktop reports healthy, so cutting this short would look"
echo "identical to the reset being broken."

"$TIMEOUT_CMD" $((CAPTURE_DELAY + 120)) qemu-system-x86_64 \
  "${DRIVE_ARGS[@]}" \
  -m 3072 \
  -smp 2 \
  -netdev user,id=net0 \
  -device virtio-net-pci,netdev=net0 \
  -vga none \
  -device virtio-gpu-pci \
  -serial file:"$LOG_FILE" \
  -display none \
  -no-reboot &
QEMU_PID=$!

sleep "$CAPTURE_DELAY"
kill "$QEMU_PID" 2>/dev/null || true
wait "$QEMU_PID" 2>/dev/null || true

echo
echo "=== boot-store and A/B markers ==="
grep -E "KIOSK_LINUX_(BOOTSTORE|BOOT_ATTEMPT|BOOT_SLOT|BOOT_FALLBACK|HWREPORT|WATCHDOG)" "$LOG_FILE" 2>/dev/null \
  || echo "(none found)"

FAILED=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; FAILED=1; }

echo
echo "=== assertions ==="

# 1. The store was found at all.
if grep -q "KIOSK_LINUX_BOOTSTORE found kind=extlinux" "$LOG_FILE" 2>/dev/null; then
  pass "boot store discovered"
else
  fail "boot store NOT discovered — discovery is broken on $BUS"
fi

# 2. On the device this bus actually presents. This is the assertion that fails
#    if anyone reintroduces a hardcoded device name.
if grep -q "dev=$EXPECT_DEV" "$LOG_FILE" 2>/dev/null; then
  pass "discovered on $EXPECT_DEV (a non-virtio device)"
else
  found="$(grep -o 'dev=[^ ]*' "$LOG_FILE" 2>/dev/null | head -1)"
  fail "expected dev=$EXPECT_DEV, log says ${found:-nothing}"
fi

# 3. Never the old failure path.
if grep -q "KIOSK_LINUX_BOOT_SLOT_CHECK_FAILED" "$LOG_FILE" 2>/dev/null; then
  fail "S01 reported BOOT_SLOT_CHECK_FAILED — this is the original bug"
else
  pass "no BOOT_SLOT_CHECK_FAILED"
fi

# 4. The counter incremented, so rollback protection is genuinely live.
if grep -qE "KIOSK_LINUX_BOOT_ATTEMPT [0-9]+" "$LOG_FILE" 2>/dev/null; then
  pass "failed-boot counter incremented ($(grep -oE 'KIOSK_LINUX_BOOT_ATTEMPT [0-9]+' "$LOG_FILE" | tail -1))"
else
  fail "counter never incremented — rollback is inert"
fi

# 5. And was cleared on a healthy boot, so healthy boots cannot trip a rollback.
if grep -q "KIOSK_LINUX_BOOT_ATTEMPTS_RESET$" "$LOG_FILE" 2>/dev/null; then
  pass "counter reset after a healthy session"
elif grep -q "KIOSK_LINUX_BOOT_ATTEMPTS_RESET_FAILED\|KIOSK_LINUX_BOOT_ATTEMPTS_RESET_SKIPPED" "$LOG_FILE" 2>/dev/null; then
  fail "counter reset did NOT happen: $(grep -o 'KIOSK_LINUX_BOOT_ATTEMPTS_RESET_[A-Z]*' "$LOG_FILE" | tail -1) — healthy boots would eventually force a rollback"
else
  fail "no counter-reset marker at all (did the desktop reach a healthy state? see $LOG_FILE)"
fi

# 6. Regression guard: the desktop must still come up on a non-virtio disk.
if grep -q "KIOSK_LINUX_DESKTOP_OK\|KIOSK_LINUX_CONSOLE_FALLBACK_OK" "$LOG_FILE" 2>/dev/null; then
  pass "session reached a usable state"
else
  fail "session never reported healthy"
fi

# 7. The hardware report must reach the CONSOLE, not just a file in the guest.
#    Added after a real run where every other S99 marker appeared and the report
#    did not: it had been redirected to /tmp/rmpg-hwreport.log, so the one
#    artifact a hardware bring-up exists to produce was invisible on the serial
#    console and unassertable here.
if grep -q "KIOSK_LINUX_HWREPORT_DONE" "$LOG_FILE" 2>/dev/null; then
  pass "hardware report reached the console ($(grep -o 'KIOSK_LINUX_HWREPORT_DONE.*' "$LOG_FILE" | head -1))"
else
  fail "no KIOSK_LINUX_HWREPORT_DONE on the console — the report is not visible where a bring-up can read it"
fi

# 8. And was persisted to the boot store, which is what survives the reboot.
if grep -q "KIOSK_LINUX_HWREPORT_SAVED" "$LOG_FILE" 2>/dev/null; then
  pass "hardware report persisted to the boot store"
else
  fail "hardware report was not persisted: $(grep -o 'KIOSK_LINUX_HWREPORT_NOT_SAVED.*' "$LOG_FILE" | head -1)"
fi

echo
echo "=== crashes ==="
if grep -qiE "segfault|Kernel panic|Oops" "$LOG_FILE" 2>/dev/null; then
  grep -iE "segfault|Kernel panic|Oops" "$LOG_FILE" | head -5
  FAILED=1
else
  echo "none"
fi

echo
echo "log: $LOG_FILE"
if [ "$FAILED" -eq 0 ]; then
  echo "RESULT: PASS ($BUS)"
else
  echo "RESULT: FAIL ($BUS)"
fi
exit "$FAILED"
