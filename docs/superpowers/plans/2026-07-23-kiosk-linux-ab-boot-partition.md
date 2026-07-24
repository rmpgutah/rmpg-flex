# Kiosk Linux A/B Boot Partition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Kiosk Linux a persistent, syslinux-booted A/B partition scheme (slot A / slot B, each holding a full `bzImage`+`rootfs.cpio.gz`) with automatic fallback to the other slot after 3 failed boot attempts — the prerequisite mechanism a future OTA-delivery sub-project needs, built and tested in isolation from any actual update-download logic.

**Architecture:** A new disk-image-assembly script partitions a raw virtio-blk image (one EXT2 partition), installs syslinux's MBR bootstrap + `extlinux.conf`, and populates `slot_a/`/`slot_b/` with the Buildroot build's output (identical copies at first). A new early init script (`S01kiosk-boot-slot-check`) maintains a `boot_attempts` counter on that same partition and flips `extlinux.conf`'s default slot after 3 consecutive failures to reach the existing browser-health signal; the existing `S99kiosk-browser-marker` script is extended to reset that counter to 0 once it reaches `KIOSK_LINUX_BROWSER_OK`.

**Tech Stack:** Buildroot 2024.02.9 (`BR2_TARGET_SYSLINUX`), `parted`/`losetup`/`mkfs.ext2`/`extlinux` (Debian/Ubuntu `syslinux-common`+`extlinux`+`e2fsprogs`+`util-linux` packages) inside the existing Docker build container, POSIX shell init scripts (BusyBox `/bin/sh`), QEMU virtio-blk.

## Global Constraints

- Stays QEMU/virtio-blk only — no real hardware target, no UEFI (legacy BIOS/MBR via syslinux only), per the design spec's non-goals.
- No actual OTA update download/apply logic in this plan — `slot_b/` is seeded as an *identical copy* of `slot_a/`'s build output; this plan's own test manually breaks slot B's init script afterward to exercise the fallback mechanism, it does not implement any real "different image" delivery path.
- No partition-level checksum/integrity verification — only "failed to reach `KIOSK_LINUX_BROWSER_OK` 3 times" is detected, not image corruption.
- The boot-attempts threshold is exactly **3** failed attempts before flipping to the other slot (per the approved spec).
- The new early init script must run before `S99kiosk-net-marker`/`S99kiosk-browser-marker` — named `S01kiosk-boot-slot-check` for that reason (numeric prefix `01` sorts well before `99`).
- All D1/Worker code in this repo is unrelated to this plan — this is pure Buildroot/bootloader/init-script/QEMU work, verified manually (no automated test suite applies, consistent with how Kiosk Linux sub-projects 1-3 were verified).

---

### Task 1: Buildroot config + Docker build-image tooling for syslinux/disk assembly

**Files:**
- Modify: `kiosk-linux/configs/qemu_x86_64_kiosk_defconfig`
- Modify: `kiosk-linux/docker/Dockerfile`

**Interfaces:**
- Consumes: nothing new.
- Produces: `BR2_TARGET_SYSLINUX=y` in the Buildroot output (so `output/images/` may also contain syslinux's `extlinux` binary artifacts, though this plan writes `extlinux.conf` by hand rather than relying on Buildroot's own post-image syslinux templating); the Docker build image gaining `parted`, `util-linux` (loop/mount), `e2fsprogs` (`mkfs.ext2`), `syslinux-common` + `extlinux` (MBR bootstrap + the `extlinux` installer binary) for Task 2's disk-assembly script to use.

- [ ] **Step 1: Add syslinux to the Buildroot defconfig**

Open `kiosk-linux/configs/qemu_x86_64_kiosk_defconfig` and add this block right after the existing `BR2_TARGET_ROOTFS_CPIO=y` / `BR2_TARGET_ROOTFS_CPIO_GZIP=y` / `BR2_TARGET_ROOTFS_EXT2=n` lines (around line 81-84):

```
# Sub-project 5 (A/B boot partition): syslinux/extlinux is the bootloader
# that reads extlinux.conf off the new EXT2 boot partition assembled by
# kiosk-linux/scripts/assemble-disk-image.sh. Buildroot's own syslinux
# package is NOT used to generate extlinux.conf here (that config is
# hand-written per-slot by assemble-disk-image.sh) — this Kconfig option
# only ensures Buildroot's build tree has the pieces this project's own
# disk-assembly step needs available if it ever wants them; the actual
# extlinux/mbr.bin tooling used to assemble the disk image runs on the
# HOST-side Docker build container (see Dockerfile), not inside the target
# rootfs itself.
BR2_TARGET_SYSLINUX=y
BR2_TARGET_SYSLINUX_ISOLINUX=n
```

- [ ] **Step 2: Add kernel support for virtio-blk + EXT2/EXT4** — required so
`S01kiosk-boot-slot-check` (Task 3) can mount the boot partition at all. The
existing `kernel-net.fragment`/`kernel-drm.fragment` had to explicitly add
`CONFIG_VIRTIO_NET`/`CONFIG_VIRTIO_PCI`/`CONFIG_DRM_VIRTIO_GPU` because
Buildroot's stock `BR2_LINUX_KERNEL_DEFCONFIG="x86_64"` does not enable
virtio drivers by default — the same is true for virtio-blk, and neither
existing fragment enables EXT2/EXT4 filesystem support either (confirmed via
`grep -n "VIRTIO\|EXT2\|EXT4" kiosk-linux/configs/kernel-*.fragment` finding
nothing).

Create `kiosk-linux/configs/kernel-storage.fragment`:

```
# kiosk-linux/configs/kernel-storage.fragment
# Sub-project 5 (A/B boot partition): virtio-blk so the kernel sees the
# QEMU disk image as /dev/vda, and EXT2/EXT4 so S01kiosk-boot-slot-check can
# mount its single EXT2 partition (/dev/vda1) to read/write boot_attempts
# and extlinux.conf. Both built-in (=y, not =m) since this boots from a pure
# initramfs with no module-loading step before S01 needs the mount to work.
CONFIG_VIRTIO_BLK=y
CONFIG_BLK_DEV=y
CONFIG_EXT4_FS=y
CONFIG_EXT2_FS=y
```

Then add it to the existing `BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES` line in
`kiosk-linux/configs/qemu_x86_64_kiosk_defconfig` (around line 108) — change:

```
BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES="/kiosk-linux/configs/kernel-drm.fragment /kiosk-linux/configs/kernel-net.fragment"
```

to:

```
BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES="/kiosk-linux/configs/kernel-drm.fragment /kiosk-linux/configs/kernel-net.fragment /kiosk-linux/configs/kernel-storage.fragment"
```

- [ ] **Step 3: Add disk-assembly tooling packages to the Docker build image**

Open `kiosk-linux/docker/Dockerfile` and add these packages to the existing `apt-get install` list (insert them alphabetically-ish near `findutils`/`git`, anywhere in the existing list is fine since apt resolves order-independently):

```
    parted \
    util-linux \
    e2fsprogs \
    syslinux-common \
    extlinux \
```

Add a comment above the new lines explaining why, matching this file's existing comment style:
```
# parted/util-linux/e2fsprogs/syslinux-common/extlinux: sub-project 5's
# disk-image-assembly script (kiosk-linux/scripts/assemble-disk-image.sh)
# partitions a raw virtio-blk image, formats an EXT2 boot partition, and
# installs syslinux's MBR bootstrap + the extlinux bootloader onto it.
```

- [ ] **Step 4: Rebuild the Docker build image and confirm it still builds cleanly**

Run: `docker build -t kiosk-linux-buildroot:latest kiosk-linux/docker`
Expected: image builds successfully; near the end of the apt-get install step, confirm `parted`, `syslinux-common`, and `extlinux` are listed as newly installed packages (scan the build log output for those package names — no errors).

- [ ] **Step 5: Confirm the new binaries exist inside the built image**

Run: `docker run --rm kiosk-linux-buildroot:latest bash -c 'command -v parted extlinux mkfs.ext2 losetup && dpkg -L syslinux-common | grep -i mbr.bin'`
Expected: prints the path to each of `parted`, `extlinux`, `mkfs.ext2`, `losetup`, and at least one line ending in `mbr.bin` (the exact path — e.g. `/usr/lib/EXTLINUX/mbr.bin` or `/usr/lib/syslinux/mbr/mbr.bin` depending on the Ubuntu release's package layout; note down whichever path this prints, Task 2 needs it).

- [ ] **Step 6: Commit**

```bash
git add kiosk-linux/configs/qemu_x86_64_kiosk_defconfig kiosk-linux/docker/Dockerfile
git commit -m "feat(kiosk-linux): add syslinux config + disk-assembly tooling for A/B boot partition"
```

---

### Task 2: Disk-image-assembly script

**Files:**
- Create: `kiosk-linux/scripts/assemble-disk-image.sh`
- Modify: `kiosk-linux/build.sh`

**Interfaces:**
- Consumes: `output/images/bzImage` + `output/images/rootfs.cpio.gz` (Buildroot's existing build output, already produced by `build.sh`'s existing `make -C /build-output` step); the `mbr.bin` path discovered in Task 1 Step 4.
- Produces: `output/images/disk.img` — a raw disk image with one bootable EXT2 partition containing `extlinux.conf`, `slot_a/{bzImage,rootfs.cpio.gz}`, `slot_b/{bzImage,rootfs.cpio.gz}` (identical copy of slot_a at this stage), and an empty `boot_attempts` file (content `0`). Later tasks (Task 5) boot QEMU from this file via `-drive`.

This script needs `losetup`/`mount`, which need extra container privileges beyond the existing unprivileged `docker run --user <uid>:<gid>` used for the rest of the build — it runs as its own separate, root, `--privileged` container invocation, kept in its own script file (not inlined into `build.sh`'s existing `bash -c '...'` block) so the extra-privilege blast radius is limited to exactly this one step.

- [ ] **Step 1: Write the disk-assembly script**

Replace `MBR_BIN_PATH` below with whatever Task 1 Step 4 actually printed for your Docker build image (do not guess — use the real discovered path).

```bash
#!/usr/bin/env bash
# kiosk-linux/scripts/assemble-disk-image.sh
# Assembles output/images/disk.img: a raw virtio-blk disk with one bootable
# EXT2 partition, syslinux/extlinux as the bootloader, and slot_a/slot_b
# subdirectories each holding a full bzImage+rootfs.cpio.gz. Seeds slot_b as
# an identical copy of slot_a — this script does NOT implement any real OTA
# update-delivery logic; a future sub-project will replace slot_b's content
# with a genuinely different, newer image. This script's own job ends at
# "the A/B mechanism exists and both slots boot the same known-good image."
#
# Runs INSIDE the Buildroot build-environment Docker image (built by
# ../docker/Dockerfile), invoked with --privileged (unlike the rest of the
# build, which runs unprivileged) because losetup/mount need real kernel
# capabilities this container does not have by default. Kept in its own
# script/container invocation rather than folded into build.sh's existing
# unprivileged build step, to keep that extra privilege scoped to only this
# one step.
set -euo pipefail

IMAGES_DIR="/kiosk-linux/output/images"
BZIMAGE="$IMAGES_DIR/bzImage"
INITRD="$IMAGES_DIR/rootfs.cpio.gz"
DISK_IMG="$IMAGES_DIR/disk.img"
STAGING_DIR="$(mktemp -d)"
LOOP_DEV=""

# Replace this with the real path Task 1 Step 4 discovered for this Docker
# build image (e.g. /usr/lib/EXTLINUX/mbr.bin or /usr/lib/syslinux/mbr/mbr.bin).
MBR_BIN_PATH="/usr/lib/EXTLINUX/mbr.bin"

cleanup() {
  if [ -n "$LOOP_DEV" ]; then
    umount "${LOOP_DEV}p1" 2>/dev/null || true
    losetup -d "$LOOP_DEV" 2>/dev/null || true
  fi
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

[ -f "$BZIMAGE" ] || { echo "ERROR: $BZIMAGE not found — run the Buildroot build first." >&2; exit 1; }
[ -f "$INITRD" ] || { echo "ERROR: $INITRD not found — run the Buildroot build first." >&2; exit 1; }
[ -f "$MBR_BIN_PATH" ] || { echo "ERROR: MBR_BIN_PATH ($MBR_BIN_PATH) not found in this image — re-check Task 1 Step 4's discovered path." >&2; exit 1; }

echo "Building boot-partition staging tree ..."
mkdir -p "$STAGING_DIR/slot_a" "$STAGING_DIR/slot_b"
cp "$BZIMAGE" "$INITRD" "$STAGING_DIR/slot_a/"
cp "$BZIMAGE" "$INITRD" "$STAGING_DIR/slot_b/"
echo "0" > "$STAGING_DIR/boot_attempts"

cat > "$STAGING_DIR/extlinux.conf" <<'EXTLINUXCONF'
DEFAULT slot_a
PROMPT 0
TIMEOUT 10

LABEL slot_a
  KERNEL /slot_a/bzImage
  INITRD /slot_a/rootfs.cpio.gz
  APPEND console=ttyS0

LABEL slot_b
  KERNEL /slot_b/bzImage
  INITRD /slot_b/rootfs.cpio.gz
  APPEND console=ttyS0
EXTLINUXCONF

echo "Creating raw disk image ($DISK_IMG) ..."
rm -f "$DISK_IMG"
truncate -s 512M "$DISK_IMG"

echo "Writing partition table (one bootable primary partition, EXT2) ..."
parted --script "$DISK_IMG" mklabel msdos
parted --script "$DISK_IMG" mkpart primary ext2 1MiB 100%
parted --script "$DISK_IMG" set 1 boot on

echo "Attaching loop device with partition scanning ..."
LOOP_DEV="$(losetup -f --show -P "$DISK_IMG")"
echo "Loop device: $LOOP_DEV (partition: ${LOOP_DEV}p1)"

echo "Formatting the boot partition as EXT2 ..."
mkfs.ext2 -F -L kiosk_boot "${LOOP_DEV}p1"

MOUNT_DIR="$(mktemp -d)"
mount "${LOOP_DEV}p1" "$MOUNT_DIR"
echo "Copying staging tree into the mounted partition ..."
cp -a "$STAGING_DIR/." "$MOUNT_DIR/"

echo "Installing extlinux onto the mounted partition ..."
extlinux --install "$MOUNT_DIR"

umount "$MOUNT_DIR"
rmdir "$MOUNT_DIR"

echo "Writing the MBR bootstrap (syslinux mbr.bin) onto the disk image ..."
dd if="$MBR_BIN_PATH" of="$DISK_IMG" bs=440 count=1 conv=notrunc

losetup -d "$LOOP_DEV"
LOOP_DEV=""

echo "Disk image assembled: $DISK_IMG"
ls -la "$DISK_IMG"
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x kiosk-linux/scripts/assemble-disk-image.sh
```

- [ ] **Step 3: Wire the disk-assembly step into `build.sh`**

Open `kiosk-linux/build.sh` and add this block right after the existing final `ls -la` verification (after line 577, the closing `}` of the existing output-check), replacing the file's very last lines:

```bash
ls -la "$OUTPUT_DIR/images/bzImage" "$OUTPUT_DIR/images/rootfs.cpio.gz" 2>/dev/null || {
  echo "ERROR: expected output images not found in $OUTPUT_DIR/images/ — build likely failed partway; check the make output above." >&2
  exit 1
}

# Sub-project 5: assemble the A/B boot-partition disk image from the
# bzImage/rootfs.cpio.gz just built. Runs as its own --privileged container
# invocation (needs losetup/mount, which the rest of this script's
# unprivileged --user build steps do not have and do not need) — kept
# separate from the main build step above to limit that extra privilege to
# only this one, narrowly-scoped operation.
echo "Assembling the A/B boot-partition disk image ..."
docker run --rm --privileged \
  -v "$SCRIPT_DIR":/kiosk-linux \
  "$IMAGE_TAG" \
  bash /kiosk-linux/scripts/assemble-disk-image.sh

ls -la "$OUTPUT_DIR/images/disk.img" 2>/dev/null || {
  echo "ERROR: expected disk.img not found in $OUTPUT_DIR/images/ — disk assembly likely failed; check the output above." >&2
  exit 1
}
```

- [ ] **Step 4: Run the full build (or, if you already have a built `bzImage`/`rootfs.cpio.gz` from an earlier run, just the disk-assembly step directly to save time)**

If you already have `output/images/bzImage` and `output/images/rootfs.cpio.gz` from a prior build, test just the new step:
```bash
docker build -t kiosk-linux-buildroot:latest kiosk-linux/docker
docker run --rm --privileged \
  -v "$(pwd)/kiosk-linux":/kiosk-linux \
  kiosk-linux-buildroot:latest \
  bash /kiosk-linux/scripts/assemble-disk-image.sh
```

Expected: ends with `Disk image assembled: /kiosk-linux/output/images/disk.img` and an `ls -la` line showing a 512M file. If `extlinux --install` or `losetup`/`mount` fail with a permission error, confirm `--privileged` is actually present on this exact `docker run` invocation (not just the main build's unprivileged one).

- [ ] **Step 5: Commit**

```bash
git add kiosk-linux/scripts/assemble-disk-image.sh kiosk-linux/build.sh
git commit -m "feat(kiosk-linux): assemble A/B boot-partition disk image after the Buildroot build"
```

---

### Task 3: Boot-attempt counter + fallback init script

**Files:**
- Create: `kiosk-linux/rootfs-overlay/etc/init.d/S01kiosk-boot-slot-check`

**Interfaces:**
- Consumes: the `boot_attempts` file and `extlinux.conf` on the boot partition (Task 2), mounted at boot — this script must first locate and mount that partition itself, since nothing earlier in the boot sequence does so (the rootfs itself is still the RAM-loaded initramfs; the boot partition is a SEPARATE device the running system must explicitly mount to read/write these files).
- Produces: on every boot, increments `boot_attempts`; after 3 consecutive failures (tracked via that same counter), rewrites `extlinux.conf`'s `DEFAULT` line to the other slot and reboots. Task 4's modified `S99kiosk-browser-marker` resets this same counter to 0 on success — this script and that one must agree on the exact same file path, established here as `/mnt/kiosk-boot/boot_attempts`.

- [ ] **Step 1: Write the init script**

```sh
#!/bin/sh
# kiosk-linux/rootfs-overlay/etc/init.d/S01kiosk-boot-slot-check
#
# Sub-project 5 (A/B boot partition): runs very early (S01, well before
# S99kiosk-net-marker/S99kiosk-browser-marker) to track failed-boot attempts
# on the persistent boot partition (assembled by
# kiosk-linux/scripts/assemble-disk-image.sh — a separate EXT2 partition on
# the same virtio-blk disk this initramfs itself booted from, NOT the
# initramfs rootfs, which is RAM-only and does not survive a reboot).
#
# The boot partition is device /dev/vda1 under this project's QEMU
# virtio-blk setup (single disk, single partition, per assemble-disk-image.sh)
# — mounted here at /mnt/kiosk-boot for the rest of this script, and left
# mounted afterward so S99kiosk-browser-marker (Task 4) can reset the
# counter through the same mount point without re-mounting.
BOOT_PART=/dev/vda1
MOUNT_POINT=/mnt/kiosk-boot
COUNTER_FILE="$MOUNT_POINT/boot_attempts"
EXTLINUX_CONF="$MOUNT_POINT/extlinux.conf"
MAX_ATTEMPTS=3

mkdir -p "$MOUNT_POINT"
if ! mount -t ext2 "$BOOT_PART" "$MOUNT_POINT" 2>/tmp/kiosk-boot-slot-check.err; then
  echo "KIOSK_LINUX_BOOT_SLOT_CHECK_FAILED (could not mount $BOOT_PART): $(cat /tmp/kiosk-boot-slot-check.err)"
  exit 0
fi

ATTEMPTS="$(cat "$COUNTER_FILE" 2>/dev/null)"
case "$ATTEMPTS" in
  ''|*[!0-9]*) ATTEMPTS=0 ;;
esac
ATTEMPTS=$((ATTEMPTS + 1))
echo "$ATTEMPTS" > "$COUNTER_FILE"
echo "KIOSK_LINUX_BOOT_ATTEMPT $ATTEMPTS"

if [ "$ATTEMPTS" -gt "$MAX_ATTEMPTS" ]; then
  CURRENT_SLOT="$(grep '^DEFAULT ' "$EXTLINUX_CONF" | awk '{print $2}')"
  if [ "$CURRENT_SLOT" = "slot_a" ]; then
    OTHER_SLOT="slot_b"
  else
    OTHER_SLOT="slot_a"
  fi
  echo "KIOSK_LINUX_BOOT_FALLBACK (from $CURRENT_SLOT to $OTHER_SLOT after $ATTEMPTS failed attempts)"
  sed -i "s/^DEFAULT .*/DEFAULT $OTHER_SLOT/" "$EXTLINUX_CONF"
  echo "0" > "$COUNTER_FILE"
  sync
  reboot -f
fi
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x kiosk-linux/rootfs-overlay/etc/init.d/S01kiosk-boot-slot-check
```

- [ ] **Step 3: Commit**

```bash
git add kiosk-linux/rootfs-overlay/etc/init.d/S01kiosk-boot-slot-check
git commit -m "feat(kiosk-linux): boot-attempt counter + A/B fallback init script"
```

---

### Task 4: Reset the boot-attempt counter on a confirmed-healthy boot

**Files:**
- Modify: `kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-browser-marker`

**Interfaces:**
- Consumes: `/mnt/kiosk-boot/boot_attempts` (Task 3 — already mounted by `S01kiosk-boot-slot-check`, which runs first and leaves the mount in place).
- Produces: resets that counter to `0` immediately after this script reaches its existing `KIOSK_LINUX_BROWSER_OK` success line — this is the "confirmed good" signal Task 3's fallback logic relies on.

- [ ] **Step 1: Add the reset, right after the existing success line**

In `kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-browser-marker`, find the existing success branch:

```sh
  if kill -0 "$COG_PID" 2>/dev/null; then
    echo "KIOSK_LINUX_BROWSER_OK"
    echo "DEBUG cog.log so far:"
    cat /tmp/cog.log
  else
```

Change it to:

```sh
  if kill -0 "$COG_PID" 2>/dev/null; then
    echo "KIOSK_LINUX_BROWSER_OK"
    echo "DEBUG cog.log so far:"
    cat /tmp/cog.log
    # Sub-project 5: this is the "confirmed good" signal S01kiosk-boot-
    # slot-check's fallback logic relies on — reset the failed-attempt
    # counter now that this boot has genuinely reached a healthy state.
    if [ -w /mnt/kiosk-boot/boot_attempts ]; then
      echo "0" > /mnt/kiosk-boot/boot_attempts
      echo "KIOSK_LINUX_BOOT_ATTEMPTS_RESET"
    fi
  else
```

- [ ] **Step 2: Commit**

```bash
git add kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-browser-marker
git commit -m "feat(kiosk-linux): reset boot-attempt counter on confirmed-healthy boot"
```

---

### Task 5: Boot QEMU from the new disk image + manual A/B verification

**Files:**
- Modify: `kiosk-linux/test/run-qemu-browser.sh`

**Interfaces:**
- Consumes: `output/images/disk.img` (Task 2).
- Produces: `run-qemu-browser.sh` now boots via `-drive file=disk.img,if=virtio` instead of `-kernel`/`-initrd`, so it exercises the real syslinux/extlinux boot path this whole sub-project built. (`run-qemu-net.sh`, `run-qemu-graphics.sh`, and `run-qemu.sh` test earlier, isolated sub-project milestones and are intentionally left on the direct `-kernel`/`-initrd` boot — they are not testing the boot-partition mechanism and `bzImage`/`rootfs.cpio.gz` remain valid standalone build outputs for them.)

- [ ] **Step 1: Update the QEMU invocation**

In `kiosk-linux/test/run-qemu-browser.sh`, change:

```bash
KERNEL="$ROOT_DIR/output/images/bzImage"
INITRD="$ROOT_DIR/output/images/rootfs.cpio.gz"

[ -f "$KERNEL" ] || { echo "kernel not found at $KERNEL — run ./build.sh first" >&2; exit 1; }
[ -f "$INITRD" ] || { echo "initramfs not found at $INITRD — run ./build.sh first" >&2; exit 1; }
```

to:

```bash
DISK_IMG="$ROOT_DIR/output/images/disk.img"

[ -f "$DISK_IMG" ] || { echo "disk image not found at $DISK_IMG — run ./build.sh first" >&2; exit 1; }
```

And change the QEMU invocation itself from:

```bash
"$TIMEOUT_CMD" 150 qemu-system-x86_64 \
  -kernel "$KERNEL" \
  -initrd "$INITRD" \
  -append "console=ttyS0" \
  -m 1024 \
```

to:

```bash
"$TIMEOUT_CMD" 150 qemu-system-x86_64 \
  -drive file="$DISK_IMG",if=virtio,format=raw \
  -m 1024 \
```

(Dropping `-kernel`/`-initrd`/`-append` entirely — syslinux/extlinux inside the disk image now owns boot, including the `console=ttyS0` argument, which is already baked into `extlinux.conf`'s `APPEND` line from Task 2.)

- [ ] **Step 2: Verification part 1 — normal boot resets the counter to 0**

```bash
kiosk-linux/test/run-qemu-browser.sh /tmp/ab-test-normal.log /tmp/ab-test-normal.ppm
grep -E "KIOSK_LINUX_BOOT_ATTEMPT |KIOSK_LINUX_BROWSER_OK|KIOSK_LINUX_BOOT_ATTEMPTS_RESET" /tmp/ab-test-normal.log
```

Expected output includes, in order: `KIOSK_LINUX_BOOT_ATTEMPT 1`, then later `KIOSK_LINUX_BROWSER_OK`, then `KIOSK_LINUX_BOOT_ATTEMPTS_RESET`.

- [ ] **Step 3: Verification part 2 — deliberately break slot B, confirm fallback after 3 failures**

Mount `output/images/disk.img`'s partition directly on the host to edit slot B (this requires the same loop-device tooling — run it via a throwaway privileged container, matching Task 2's pattern, rather than requiring host-level loop-device access):

```bash
docker run --rm --privileged \
  -v "$(pwd)/kiosk-linux":/kiosk-linux \
  kiosk-linux-buildroot:latest \
  bash -c '
    set -euo pipefail
    LOOP_DEV="$(losetup -f --show -P /kiosk-linux/output/images/disk.img)"
    MOUNT_DIR="$(mktemp -d)"
    mount "${LOOP_DEV}p1" "$MOUNT_DIR"
    sed -i "s/^DEFAULT .*/DEFAULT slot_b/" "$MOUNT_DIR/extlinux.conf"
    echo "0" > "$MOUNT_DIR/boot_attempts"
    umount "$MOUNT_DIR"
    losetup -d "$LOOP_DEV"
  '
```

This only flips the *default* slot to `slot_b` — slot B still contains the same working image as slot A at this point (Task 2 seeded them identically), so to actually exercise a failure, slot B's copy of `rootfs.cpio.gz` needs to genuinely fail to reach `KIOSK_LINUX_BROWSER_OK`. The simplest reliable way to force that without rebuilding anything: temporarily rename `cog` inside slot B's initramfs so `S99kiosk-browser-marker`'s existing `if [ -z "$WPE_BIN" ]` branch triggers (`KIOSK_LINUX_BROWSER_FAILED (cog not found)`), which never reaches the `KIOSK_LINUX_BROWSER_OK`/reset line — this exercises the exact "boot completes but the health signal is never reached" case Task 3's counter is designed to catch, without needing a from-scratch rebuild.

Run the boot three times in a row and confirm the counter climbs then the fallback fires:

```bash
for i in 1 2 3; do
  kiosk-linux/test/run-qemu-browser.sh "/tmp/ab-test-fail-$i.log" "/tmp/ab-test-fail-$i.ppm"
  echo "--- attempt $i ---"
  grep -E "KIOSK_LINUX_BOOT_ATTEMPT |KIOSK_LINUX_BROWSER_FAILED|KIOSK_LINUX_BOOT_FALLBACK" "/tmp/ab-test-fail-$i.log"
done
```

Expected: attempt 1 shows `KIOSK_LINUX_BOOT_ATTEMPT 1` + `KIOSK_LINUX_BROWSER_FAILED`; attempt 2 shows `KIOSK_LINUX_BOOT_ATTEMPT 2` + `KIOSK_LINUX_BROWSER_FAILED` (booting slot B again, since the fallback in `S01kiosk-boot-slot-check` only fires once the counter exceeds 3 — the counter persists on the boot partition across these separate QEMU invocations since it is written to the actual disk image file on the host between runs); attempt 3 shows `KIOSK_LINUX_BOOT_ATTEMPT 4` immediately followed by `KIOSK_LINUX_BOOT_FALLBACK (from slot_b to slot_a after 4 failed attempts)` — the reboot this triggers happens inside that same QEMU invocation, so a subsequent grep for `KIOSK_LINUX_BROWSER_OK` in that same attempt-3 log file should also show it succeeding on slot A after the automatic fallback reboot.

- [ ] **Step 4: Verification part 3 — confirm the counter genuinely persists on the partition, not the RAM-loaded rootfs**

This is implicitly proven by Step 3 already (the counter climbed to 4 across three *separate* QEMU process invocations, each with a fresh RAM-loaded initramfs) — if the counter were somehow being tracked only in the initramfs's RAM state, it would reset to 0 every time regardless, and the fallback would never fire. No separate command needed; note this reasoning in the task's completion report instead of re-running anything.

- [ ] **Step 5: Commit**

```bash
git add kiosk-linux/test/run-qemu-browser.sh
git commit -m "feat(kiosk-linux): boot the browser QEMU test from the A/B disk image"
```
