# Kiosk Linux Sub-Project 5: A/B Boot Partition — Design

## Status

Approved 2026-07-23. This is a prerequisite for a future OTA-update-delivery
sub-project (not yet designed) — OTA delivery needs somewhere persistent to
write a new image to and a safe way to switch to it; this sub-project builds
that mechanism in isolation, without wiring up any actual update-download
logic yet.

## Problem

Every prior Kiosk Linux sub-project (1: base image, 2: DRM/KMS graphics,
3: networking + browser, 4: device registry) produces a `bzImage` +
`rootfs.cpio.gz` pair that QEMU boots directly via `-kernel`/`-initrd` — a
pure initramfs image with no persistent, writable storage on the device at
all (confirmed via `kiosk-linux/configs/qemu_x86_64_kiosk_defconfig:81-83`:
`BR2_TARGET_ROOTFS_CPIO=y`, `BR2_TARGET_ROOTFS_EXT2=n`). There is nowhere for
an eventual OTA update to land, and no bootloader in the picture to switch
between an old and a new image.

## Non-goals

- No actual OTA update download/apply logic — that is a separate, future
  sub-project built on top of this one. This sub-project's own test is
  manually seeding slot A and slot B with the *same* known-good image and
  confirming the fallback mechanism triggers correctly when a slot is
  deliberately made to fail (e.g. by breaking its init script).
- No real hardware — stays QEMU/virtio-blk only, consistent with every
  earlier Kiosk Linux sub-project's scope.
- No UEFI — legacy BIOS boot via syslinux/extlinux only, matching the
  existing QEMU target's boot mode (no bootloader of any kind exists yet,
  so there is nothing to migrate off of).
- No partition-level integrity/checksum verification of the images
  themselves — the fallback logic here only detects "this slot failed to
  reach a healthy boot N times," not corruption of the image files.

## Architecture

**Disk layout**: a new QEMU virtio-blk virtual disk (in addition to, or
replacing, the current direct `-kernel`/`-initrd` boot — QEMU instead boots
BIOS-style from this disk's MBR). One EXT2 partition holds:
- `extlinux.conf` — syslinux's boot menu config; its `DEFAULT` directive
  names the currently-active slot.
- `slot_a/{bzImage,rootfs.cpio.gz}` and `slot_b/{bzImage,rootfs.cpio.gz}` —
  each slot's full kernel+initramfs pair.
- `boot_attempts` — a small text file holding the current failed-attempt
  counter for whichever slot is active.

**Bootloader**: syslinux/extlinux (`BR2_TARGET_SYSLINUX=y`), not GRUB2 —
lighter weight, Buildroot has first-class support for it, and switching the
active slot is just rewriting one `DEFAULT` line in `extlinux.conf`, which a
plain init script can do with `sed`.

**Boot-attempt / fallback logic**, as a new early init script (runs before
networking/browser, i.e. before the existing `S99kiosk-net-marker`):
1. Read `boot_attempts` (default 0 if missing); increment it and write it
   back.
2. If the new value exceeds a threshold (3), rewrite `extlinux.conf`'s
   `DEFAULT` line to the *other* slot, reset `boot_attempts` to 0, and
   `reboot` immediately — the next boot picks up the other slot via
   syslinux.
3. Otherwise, continue booting normally into the current slot.

**Success signal**: reuses the existing `S99kiosk-browser-marker` script
from sub-project 3 (which already prints `KIOSK_LINUX_BROWSER_OK` once the
`cog --platform=drm` browser process survives its 20-second liveness check).
Immediately after that point is reached, a new line resets `boot_attempts`
to 0 — this is the "confirmed good" signal. A slot that never gets this far,
repeated across attempts, is what triggers the fallback in step 2 above.

**Build/test changes**:
- `kiosk-linux/configs/qemu_x86_64_kiosk_defconfig`: add
  `BR2_TARGET_SYSLINUX=y` and its related options (syslinux MBR record,
  `extlinux.conf` templating).
- `kiosk-linux/build.sh`: after the existing Buildroot compile step, add a
  disk-image-assembly step — create the virtio-blk raw disk image, partition
  it (EXT2), install syslinux's MBR bootstrap, write `extlinux.conf`, and
  copy the built `bzImage`/`rootfs.cpio.gz` into `slot_a/` (with `slot_b/`
  seeded as an identical copy for the initial build, since there is no
  second, different image to test against yet — this sub-project's own
  fallback test manually corrupts one slot's init script afterward to
  trigger the mechanism).
- `kiosk-linux/test/run-qemu-*.sh`: updated to boot QEMU from the new disk
  image (`-drive file=disk.img,if=virtio`) instead of the current
  `-kernel`/`-initrd` flags.
- New rootfs-overlay init script (e.g.
  `kiosk-linux/rootfs-overlay/etc/init.d/S01kiosk-boot-slot-check`) — the
  boot-attempt counter/fallback logic described above. Numbered `S01` so it
  runs very early, before `S99kiosk-net-marker`/`S99kiosk-browser-marker`.

## Error handling

- Both slots corrupted/failing indefinitely: after each slot has been tried
  and failed the threshold count, the device will keep bouncing between
  slot A and slot B forever (since both eventually exceed the threshold and
  flip back). This is an accepted, explicit limitation for this sub-project
  — there is no "give up and halt" state yet, since with only QEMU testing
  and no real hardware, an infinite reboot loop is observable and diagnosable
  rather than a real operational risk. A future sub-project could add a
  hard stop after both slots fail some number of total cycles.
- `boot_attempts` file missing or unreadable at boot: treated as 0 (fresh
  start), not a fatal error.

## Testing

Manual QEMU-based verification (no existing Worker/D1 test suite is
relevant here — this is pure Buildroot/bootloader/init-script work,
consistent with how sub-projects 1-3 were verified):
1. Build the image; boot via the new disk-based QEMU invocation; confirm it
   reaches `KIOSK_LINUX_BROWSER_OK` via slot A (the default), and confirm
   `boot_attempts` resets to 0 after that point.
2. Deliberately break slot B's init script (e.g. make its browser-marker
   script exit immediately without ever printing `KIOSK_LINUX_BROWSER_OK`),
   manually flip `extlinux.conf`'s default to slot B, and confirm: it boots
   into slot B, fails to reach the success signal three times in a row
   (three separate QEMU boot cycles), and on the third failure the fallback
   logic flips `extlinux.conf` back to slot A and the next boot succeeds
   there.
3. Confirm `boot_attempts` is being written/read correctly across reboots
   (i.e. persisted on the EXT2 partition, not reset by the initramfs-loaded
   rootfs — this is exactly why this needs a real persistent partition and
   not just the RAM-loaded rootfs from before).
