# Kiosk Linux Base Image (Sub-project 1 of the custom-OS program)

**Date:** 2026-07-21
**Status:** Approved, pending implementation plan

## Context

Following Desktop Kiosk Shell Mode and the UEFI Boot Splash (both merged), the user
asked to continue toward "a full Operating System design." As with the earlier
bootloader ask, a from-scratch OS was ruled out — RMPG Flex depends on Chromium/Node
to run at all. Narrowed through brainstorming to something real: **a custom
Linux-based kiosk image**, the same approach many commercial kiosks/ATMs actually use
— a minimal Linux distro that boots directly into the existing RMPG Flex Electron app
running fullscreen, with no general-purpose desktop OS underneath.

This is explicitly a multi-sub-project program, decomposed as:
1. **Base bootable Linux image** (this spec)
2. Display/graphics stack (DRM/KMS framebuffer for a fullscreen browser surface)
3. Running RMPG Flex itself (cross-compiling the existing Electron app for Linux,
   kiosk-launching it on boot)
4. Update/provisioning mechanism (A/B partition scheme or similar)
5. Real hardware support (deferred — no specific target hardware identified yet; this
   and every earlier sub-project target a generic QEMU/x86_64 virtual machine only)

This spec covers **only sub-project 1**: proving a minimal Linux kernel + root
filesystem boots to a working shell under QEMU, with nothing else running yet.

## Non-goals

- No graphics/display stack, no browser, no RMPG Flex — this image boots to a text
  console shell and does nothing else. Sub-projects 2/3 build on top of this.
- No real hardware support — QEMU/generic x86_64 only, per explicit user decision, since
  no specific deployed hardware model has been identified. A future sub-project revisits
  this once real target hardware is known.
- No connection to the UEFI Boot Splash project (`uefi-bootsplash/`) yet — that project
  currently chainloads to Windows only. Whether/how it might later chainload to THIS
  Linux image instead is a future integration decision, explicitly deferred, not part
  of this sub-project.
- No update/provisioning mechanism, no A/B partitioning, no persistent writable state
  design — this is a single, disposable build-and-boot image for proving the toolchain.
- No systemd, no general-purpose Linux distribution features (package manager, multi-user
  accounts, SSH server) — BusyBox init only, matching a locked-down kiosk's actual needs.
- Not a replacement for anything Windows-based already built (Kiosk Shell Mode, UEFI
  splash) — this is a separate, parallel track exploring a non-Windows platform choice,
  which the user may or may not ultimately pursue for real deployment.

## Overview

A Buildroot-based project (new top-level directory `kiosk-linux/`, alongside
`uefi-bootsplash/` and `desktop/` as this repo's other independent, non-Cloudflare-Worker
subsystems) that produces:

- A Linux kernel image, configured minimally (no unnecessary drivers — QEMU's virtual
  hardware only: virtio block/net, a basic VGA/serial console).
- A small root filesystem (BusyBox-based userspace, statically linked where practical)
  packaged as an initramfs (simplest possible boot path for this first sub-project — no
  disk image, no filesystem driver complexity yet; a real block-device rootfs is a
  natural extension for a later sub-project once persistent state actually matters).
- Boots via QEMU's direct kernel boot (`-kernel bzImage -initrd rootfs.cpio.gz -append
  "console=ttyS0"`) — no bootloader/GRUB integration in this pass; that's deferred to
  whenever this image needs to boot on something other than QEMU's `-kernel` flag
  (i.e., whenever it needs to integrate with a real bootloader, possibly the existing
  UEFI splash project, as a later decision).
- Reaches a working BusyBox `ash` shell prompt on the serial console, confirming the
  full kernel+init+userspace chain works end to end.

## Components

### 1. Buildroot configuration

A `kiosk-linux/configs/qemu_x86_64_kiosk_defconfig` (following Buildroot's standard
`defconfig` naming/location convention) based on Buildroot's own bundled
`qemu_x86_64_defconfig` as a starting point, trimmed to the minimum needed: kernel,
BusyBox, no unnecessary packages (no Wayland/X11/graphics stack — sub-project 2's job).

### 2. Build wrapper

A `kiosk-linux/build.sh` script that fetches Buildroot (pinned to a specific released
version — reproducibility matters here exactly as it did for `uefi-bootsplash`'s
gnu-efi situation), applies the defconfig, and runs the build, producing
`kiosk-linux/output/images/bzImage` and `rootfs.cpio.gz` (Buildroot's standard output
layout).

### 3. QEMU boot verification

A `kiosk-linux/test/run-qemu.sh` script (naming/structure intentionally parallel to
`uefi-bootsplash/test/run-qemu.sh`) that boots the built kernel+initramfs under QEMU
with a serial console, captures output to a log file, and a companion
`kiosk-linux/test/assert-boot-log.sh` (reusing the same pattern as
`uefi-bootsplash/test/assert-boot-log.sh`) that asserts the log shows a successful boot
to a shell prompt.

## Data flow

```
./build.sh
  → fetches pinned Buildroot version
  → applies configs/qemu_x86_64_kiosk_defconfig
  → builds kernel (bzImage) + BusyBox rootfs (rootfs.cpio.gz)

./test/run-qemu.sh
  → qemu-system-x86_64 -kernel bzImage -initrd rootfs.cpio.gz
      -append "console=ttyS0" -serial file:boot.log -display none -nographic
  → captures full boot sequence (kernel messages, init, BusyBox startup) to boot.log

./test/assert-boot-log.sh boot.log "<expected shell-prompt marker>"
  → PASS if the log shows the shell reached a working prompt
```

## Error handling

- Build failures (missing host build dependencies, Buildroot fetch failure) must fail
  loudly with `set -euo pipefail` and a clear message — no silent partial builds.
- The QEMU boot test has no interactive input; it's a fixed-duration capture (matching
  `uefi-bootsplash`'s `run-qemu.sh` timeout-based approach) since there's no reliable
  "boot complete" event to wait on from outside the VM at this stage — a real completion
  signal (e.g., a script that writes a sentinel value/prints a fixed string once BusyBox
  init finishes and drops to a shell) is something the implementation plan should include
  in the root filesystem itself (an init script printing a distinctive marker), rather
  than only relying on generic kernel boot log text, which can vary across kernel
  versions/config changes.

## Testing

- Fully verifiable in this environment via QEMU, same as the UEFI Boot Splash project.
- No real-hardware constraint for this sub-project (explicitly out of scope per
  Non-goals) — unlike the UEFI/Kiosk Shell Mode work, there is no
  `[REAL-HARDWARE-UNVERIFIED]` gap here, since the target IS QEMU/generic x86_64.

## Rollout

This is a standalone, experimental subsystem — not connected to any existing deploy
pipeline (`deploy.yml`, `electron-builder`, or `uefi-bootsplash`'s manual installation
docs). It exists to prove the toolchain for sub-projects 2/3/4, which is where any real
usefulness starts to appear. No installation/rollout guidance is needed yet since there
is nothing deployable produced by this sub-project alone (a shell prompt, not a usable
kiosk).
