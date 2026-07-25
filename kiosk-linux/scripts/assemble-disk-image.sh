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
# Runs INSIDE the small kiosk-linux-disktools:latest Docker image (built from
# ../docker/Dockerfile.disktools — NOT the kiosk-linux-buildroot:latest image
# used for the actual Buildroot compile), invoked with --privileged (unlike
# the rest of the build, which runs unprivileged) because losetup/mount need
# real kernel capabilities this container does not have by default. Kept in
# its own script/container invocation rather than folded into build.sh's
# existing unprivileged build step, to keep that extra privilege scoped to
# only this one step.
set -euo pipefail

IMAGES_DIR="/kiosk-linux/output/images"
BZIMAGE="$IMAGES_DIR/bzImage"
INITRD="$IMAGES_DIR/rootfs.cpio.gz"
DISK_IMG="$IMAGES_DIR/disk.img"
STAGING_DIR="$(mktemp -d)"
LOOP_DEV=""

# Confirmed path inside kiosk-linux-disktools:latest (Ubuntu 24.04,
# syslinux-common package, built --platform linux/amd64).
MBR_BIN_PATH="/usr/lib/syslinux/mbr/mbr.bin"

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
[ -f "$MBR_BIN_PATH" ] || { echo "ERROR: MBR_BIN_PATH ($MBR_BIN_PATH) not found in this image — re-check the kiosk-linux-disktools image's syslinux-common install." >&2; exit 1; }

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

# Disk size must hold TWO complete slots (kernel + rootfs each) plus the
# bootloader and filesystem overhead. 512M was ample for the kiosk-only image
# (~112M rootfs per slot), but the desktop build adds X.org, GTK3, WebKitGTK
# and midori, which roughly doubles the rootfs — two slots would no longer fit
# and the copy would fail partway with a confusing ENOSPC. 2G leaves real
# headroom for both slots plus future growth, and still writes to a 4GB+ USB
# stick. The image is sparse until filled, so the compressed release tarball
# only grows by what is actually used.
DISK_SIZE="${KIOSK_DISK_SIZE:-2G}"
echo "Creating raw disk image ($DISK_IMG, $DISK_SIZE) ..."
rm -f "$DISK_IMG"
truncate -s "$DISK_SIZE" "$DISK_IMG"

echo "Writing partition table (one bootable primary partition, EXT2) ..."
parted --script "$DISK_IMG" mklabel msdos
parted --script "$DISK_IMG" mkpart primary ext2 1MiB 100%
parted --script "$DISK_IMG" set 1 boot on

echo "Attaching loop device with partition scanning ..."
LOOP_DEV="$(losetup -f --show -P "$DISK_IMG")"
echo "Loop device: $LOOP_DEV (partition: ${LOOP_DEV}p1)"

# This container has no udev running, so the kernel registers the p1
# partition in /proc/partitions and /sys/class/block but never gets a udev
# event to create the /dev/loop*p1 device node — confirmed directly (loop
# device node present, partition node absent, `partx -a` fails because the
# kernel already knows about the partition). Create the node by hand from
# the major:minor the kernel already published under sysfs rather than
# depending on udev/partprobe, neither of which is installed in this image.
if [ ! -b "${LOOP_DEV}p1" ]; then
  echo "Partition device node ${LOOP_DEV}p1 missing (no udev in this container) — creating it manually ..."
  PART_NAME="$(basename "$LOOP_DEV")p1"
  DEVNUM="$(cat "/sys/class/block/$PART_NAME/dev")"
  MAJOR="${DEVNUM%%:*}"
  MINOR="${DEVNUM##*:}"
  mknod "${LOOP_DEV}p1" b "$MAJOR" "$MINOR"
fi

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
