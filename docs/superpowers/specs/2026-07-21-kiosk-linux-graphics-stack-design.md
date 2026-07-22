# Kiosk Linux Graphics Stack (Sub-project 2 of the custom-OS program)

**Date:** 2026-07-21
**Status:** Approved, pending implementation plan

## Context

Sub-project 1 (`kiosk-linux/`, merged) proved a minimal Buildroot-based Linux
kernel + BusyBox rootfs boots to a working shell prompt under QEMU. That image has
no graphics of any kind — a text-only serial console. This sub-project is the next
step toward "an actual privately-owned OS running in lieu of Windows": a real DRM/KMS
graphics pipeline that can render to a screen, which sub-project 3 (running RMPG
Flex/Electron itself) will depend on.

Part of a deliberately decomposed program:
1. Base bootable Linux image (done — `kiosk-linux/`)
2. **Graphics/display stack (this spec)**
3. Running RMPG Flex itself (cross-compiled Electron, kiosk-launched on boot)
4. Update/provisioning mechanism
5. Real hardware support (deferred — still no specific target hardware identified;
   this sub-project, like sub-project 1, targets QEMU/generic x86_64 only)

## Non-goals

- No compositor (no Wayland, no X11) — modern Chromium can render directly to
  DRM/KMS via its own `ozone-platform=drm` backend (sub-project 3's concern), so a
  full windowing system is unnecessary scope for a single-app kiosk and is
  deliberately not built here.
- No Chromium/Electron/RMPG Flex — this sub-project proves the graphics pipeline in
  isolation, using libdrm's own diagnostic tooling, not the real application.
- No real hardware GPU drivers — QEMU's `virtio-gpu` only, matching sub-project 1's
  QEMU-only scope decision. Real hardware support (whatever GPU actual target laptops
  have) is deferred to sub-project 5, once specific hardware is identified.
- No touch/input handling beyond what already exists (this is a display-only
  sub-project; input devices are unrelated to DRM/KMS output).
- Does not modify sub-project 1's boot-to-shell behavior — this sub-project adds
  kernel config + packages + a test tool on top of the existing base image, it does
  not change how the image boots or its BusyBox init sequence.

## Overview

Extends the `kiosk-linux/` Buildroot project (no new top-level directory — this is a
direct continuation of sub-project 1's existing `configs/qemu_x86_64_kiosk_defconfig`
and kernel config) with:

- Kernel DRM/KMS support for QEMU's `virtio-gpu` device (`CONFIG_DRM_VIRTIO_GPU` and
  its DRM core dependencies).
- `libdrm` (Buildroot package `BR2_PACKAGE_LIBDRM` + its virtio-gpu-specific driver
  option) and Mesa3D with the virtio-gpu/virgl Gallium driver
  (`BR2_PACKAGE_MESA3D_DRIVER_VIRGL` or equivalent) for actual rendering capability,
  not just mode-setting.
- `modetest` (libdrm's bundled diagnostic tool, enabled via
  `BR2_PACKAGE_LIBDRM_INSTALL_TESTS` or equivalent Buildroot option) as the proof
  mechanism — draws a real test pattern to the framebuffer via the DRM API.
- A new rootfs-overlay init step (or an extension of the existing boot-marker script)
  that runs `modetest` non-interactively and prints a distinctive completion marker,
  mirroring sub-project 1's `KIOSK_LINUX_BOOT_OK` pattern for the new capability
  (e.g. `KIOSK_LINUX_DRM_OK`).

QEMU must be launched with a virtio-gpu display device (`-device virtio-gpu-pci` or
equivalent, replacing sub-project 1's `-nographic`-only invocation for this specific
test) so there's an actual virtual display for the kernel DRM driver to attach to.

## Components

### 1. Kernel configuration

Extends the existing kernel config (currently the in-tree `x86_64` defconfig,
per sub-project 1's `BR2_LINUX_KERNEL_DEFCONFIG="x86_64"`) with a Buildroot kernel
config fragment enabling `CONFIG_DRM=y`, `CONFIG_DRM_VIRTIO_GPU=y`, and their
dependencies (`CONFIG_DRM_KMS_HELPER`, etc.) — via `BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES`
pointing at a new `kiosk-linux/configs/kernel-drm.fragment` file, rather than switching
away from the in-tree defconfig approach sub-project 1 deliberately chose.

### 2. Userspace packages

`libdrm` + Mesa3D (virtio-gpu/virgl driver) added to
`kiosk-linux/configs/qemu_x86_64_kiosk_defconfig`. Mesa3D in particular has a real
build-time cost (it's a large package) — expect this sub-project's first build to take
meaningfully longer than sub-project 1's, on top of Buildroot's already-long
from-scratch toolchain build.

### 3. DRM verification init script

A new rootfs-overlay script (numbered to run after `S99kiosk-boot-marker`, or extending
it directly — implementation plan decides) that runs `modetest -M virtio_gpu` (or
Buildroot's actual installed binary name/path) to draw a test pattern and confirms it
succeeded (exit code check), then prints `KIOSK_LINUX_DRM_OK` to the console —
distinctive and purpose-built, matching sub-project 1's marker convention, not a
heuristic log match.

## Data flow

```
./build.sh (extended kernel config + new packages)
  → kernel now includes DRM/KMS + virtio-gpu driver
  → rootfs now includes libdrm, Mesa3D (virtio-gpu driver), modetest

./test/run-qemu-graphics.sh (new — sub-project 1's run-qemu.sh used -nographic;
this needs an actual virtual display device)
  → qemu-system-x86_64 -device virtio-gpu-pci ... (no -nographic)
  → kernel boots, DRM driver attaches to virtio-gpu
  → init runs modetest, draws test pattern, prints KIOSK_LINUX_DRM_OK to serial log
  → QEMU screenshot capture (same technique as uefi-bootsplash's GOP verification)
     proves the test pattern actually rendered, not just that modetest exited 0

./test/assert-boot-log.sh test/boot.log "KIOSK_LINUX_DRM_OK"
  → PASS confirms the marker; the screenshot is the separate, manual-recipe proof
     that real pixels were drawn (same split as uefi-bootsplash: automated marker
     assertion + a documented manual screenshot recipe for visual confirmation)
```

## Error handling

- If `modetest` fails (DRM device not found, mode-set failure), the init script must
  NOT print the success marker — the boot log's absence of `KIOSK_LINUX_DRM_OK` is
  itself the failure signal, consistent with how sub-project 1's absent
  `KIOSK_LINUX_BOOT_OK` already signals a failed boot.
- This sub-project does not add any new halt/retry logic beyond what BusyBox init
  already does — a failed `modetest` step should not prevent the rest of init from
  completing (the shell prompt must still be reachable even if graphics failed), so
  the script should not use `set -e`-style early exit for this one step.

## Testing

- Fully verifiable in this environment via QEMU + a virtio-gpu display device, same
  testing posture as sub-project 1 — no `[REAL-HARDWARE-UNVERIFIED]` gap, since the
  target IS QEMU/generic x86_64 by explicit scope decision.
- Two-tier verification, mirroring `uefi-bootsplash`'s GOP-rendering precedent: an
  automated marker-string assertion (proves `modetest` ran and exited successfully)
  plus a manual, documented QEMU-screenshot recipe (proves actual pixels rendered,
  which a serial-console log alone cannot show).

## Rollout

Still a standalone, experimental subsystem — no real deployable output from this
sub-project alone (a kernel that can draw a test pattern, not a usable kiosk). Directly
unblocks sub-project 3 (running RMPG Flex via Chromium's `ozone-platform=drm`), which is
where real usefulness starts to appear.
