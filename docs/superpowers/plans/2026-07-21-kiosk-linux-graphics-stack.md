# Kiosk Linux Graphics Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `kiosk-linux/` Buildroot image with a real DRM/KMS
graphics pipeline (virtio-gpu + libdrm + Mesa) and prove it renders actual pixels
under QEMU — the prerequisite sub-project 3 (running RMPG Flex via Chromium's
`ozone-platform=drm`) needs before a browser surface can exist at all.

**Architecture:** Extends sub-project 1's existing Buildroot defconfig and kernel
config (no new top-level directory) with a kernel config fragment for
`CONFIG_DRM_VIRTIO_GPU`, new `libdrm`/`mesa3d` packages, and a new rootfs-overlay init
step that runs `modetest` and prints a distinctive completion marker — the same
two-tier verification pattern (marker assertion + manual screenshot proof) already
proven in `uefi-bootsplash`'s GOP-rendering work.

**Tech Stack:** Buildroot (same pinned `2024.02.9` release as sub-project 1), Linux
DRM/KMS kernel subsystem, libdrm, Mesa3D (virgl/virtio-gpu Gallium driver), QEMU
`virtio-gpu-pci` device.

## Global Constraints

- QEMU/generic x86_64 target only, `virtio-gpu` display device specifically — no real
  hardware GPU driver work in this sub-project.
- No compositor (no Wayland, no X11) — this sub-project proves raw DRM/KMS rendering
  only, via `modetest`, not a windowing system.
- No Chromium/Electron/RMPG Flex in this sub-project — that's sub-project 3.
- Does not change sub-project 1's boot-to-shell behavior — additive only (new kernel
  config, new packages, a new init step), the existing `KIOSK_LINUX_BOOT_OK` marker
  and boot-to-shell path must keep working exactly as before.
- The DRM completion marker must be distinctive and purpose-built
  (`KIOSK_LINUX_DRM_OK`), printed only on `modetest`'s actual success — not a
  heuristic kernel-log match, matching sub-project 1's established convention.
- A failed `modetest` step must NOT prevent BusyBox init from completing — the shell
  prompt must still be reachable even if graphics initialization fails.
- Reproducibility: same pinned Buildroot release (`2024.02.9`, `BUILDROOT_TAG` in
  `kiosk-linux/build.sh`) — do not introduce a second, different pin.
- Exact Buildroot Kconfig symbol names for Mesa3D's virtio-gpu/virgl driver option and
  `libdrm`'s test-tools option are written below as best-effort based on Buildroot
  2024.02.9's package structure — verify each against the real checked-out Buildroot
  source (`grep -rn "VIRGL\|VIRTIO_GPU" $HOME/.local/gnu-efi-pe/../buildroot-kiosk-linux/*/package/mesa3d/Config.in` or wherever this session's `kiosk-linux-buildroot-src` Docker volume's checkout actually lives) before applying — do not guess further if a symbol name is wrong, grep the real Kconfig file, exactly as sub-project 1's plan handled real toolchain-path uncertainty.

---

## File Structure

- **Create:** `kiosk-linux/configs/kernel-drm.fragment` — kernel config fragment
  enabling `CONFIG_DRM=y`, `CONFIG_DRM_KMS_HELPER=y`, `CONFIG_DRM_VIRTIO_GPU=y`.
- **Modify:** `kiosk-linux/configs/qemu_x86_64_kiosk_defconfig` — add
  `BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES` pointing at the new fragment, plus
  `libdrm`/`mesa3d` package options.
- **Create:** `kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-drm-marker` — new init
  script (or, if the implementer determines extending `S99kiosk-boot-marker` directly
  is cleaner given both scripts would sort identically at `S99` and BusyBox init order
  between same-numbered scripts isn't guaranteed — check this and pick whichever
  approach genuinely guarantees the DRM check happens after the base boot marker
  prints, documenting the choice) that runs `modetest`, checks its exit code, and
  prints `KIOSK_LINUX_DRM_OK` only on success.
- **Create:** `kiosk-linux/test/run-qemu-graphics.sh` — boots the image under QEMU
  WITH a `virtio-gpu-pci` display device (sub-project 1's `run-qemu.sh` used
  `-nographic`, which has no display device at all), capturing both the serial log
  and a screenshot.
- **Modify:** `kiosk-linux/README.md` — document the new graphics-stack build/test
  process alongside sub-project 1's existing boot-to-shell instructions.

---

### Task 1: DRM/KMS kernel + userspace packages, verified end-to-end under QEMU

**Files:**
- Create: `kiosk-linux/configs/kernel-drm.fragment`
- Modify: `kiosk-linux/configs/qemu_x86_64_kiosk_defconfig`
- Create: `kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-drm-marker` (or the merged
  alternative described in File Structure above)
- Create: `kiosk-linux/test/run-qemu-graphics.sh` (first version — Task 2 turns this
  into fully scripted, assertable form matching sub-project 1's `assert-boot-log.sh`
  pattern; this task's version just needs to work for your own manual verification)

**Interfaces:**
- Produces: rebuilt `kiosk-linux/output/images/{bzImage,rootfs.cpio.gz}` (same paths
  as sub-project 1, now containing DRM/KMS + libdrm + Mesa + modetest), and the marker
  string `KIOSK_LINUX_DRM_OK` — consumed by Task 2's scripted assertion.

This task has real, unavoidable build uncertainty (Mesa3D is a large, sometimes
finicky package to cross-compile; exact Buildroot Kconfig symbol names need
verification against the real checked-out source, per the Global Constraints note) —
similar in kind to sub-project 1's Task 1. Adapt as needed and document exactly what
you did, the same way that task's build.sh/Dockerfile comments and its final report
did.

- [ ] **Step 1: Confirm the existing sub-project 1 build still works as a baseline**

Before changing anything, confirm the starting point still builds and boots cleanly
(this also warms the Docker volume cache from sub-project 1, if it's still present on
this machine — check `docker volume ls | grep kiosk-linux` first):

```bash
cd kiosk-linux
./build.sh
./test/run-qemu.sh test/boot.log
./test/assert-boot-log.sh test/boot.log "KIOSK_LINUX_BOOT_OK"
```

Expected: PASS, exactly as sub-project 1 left it. If this baseline doesn't pass
before you've changed anything, STOP and investigate the baseline first — don't layer
new, harder-to-debug graphics work on top of a broken foundation.

- [ ] **Step 2: Write the kernel DRM config fragment**

```
# kiosk-linux/configs/kernel-drm.fragment
# Enables DRM/KMS core support plus the virtio-gpu driver, for a real graphics
# pipeline under QEMU's paravirtualized GPU device. Layered on top of the existing
# in-tree "x86_64" kernel defconfig (BR2_LINUX_KERNEL_DEFCONFIG in
# qemu_x86_64_kiosk_defconfig) via Buildroot's kernel config-fragment mechanism,
# which merges these lines into the kernel .config after the base defconfig is
# applied — this keeps sub-project 1's kernel-defconfig choice untouched rather than
# requiring a full custom kernel .config file.
CONFIG_DRM=y
CONFIG_DRM_KMS_HELPER=y
CONFIG_DRM_VIRTIO_GPU=y
```

- [ ] **Step 3: Wire the fragment into the defconfig**

Add to `kiosk-linux/configs/qemu_x86_64_kiosk_defconfig` (near the existing
`BR2_LINUX_KERNEL_DEFCONFIG="x86_64"` line):

```
BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES="/kiosk-linux/configs/kernel-drm.fragment"
```

Use the same absolute in-container path convention (`/kiosk-linux/...`) sub-project
1's `BR2_ROOTFS_OVERLAY` fix already established — a relative path here would be
subject to the exact same `$(TOPDIR)`-vs-`O=` resolution bug already documented in
that file's comments. Confirm this Buildroot option genuinely accepts an absolute
path the same way (check Buildroot's own `Config.in` for
`BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES` if the build fails with a path-not-found
error here — document what you find).

- [ ] **Step 4: Add libdrm + modetest + Mesa3D packages**

Add to `kiosk-linux/configs/qemu_x86_64_kiosk_defconfig` (exact symbol names must be
verified against the real Buildroot 2024.02.9 checkout per the Global Constraints
note — the values below are the best-effort starting point):

```
# libdrm — DRM userspace library, plus its bundled test tools (provides modetest,
# the diagnostic tool this sub-project uses as its proof mechanism).
BR2_PACKAGE_LIBDRM=y
BR2_PACKAGE_LIBDRM_INSTALL_TESTS=y

# Mesa3D with the virgl/virtio-gpu Gallium driver — actual rendering capability,
# not just mode-setting. Verify the exact driver-selection symbol name against
# package/mesa3d/Config.in in the real Buildroot checkout before applying; it may
# be BR2_PACKAGE_MESA3D_DRIVER_VIRGL, BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_VIRGL, or
# similar depending on this Buildroot release's exact Kconfig structure.
BR2_PACKAGE_MESA3D=y
```

- [ ] **Step 5: Grep the real Buildroot checkout for exact package option names**

```bash
# Adjust the volume-mount path per how you actually inspect a named Docker volume's
# contents on this machine — e.g. via a throwaway container:
docker run --rm -v kiosk-linux-buildroot-src:/src alpine \
  sh -c 'grep -n "VIRGL\|VIRTIO_GPU\|INSTALL_TESTS" /src/buildroot/package/mesa3d/Config.in /src/buildroot/package/libdrm/Config.in'
```

Reconcile Step 4's defconfig lines with what this actually shows. Document any symbol
name you had to correct, and why, in your report.

- [ ] **Step 6: Write the DRM verification init script**

```sh
#!/bin/sh
# kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-drm-marker
#
# Runs after the base boot-marker script (see the "File Structure" note in the plan
# for how same-S99-number ordering was resolved — document the actual resolution
# here once decided). Draws a real test pattern via modetest against the virtio-gpu
# DRM device; prints KIOSK_LINUX_DRM_OK ONLY if modetest exits successfully — a
# failed modetest must not print the marker, and must not prevent init from
# continuing to a shell prompt (no `set -e`, no exit-on-failure here).
MODETEST_BIN=$(command -v modetest)
if [ -n "$MODETEST_BIN" ] && "$MODETEST_BIN" -M virtio_gpu >/tmp/modetest.log 2>&1; then
  echo "KIOSK_LINUX_DRM_OK"
else
  echo "KIOSK_LINUX_DRM_FAILED (see /tmp/modetest.log)"
fi
```

Note: confirm the actual driver-name argument `modetest -M <name>` expects for
virtio-gpu (it may be `virtio_gpu`, `virtio-gpu`, or discoverable via `modetest`
with no `-M` flag, which lists available devices) — adjust based on what Step 8's
real boot log shows, don't guess blindly if this specific invocation fails.

Make executable: `chmod +x kiosk-linux/rootfs-overlay/etc/init.d/S99kiosk-drm-marker`
(or the merged-script path, if that's the approach taken).

- [ ] **Step 7: Write the graphics-enabled QEMU test harness**

```bash
#!/usr/bin/env bash
# kiosk-linux/test/run-qemu-graphics.sh
# Boots the built kernel+initramfs under QEMU WITH a virtio-gpu display device
# (unlike test/run-qemu.sh's -nographic, which has no display device at all),
# capturing both the serial console log and a screenshot for visual proof.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${1:-$SCRIPT_DIR/boot-graphics.log}"
SCREENSHOT_FILE="${2:-$SCRIPT_DIR/drm-screenshot.ppm}"
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

rm -f "$LOG_FILE" "$SCREENSHOT_FILE"

# Runs QEMU with a real virtio-gpu display, a monitor socket for the screendump
# command, and serial console logging — same screenshot-capture technique
# uefi-bootsplash's Task 2 established for verifying GOP rendering.
"$TIMEOUT_CMD" 30 qemu-system-x86_64 \
  -kernel "$KERNEL" \
  -initrd "$INITRD" \
  -append "console=ttyS0" \
  -device virtio-gpu-pci \
  -serial file:"$LOG_FILE" \
  -monitor unix:"$SCRIPT_DIR/qemu-monitor.sock",server,nowait \
  -display none \
  -no-reboot &
QEMU_PID=$!

sleep 6
echo "screendump $SCREENSHOT_FILE" | socat - UNIX-CONNECT:"$SCRIPT_DIR/qemu-monitor.sock" 2>/dev/null || \
  echo "WARNING: screendump failed — socat may not be installed (brew install socat), or the monitor socket wasn't ready yet" >&2

kill "$QEMU_PID" 2>/dev/null || true
wait "$QEMU_PID" 2>/dev/null || true
rm -f "$SCRIPT_DIR/qemu-monitor.sock"

echo "wrote $LOG_FILE"
[ -f "$SCREENSHOT_FILE" ] && echo "wrote $SCREENSHOT_FILE"
```

Make executable: `chmod +x kiosk-linux/test/run-qemu-graphics.sh`

If `socat` isn't a workable approach for talking to QEMU's monitor socket in this
environment, an alternative is QEMU's `-monitor stdio` combined with a scripted
expect-style interaction, or `-vnc :0` plus a VNC screenshot tool — use whichever
approach genuinely produces a real screenshot file in this environment, adapting the
script accordingly and documenting which method you used and why (mirroring how
`uefi-bootsplash`'s Task 2 documented its own real screenshot-capture recipe,
including the workarounds it needed).

- [ ] **Step 8: Build and run the full verification**

```bash
cd kiosk-linux
./build.sh
./test/run-qemu-graphics.sh test/boot-graphics.log test/drm-screenshot.ppm
cat test/boot-graphics.log
```

Expected: log contains `KIOSK_LINUX_DRM_OK`. If it instead shows
`KIOSK_LINUX_DRM_FAILED`, read `/tmp/modetest.log`'s content (you'll need to check it
from within a running QEMU session, or add a step that also dumps that file's
content to the serial console before the script exits, if the failure needs deeper
diagnosis) and adjust Step 6's `modetest` invocation accordingly.

Convert the screenshot to a viewable format and confirm it shows real rendered
content (not a blank/black frame):

```bash
sips -s format png test/drm-screenshot.ppm --out test/drm-screenshot.png
```

View the PNG (via the Read tool, or however you're able to inspect images in your
environment) and confirm it shows `modetest`'s test pattern — this is the actual
proof that real pixels rendered through the DRM/KMS pipeline, not just that the
`modetest` process exited 0.

- [ ] **Step 9: Confirm sub-project 1's boot-to-shell behavior is unaffected**

```bash
./test/run-qemu.sh test/boot.log
./test/assert-boot-log.sh test/boot.log "KIOSK_LINUX_BOOT_OK"
```

Expected: still PASS — the new DRM/graphics work must be strictly additive.

- [ ] **Step 10: Commit**

```bash
cd kiosk-linux
git add configs/kernel-drm.fragment configs/qemu_x86_64_kiosk_defconfig \
  rootfs-overlay/etc/init.d/S99kiosk-drm-marker test/run-qemu-graphics.sh
git commit -m "feat(kiosk-linux): add DRM/KMS graphics stack (virtio-gpu, libdrm, Mesa)"
```

Add `test/boot-graphics.log`, `test/drm-screenshot.ppm`, `test/drm-screenshot.png`,
and `test/qemu-monitor.sock` to `kiosk-linux/.gitignore` in the same commit (scratch
test artifacts, matching how `test/boot.log`/`output/` are already excluded).

---

### Task 2: Scriptable DRM-marker assertion

**Files:**
- Modify: `kiosk-linux/test/run-qemu-graphics.sh` (only if Task 1's version needs
  interface adjustments for consistency — confirm first)
- No new assertion script needed: `kiosk-linux/test/assert-boot-log.sh` (from
  sub-project 1) is already generic (`<log-file> <expected-substring>`) and works
  unmodified against the new `KIOSK_LINUX_DRM_OK` marker — this task is verification
  that this reuse actually works end-to-end, not new script-writing.

**Interfaces:**
- Consumes: `kiosk-linux/test/assert-boot-log.sh` (sub-project 1, unmodified).
- Produces: a documented, repeatable two-command verification recipe for the DRM
  marker — consumed by Task 3's README update.

- [ ] **Step 1: Run the scripted assertion against Task 1's real output**

```bash
cd kiosk-linux
./test/run-qemu-graphics.sh test/boot-graphics.log test/drm-screenshot.ppm
./test/assert-boot-log.sh test/boot-graphics.log "KIOSK_LINUX_DRM_OK"
```

Expected: `PASS: found "KIOSK_LINUX_DRM_OK" in test/boot-graphics.log`

- [ ] **Step 2: Also confirm the FAILURE path doesn't false-pass**

Temporarily rename/break the `modetest` invocation in
`S99kiosk-drm-marker` (e.g. point `-M` at a nonexistent driver name), rebuild, rerun,
and confirm:

```bash
./test/assert-boot-log.sh test/boot-graphics.log "KIOSK_LINUX_DRM_OK"
```

Expected: `FAIL` (exit 1) — proving the marker genuinely reflects real success, not a
script that always prints regardless of `modetest`'s actual outcome. Revert the
temporary break afterward and rebuild/reverify the real success path before moving
on (do not leave the deliberately-broken state as your final committed code).

- [ ] **Step 3: Commit** (only if Step 1's or the revert's investigation produced any
  file changes beyond what Task 1 already committed — if nothing changed, skip this
  step and note in your report that Task 2 was pure verification of Task 1's work)

```bash
cd kiosk-linux
git add -A
git commit -m "test(kiosk-linux): verify DRM marker assertion catches real failures, not just successes"
```

---

### Task 3: Documentation

**Files:**
- Modify: `kiosk-linux/README.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Extend the README with the graphics-stack section**

Add a new section to `kiosk-linux/README.md`, after the existing "Testing" section,
following the same "document what actually happened" convention sub-project 1's
README used (not a generic template — the real Mesa3D build-time cost you observed,
the real screenshot-capture recipe, any Buildroot Kconfig symbol name corrections
from Task 1's Step 5):

```markdown
## Graphics stack (sub-project 2)

Extends the base image with a real DRM/KMS graphics pipeline: kernel `virtio-gpu`
driver support, `libdrm`, and Mesa3D's virgl/virtio-gpu Gallium driver. Verified via
`modetest` (libdrm's diagnostic tool) drawing a real test pattern, confirmed both by
a boot-log marker and an actual QEMU screenshot.

**This build is noticeably heavier than sub-project 1's** — Mesa3D is a large
package. [Fill in: the real build-time delta you observed, e.g. "adds roughly N
minutes to a from-scratch build."]

    ./build.sh
    ./test/run-qemu-graphics.sh test/boot-graphics.log test/drm-screenshot.ppm
    ./test/assert-boot-log.sh test/boot-graphics.log "KIOSK_LINUX_DRM_OK"
    sips -s format png test/drm-screenshot.ppm --out test/drm-screenshot.png

The PNG should show `modetest`'s rendered test pattern — a script-only PASS confirms
`modetest` ran successfully but does not by itself prove pixels were drawn correctly;
the screenshot is the real visual proof, same two-tier verification `uefi-bootsplash`
used for its own GOP rendering.

This does NOT include a compositor, Chromium, or RMPG Flex — see sub-project 3.
```

Fill in the bracketed build-time note with the real number from your own Task 1 run
— do not leave the placeholder text in the committed file.

- [ ] **Step 2: Commit**

```bash
cd kiosk-linux
git add README.md
git commit -m "docs(kiosk-linux): document the DRM/KMS graphics stack build and verification"
```
