#!/bin/sh
# kiosk-linux/test/test-boot-store.sh
#
# Unit tests for /usr/lib/rmpg/boot-store.sh, run on the HOST with no container,
# no QEMU and no root.
#
# ── WHY THESE EXIST ──────────────────────────────────────────────────────────
#
# The bug this code fixes was invisible to every existing test, because QEMU
# always presents the boot store as /dev/vda1 and always has it. The two cases
# that actually broke in the field cannot be reproduced there at all:
#
#   - an FZ-55 whose store is on nvme0n1p1 or sda1 rather than vda1
#   - the no-USB install, where the store is a directory on a Windows NTFS
#     volume and there is no Windows volume anywhere in the QEMU harness
#
# So boot-store.sh takes its device list and its mount command from overridable
# variables, and these tests drive the whole decision tree against fake devices.
# A regression here is caught in under a second instead of on a Toughbook in a
# parking lot.
#
# Usage: kiosk-linux/test/test-boot-store.sh
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOOT_STORE="$SCRIPT_DIR/../rootfs-overlay/usr/lib/rmpg/boot-store.sh"

PASS=0
FAIL=0

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── Fake mount / umount ──────────────────────────────────────────────────────
# A fixture is a directory named "<device-basename>.<fstype>" under $WORK/fs.
# The stub "mounts" one by copying its contents into the mount point, which is
# enough for marker-file discovery and for the read/write path tests. A device
# with no matching fixture fails to mount, exactly like the real thing.
mkdir -p "$WORK/fs" "$WORK/mnt" "$WORK/bin"

cat > "$WORK/bin/fakemount" <<'FAKEMOUNT'
#!/bin/sh
# Args seen in practice:
#   -t <fs> -o ro <dev> <mp>
#   -o remount,rw <mp>
#   -o remount,ro <mp>
set -u
FS=""; OPTS=""; POS1=""; POS2=""
while [ $# -gt 0 ]; do
  case "$1" in
    -t) FS="$2"; shift 2 ;;
    -o) OPTS="$2"; shift 2 ;;
    *) if [ -z "$POS1" ]; then POS1="$1"; else POS2="$1"; fi; shift ;;
  esac
done

case "$OPTS" in
  remount*)
    MP="$POS1"
    case "$OPTS" in
      *rw*)
        # A fixture may declare itself unwritable, which is how the dirty-NTFS
        # case is simulated: ntfs3 mounts it but refuses a writable remount.
        [ -f "$MP/.fixture-readonly" ] && exit 1
        exit 0
        ;;
      *) exit 0 ;;
    esac
    ;;
esac

DEV="$POS1"; MP="$POS2"
SRC="$FAKE_FS_ROOT/$(basename "$DEV").$FS"
[ -d "$SRC" ] || exit 1
# cp of "$SRC/." copies contents including dotfiles, without the parent dir.
cp -R "$SRC/." "$MP/" 2>/dev/null || exit 1
echo "$DEV $FS" > "$FAKE_STATE"
exit 0
FAKEMOUNT

cat > "$WORK/bin/fakeumount" <<'FAKEUMOUNT'
#!/bin/sh
set -u
MP="$1"
# Emptying the directory is the observable effect discovery depends on.
find "$MP" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null
: > "$FAKE_STATE"
exit 0
FAKEUMOUNT

chmod +x "$WORK/bin/fakemount" "$WORK/bin/fakeumount"

export FAKE_FS_ROOT="$WORK/fs"
export FAKE_STATE="$WORK/state"
: > "$FAKE_STATE"

# ── Fixtures ─────────────────────────────────────────────────────────────────

# A USB/disk install: EXT2 with extlinux.conf and two slots.
make_extlinux_fixture() {
    d="$WORK/fs/$1.ext2"
    mkdir -p "$d/slot_a" "$d/slot_b"
    cat > "$d/extlinux.conf" <<EOF
DEFAULT ${2:-slot_a}
PROMPT 0
TIMEOUT 30

LABEL slot_a
  KERNEL /slot_a/bzImage
  INITRD /slot_a/rootfs.cpio.gz

LABEL slot_b
  KERNEL /slot_b/bzImage
  INITRD /slot_b/rootfs.cpio.gz
EOF
    echo 0 > "$d/boot_attempts"
    : > "$d/slot_a/bzImage"
    : > "$d/slot_a/rootfs.cpio.gz"
    : > "$d/slot_b/bzImage"
    : > "$d/slot_b/rootfs.cpio.gz"
}

# A no-USB install: NTFS volume with Windows-looking content plus our directory.
make_ntfs_fixture() {
    d="$WORK/fs/$1.ntfs3"
    mkdir -p "$d/Windows/System32" "$d/RMPG-Flex-OS/slot_a" "$d/RMPG-Flex-OS/slot_b"
    printf '# GRUB sources this file.\nset rmpg_slot=%s\n' "${2:-slot_a}" > "$d/RMPG-Flex-OS/slot.cfg"
    echo 0 > "$d/RMPG-Flex-OS/boot_attempts"
    : > "$d/RMPG-Flex-OS/slot_a/bzImage"
    : > "$d/RMPG-Flex-OS/slot_b/bzImage"
    [ "${3:-}" = "readonly" ] && : > "$d/.fixture-readonly"
}

# A partition that mounts but is not ours — a plain data or ESP volume. Its job
# is to prove discovery keeps looking instead of claiming the first success.
make_decoy_fixture() {
    d="$WORK/fs/$1.ext2"
    mkdir -p "$d/lost+found"
    echo "not ours" > "$d/README"
}

make_partitions() {
    # Same column layout as the real /proc/partitions, including the two header
    # lines the parser skips.
    {
        echo "major minor  #blocks  name"
        echo ""
        for name in "$@"; do
            echo "   259        0  500107608 $name"
        done
    } > "$WORK/partitions"

    # boot-store.sh checks each candidate exists before trying to mount it, so
    # the fake devices need to be real files somewhere. This is why the helper
    # takes RMPG_BOOTSTORE_DEV_DIR rather than hardcoding /dev: without that
    # seam, `[ -e /dev/sda1 ]` fails on any developer machine and every case
    # here would pass or fail for the wrong reason.
    rm -rf "$WORK/dev"; mkdir -p "$WORK/dev"
    for name in "$@"; do
        : > "$WORK/dev/$name"
    done
}

# ── Harness ──────────────────────────────────────────────────────────────────
# Each case runs in a subshell so a sourced boot-store.sh cannot leak state
# between tests — the variables it sets are globals by design.
#
# The body is `eval`ed rather than handed to `sh -c`. That is not a style choice:
# boot-store.sh provides SHELL FUNCTIONS, and functions do not survive a process
# boundary, so `sh -c` produced "rmpg_bootstore_find: command not found" for
# every case. eval keeps the body in the same shell that sourced the file.
run_case() {
    _desc="$1"; _body="$2"
    rm -rf "$WORK/mnt"; mkdir -p "$WORK/mnt"
    (
        RMPG_BOOTSTORE_PROC_PARTITIONS="$WORK/partitions"
        RMPG_BOOTSTORE_DEV_DIR="$WORK/dev"
        RMPG_BOOTSTORE_MOUNT_CMD="$WORK/bin/fakemount"
        RMPG_BOOTSTORE_UMOUNT_CMD="$WORK/bin/fakeumount"
        RMPG_BOOTSTORE_MOUNT_POINT="$WORK/mnt"
        export RMPG_BOOTSTORE_PROC_PARTITIONS RMPG_BOOTSTORE_DEV_DIR \
               RMPG_BOOTSTORE_MOUNT_CMD RMPG_BOOTSTORE_UMOUNT_CMD \
               RMPG_BOOTSTORE_MOUNT_POINT
        . "$BOOT_STORE"
        eval "$_body"
    ) 2>&1
}

expect() {
    desc="$1"; expected="$2"; actual="$3"
    if [ "$actual" = "$expected" ]; then
        PASS=$((PASS + 1))
        echo "  ok   $desc"
    else
        FAIL=$((FAIL + 1))
        echo "  FAIL $desc"
        echo "         expected: [$expected]"
        echo "         actual:   [$actual]"
    fi
}

expect_contains() {
    desc="$1"; needle="$2"; haystack="$3"
    case "$haystack" in
        *"$needle"*) PASS=$((PASS + 1)); echo "  ok   $desc" ;;
        *) FAIL=$((FAIL + 1)); echo "  FAIL $desc"
           echo "         expected to contain: [$needle]"
           echo "         actual: [$haystack]" ;;
    esac
}

echo "boot-store.sh discovery tests"
echo ""

# ── 1. SATA, not virtio ──────────────────────────────────────────────────────
echo "1. finds an extlinux store on /dev/sda1 (the hardcoded path was vda1)"
rm -rf "$WORK/fs"; mkdir -p "$WORK/fs"
make_extlinux_fixture sda1 slot_a
make_partitions sda sda1
out="$(run_case sata 'rmpg_bootstore_find && echo "KIND=$RMPG_BOOTSTORE_KIND DEV=$RMPG_BOOTSTORE_DEV"')"
# Matched as "dev/sda1" rather than "/dev/sda1": the harness substitutes a fake
# device directory, and that suffix is true of both it and a real /dev.
expect_contains "discovers it" "KIND=extlinux DEV=" "$out"
expect_contains "on the sda1 device" "dev/sda1" "$out"

# ── 2. NVMe — the actual FZ-55 case ──────────────────────────────────────────
echo "2. finds an extlinux store on /dev/nvme0n1p1 (FZ-55 stock storage)"
rm -rf "$WORK/fs"; mkdir -p "$WORK/fs"
make_extlinux_fixture nvme0n1p1 slot_b
make_partitions nvme0n1 nvme0n1p1
out="$(run_case nvme 'rmpg_bootstore_find && echo "KIND=$RMPG_BOOTSTORE_KIND DEV=$RMPG_BOOTSTORE_DEV SLOT=$(rmpg_bootstore_get_slot)"')"
expect_contains "discovers it on the NVMe namespace" "dev/nvme0n1p1" "$out"
expect_contains "and reads the active slot from extlinux.conf" "SLOT=slot_b" "$out"

# ── 3. The no-USB install on NTFS ────────────────────────────────────────────
echo "3. finds the no-USB store inside RMPG-Flex-OS on an NTFS volume"
rm -rf "$WORK/fs"; mkdir -p "$WORK/fs"
make_ntfs_fixture nvme0n1p3 slot_b
make_partitions nvme0n1 nvme0n1p1 nvme0n1p2 nvme0n1p3
out="$(run_case ntfs 'rmpg_bootstore_find && echo "KIND=$RMPG_BOOTSTORE_KIND SLOT=$(rmpg_bootstore_get_slot)" && basename "$RMPG_BOOTSTORE_DIR"')"
expect_contains "identifies the GRUB/NTFS flavour" "KIND=grubntfs SLOT=slot_b" "$out"
expect_contains "points at the RMPG-Flex-OS subdirectory" "RMPG-Flex-OS" "$out"

# ── 4. Must not stop at the first thing that mounts ──────────────────────────
echo "4. skips a partition that mounts but is not ours"
rm -rf "$WORK/fs"; mkdir -p "$WORK/fs"
make_decoy_fixture sda1
make_extlinux_fixture sda2 slot_a
make_partitions sda sda1 sda2
out="$(run_case decoy 'rmpg_bootstore_find && echo "DEV=$RMPG_BOOTSTORE_DEV"')"
expect_contains "keeps probing past the decoy" "dev/sda2" "$out"

# ── 5. No store at all ───────────────────────────────────────────────────────
echo "5. reports NOT_FOUND rather than claiming success"
rm -rf "$WORK/fs"; mkdir -p "$WORK/fs"
make_partitions sda sda1
out="$(run_case none 'if rmpg_bootstore_find; then echo UNEXPECTED_SUCCESS; else echo CORRECTLY_FAILED; fi')"
expect_contains "fails closed" "CORRECTLY_FAILED" "$out"
expect_contains "says so on the console" "KIOSK_LINUX_BOOTSTORE NOT_FOUND" "$out"

# ── 6. Slot pointer writes, both flavours ────────────────────────────────────
echo "6. rewrites the slot pointer in the right format for each bootloader"
rm -rf "$WORK/fs"; mkdir -p "$WORK/fs"
make_extlinux_fixture sda1 slot_a
make_partitions sda sda1
out="$(run_case setext 'rmpg_bootstore_find && rmpg_bootstore_set_slot slot_b && grep "^DEFAULT" "$RMPG_BOOTSTORE_DIR/extlinux.conf"')"
expect_contains "extlinux: DEFAULT line updated" "DEFAULT slot_b" "$out"
# A vacuous `expect_contains ... ""` sat here first and passed unconditionally,
# which is worse than no test at all — it asserted the staged-write cleanup while
# proving nothing. Count the leftovers instead.
out2="$(run_case setext_tmp 'rmpg_bootstore_find && rmpg_bootstore_set_slot slot_b >/dev/null && ls "$RMPG_BOOTSTORE_DIR" | grep -c "[.]new$"')"
expect_contains "extlinux: no leftover .new file" "0" "$out2"

rm -rf "$WORK/fs"; mkdir -p "$WORK/fs"
make_ntfs_fixture nvme0n1p3 slot_a
make_partitions nvme0n1p3
out="$(run_case setntfs 'rmpg_bootstore_find && rmpg_bootstore_set_slot slot_b && cat "$RMPG_BOOTSTORE_DIR/slot.cfg"')"
expect_contains "grub: slot.cfg rewritten" "set rmpg_slot=slot_b" "$out"

# ── 7. A bogus slot name must be refused ─────────────────────────────────────
echo "7. refuses a slot name that is not slot_a or slot_b"
rm -rf "$WORK/fs"; mkdir -p "$WORK/fs"
make_extlinux_fixture sda1 slot_a
make_partitions sda1
out="$(run_case badslot 'rmpg_bootstore_find && { rmpg_bootstore_set_slot /etc/passwd || echo REFUSED; }; grep "^DEFAULT" "$RMPG_BOOTSTORE_DIR/extlinux.conf"')"
expect_contains "refuses the write" "REFUSED" "$out"
expect_contains "leaves the pointer untouched" "DEFAULT slot_a" "$out"

# ── 8. other_slot ────────────────────────────────────────────────────────────
echo "8. other_slot returns the slot that is not current"
rm -rf "$WORK/fs"; mkdir -p "$WORK/fs"
make_extlinux_fixture sda1 slot_b
make_partitions sda1
out="$(run_case other 'rmpg_bootstore_find && rmpg_bootstore_other_slot')"
expect_contains "slot_b -> slot_a" "slot_a" "$out"

# ── 9. Dirty NTFS volume (Windows Fast Startup) ──────────────────────────────
echo "9. names the cause when a writable remount is refused"
rm -rf "$WORK/fs"; mkdir -p "$WORK/fs"
make_ntfs_fixture nvme0n1p3 slot_a readonly
make_partitions nvme0n1p3
out="$(run_case dirty 'rmpg_bootstore_find && { rmpg_bootstore_rw || echo RW_REFUSED; }')"
expect_contains "reports read-only" "RW_REFUSED" "$out"
expect_contains "explains it is probably Fast Startup" "Fast Startup" "$out"

echo ""
echo "─────────────────────────────────────"
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ] || exit 1
