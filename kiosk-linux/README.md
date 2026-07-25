# Kiosk Linux Base Image (sub-project 1)

A minimal Buildroot-based Linux kernel + root filesystem that boots to a working
BusyBox shell under QEMU. This is the FIRST of a multi-sub-project program exploring
a custom Linux-based kiosk OS as an alternative platform to the Windows-based Desktop
Kiosk Shell Mode / UEFI Boot Splash work already shipped elsewhere in this repo.

See [`docs/superpowers/specs/2026-07-21-kiosk-linux-base-image-design.md`](../docs/superpowers/specs/2026-07-21-kiosk-linux-base-image-design.md)
for the full design and explicit scope decisions.

## Current state (2026-07-24)

**The kiosk boots to a working, fully rendered RMPG Flex console.** Verified by a
real QEMU screenshot showing the live login screen with the device panel reporting
Server/Connection Online, zero segfaults across the run. See
[`RELEASE.md`](RELEASE.md) for what changed in 1.2.0 — in particular the
`glib-networking` fix that resolved the long-standing "loads pages but renders
blank white" limitation, and the cog `user_data` fix (patch 0005) behind the
SIGSEGV that appeared once real page content started flowing.

Target hardware is now the **Panasonic Toughbook FZ-55** — the kernel and Mesa
config carry i915/iris graphics, e1000e networking, NVMe/SATA storage, and
USB/HID enablement for it (`configs/kernel-fz55.fragment`). That enablement is
purely additive; the same image still boots under QEMU on virtio devices.

## What this does NOT do yet

- **Not yet validated on physical FZ-55 hardware** — all verification to date is
  under the QEMU reference environment. Flash and confirm one unit before any
  fleet rollout.
- No Wi-Fi stack (wired ethernet only — iwlwifi needs firmware blobs and a
  wpa_supplicant userspace this image does not carry)
- Legacy/CSM boot only — no UEFI-native boot path yet (some late FZ-55 firmware
  revisions have removed CSM; a UEFI build is planned)
- No OTA update delivery — the A/B slot *mechanism* exists and self-heals a bad
  boot, but nothing yet pushes a new image into the inactive slot
- No connection to the existing `uefi-bootsplash/` project — that project still
  chainloads to Windows only; whether it might later chainload to this image instead
  is an undecided future integration question

## Building

**Buildroot officially supports Linux hosts only.** macOS's `gcc` is a Clang alias,
not a real GCC, and Buildroot's build system otherwise assumes GNU coreutils / a
POSIX toolchain producing ELF binaries that BSD-userland macOS doesn't provide — this
was confirmed directly (native build fails with Buildroot's own `You must install
'gcc' on your build machine` check). The actual build therefore runs inside a Docker
container.

This dev environment has no Docker daemon running by default (Docker Desktop's GUI app
doesn't start under this environment's sandboxing), so [Colima](https://github.com/abiosoft/colima)
— a lightweight Linux VM manager built on macOS's Virtualization.framework — provides
the container runtime:

    brew install colima docker
    colima start --cpu 4 --memory 8 --disk 60

Once `docker info` succeeds, build:

    cd kiosk-linux
    ./build.sh

### Building on Windows (WSL2)

`build.sh` needs no changes to run under WSL2 — it's plain bash + the `docker`
CLI. WSL2 runs a real Linux kernel, so there's no Colima-style VM workaround
needed: enable Docker Desktop's **WSL Integration** for your distro (Settings >
Resources > WSL Integration), or install `docker-ce` directly inside the WSL2
distro, and `docker info` will succeed the same way it does on a native Linux
host.

One rule carries over from the macOS case for the same underlying reason:
**run this from a path inside the WSL2 filesystem** (e.g. `~/kiosk-linux`),
**not** a Windows drive mounted into WSL2 (`/mnt/c/Users/.../kiosk-linux`) —
that mount goes through a cross-filesystem translation layer (the 9P/Plan 9
protocol) analogous to Colima's virtiofs, which is exactly the class of bug
that forced this project onto named Docker volumes instead of a host bind
mount in the first place (see "Why named volumes, not a bind mount" below).
The named-volume build output is unaffected either way, so once you're
building from the WSL2-native filesystem, `./build.sh` behaves identically to
the macOS/Colima path.

This:
1. Builds a Docker image (`docker/Dockerfile`, Ubuntu 24.04 + Buildroot's mandatory
   packages plus a few kernel-build-specific ones — see that file's comments).
2. Clones a pinned Buildroot release (`BUILDROOT_TAG` in `build.sh`, default
   `2024.02.9`) into a named Docker volume.
3. Applies `configs/qemu_x86_64_kiosk_defconfig` and builds — **entirely inside named
   Docker volumes, not a host bind mount** (see "Why named volumes, not a bind mount"
   below for why this matters).
4. Copies the two final images out to `output/images/{bzImage,rootfs.cpio.gz}`.

**This is a genuinely long build** — Buildroot compiles an entire cross-toolchain
(binutils, GCC, the kernel, BusyBox) from source. Real builds in this environment took
15–40+ minutes per run depending on what needed rebuilding. This is expected Buildroot
behavior, not a hang — don't interrupt it prematurely.

### Why named volumes, not a bind mount

The first working version of `build.sh` bind-mounted the O= build-output directory
directly from the macOS host (`-v "$SCRIPT_DIR/output":/kiosk-linux/output`). This hit
a real, repeatable failure: extracting the Linux kernel source tarball threw dozens of
`Permission denied` errors on specific files/directories, identically on every retry
— not stale build state, since deleting the extraction directory and retrying from
scratch reproduced the exact same failures immediately. Root cause: Colima's
virtiofs/9p translation between the Linux VM and the macOS host filesystem does not
faithfully preserve POSIX directory-permission ordering during extraction — some
kernel-tarball directories are archived with restrictive permission bits on the
directory entry itself, and the translated bind-mount filesystem enforces that against
the extracting process too early. The fix: the entire O= build tree (and the Buildroot
source checkout) now live in named Docker volumes — real filesystems inside the Linux
VM, with no host-permission translation involved — and only the two final images this
project actually needs get copied out to the host at the very end.

Two other real bugs were found and fixed along the way (documented in more detail as
comments in the files themselves):
- The kernel's `objtool` build needs `libelf-dev` (`gelf.h`), missing from the base
  container image — added, along with `flex`/`bison`/`libssl-dev` (common additional
  kernel-build host dependencies).
- `BR2_ROOTFS_OVERLAY` resolves relative to Buildroot's own source tree, never
  relative to `O=` — the defconfig now uses the absolute in-container path
  `/kiosk-linux/rootfs-overlay` instead of a relative one.

## Testing

Requires `qemu-system-x86_64` on PATH (`brew install qemu` — already installed for the
`uefi-bootsplash` project if you've built that first) and GNU `timeout` — a stock macOS
host has neither `timeout` natively, so `run-qemu.sh` falls back to Homebrew coreutils'
`gtimeout` (`brew install coreutils`) if `timeout` isn't found; it errors clearly if
neither is present.

    ./test/run-qemu.sh test/boot.log
    ./test/assert-boot-log.sh test/boot.log "KIOSK_LINUX_BOOT_OK"

Should print `PASS`. This confirms the kernel boots, BusyBox init runs, and the
project's own boot-marker init script (`rootfs-overlay/etc/init.d/S99kiosk-boot-marker`)
executes to completion — i.e., the full chain works end to end. Real captured output
from a successful run shows the full kernel boot log, BusyBox startup
(`Starting syslogd: OK`, `Starting klogd: OK`, ...), the literal marker line
`KIOSK_LINUX_BOOT_OK`, and finally a login prompt.

## Reproducibility

The exact Buildroot release is pinned in `build.sh` (`BUILDROOT_TAG`) — do not build
against an unpinned/latest Buildroot checkout, for the same reproducibility reasons
documented in `uefi-bootsplash/build-gnuefi-pe.sh`. The volume-based build state
persists across runs (Docker volumes are not deleted by `build.sh`), so a second
`./build.sh` run after a code change only rebuilds what actually changed, rather than
starting the whole toolchain over from scratch.

The persisted Buildroot source checkout + build tree (a full cross-toolchain plus the
kernel, multiple GB) live in two named Docker volumes:
`kiosk-linux-buildroot-src` and `kiosk-linux-build-output`. To force a fully clean
rebuild or reclaim that disk space:

    docker volume rm kiosk-linux-buildroot-src kiosk-linux-build-output

## Graphics stack (sub-project 2)

Extends the base image with a real DRM/KMS graphics pipeline: kernel `virtio-gpu`
driver support, `libdrm`, and Mesa3D's virgl/virtio-gpu Gallium driver
(`BR2_PACKAGE_MESA3D_GALLIUM_DRIVER_VIRGL` — the real Buildroot 2024.02.9 symbol,
verified by grepping the checked-out source; the shorter guess
`BR2_PACKAGE_MESA3D_DRIVER_VIRGL` without `_GALLIUM_` does not exist in this
release). Verified two ways: a distinct boot marker (`KIOSK_LINUX_DRM_OK`, printed
only after `modetest` genuinely commits a mode — see the extensive comments in
`rootfs-overlay/etc/init.d/S99kiosk-drm-marker` for the real bugs found getting this
right) and an actual QEMU screenshot showing `modetest`'s SMPTE-style color-bar test
pattern.

**This build is noticeably heavier than sub-project 1's** — Mesa3D is a large
package. In this environment, a from-scratch Mesa3D build (with sub-project 1's host
toolchain/kernel-headers already cached in the Docker volumes) took roughly an hour;
each subsequent rebuild after a rootfs-overlay-only change (no package/kernel-config
change) took a few minutes.

    ./build.sh
    ./test/run-qemu-graphics.sh test/boot-graphics.log test/drm-screenshot.ppm
    ./test/assert-boot-log.sh test/boot-graphics.log "KIOSK_LINUX_DRM_OK"
    sips -s format png test/drm-screenshot.ppm --out test/drm-screenshot.png

The PNG should show a real color-bar test pattern — a script-only PASS confirms
`modetest`'s log doesn't contain a failure and the marker printed, but the screenshot
is the actual visual proof pixels were drawn, same two-tier verification
`uefi-bootsplash` used for its own GOP rendering.

Real environment issues found and fixed while getting this working (see inline
comments in `test/run-qemu-graphics.sh` and `rootfs-overlay/etc/init.d/S99kiosk-drm-marker`
for full detail):
- QEMU's monitor Unix socket path exceeded the 104-byte `sockaddr_un` limit under
  this repo's deeply nested worktree paths — moved to `/tmp` via `mktemp`.
- The default machine type's built-in VGA adapter, not `virtio-gpu-pci`, is what
  `screendump` captures by default — needs `-vga none`.
- `modetest -s` exits almost immediately when its stdin isn't a real interactive
  terminal, and virtio-gpu tears the scanout back down when it exits — needed a
  read-write FIFO to keep it genuinely blocked (a *read-only* FIFO blocks the whole
  shell command from ever starting `modetest` at all, a real bug this project hit).
- `modetest`'s own exit/liveness is NOT a valid success signal — it still reaches
  its blocking wait even after logging a real mode-set failure. The marker checks
  the log content instead, polling briefly rather than trusting one fixed delay.

This QEMU build has no `virgl`/GL acceleration compiled in at all (no
`virtio-gpu-gl-pci` device, no GL-capable display backend) — not needed once the
above bugs were fixed; plain software `virtio-gpu-pci` rendering was sufficient for
a real screenshot.

This does NOT include a compositor, Chromium, or RMPG Flex — see sub-project 3.

## Kiosk browser (sub-project 3)

Adds real networking (kernel `virtio-net` + BusyBox `udhcpc` + `ca-certificates`
for TLS trust roots) and a kiosk browser — WPE WebKit via the Cog launcher,
rendering directly against the DRM/KMS backend from sub-project 2 with no
compositor — pointed at the live `https://rmpgutah.us`. Chromium was
considered and rejected: Buildroot has no Chromium package, and building it
from source needs Google's own depot_tools/gn/ninja toolchain plus a
30-100GB source tree — realistically its own separate multi-day-to-multi-week
program, not a slice of this sub-project.

**Real, honest result** (see `docs/superpowers/specs/2026-07-22-kiosk-linux-rmpg-flex-browser-design.md`
for the full design):

- Networking: works. `KIOSK_LINUX_NET_OK` confirms a real DHCP lease and outbound
  HTTP reachability.
- The browser process (`cog --platform=drm`) is genuinely stable. Getting there
  required finding and fixing a real, reproducible SIGSEGV — root-caused via gdb
  (register-level inspection of the faulting instruction, not just a backtrace)
  to a race between libwayland-server's `wl_shm_pool` resize logic and Cog's own
  buffer-pool handling: when a resize is deferred (an external reference held
  open), `wl_shm_buffer_get_data()` logs a warning but still returns a pointer
  computed against the *not-yet-grown* mapping, which Cog then dereferenced
  unconditionally. Fixed with a two-part patch: libwayland now returns `NULL` in
  that exact condition instead of a stale pointer, and Cog checks for `NULL` and
  drops the frame instead of crashing. A related bug — Cog's buffer-reuse fast
  path overwriting `buffer->export.shm_buffer` without releasing the previous
  reference first, permanently leaking the pool's external reference after the
  first couple of frames — was also found and fixed. Confirmed crash-free across
  many consecutive boots.
- **Known limitation, not resolved this round**: the browser successfully loads
  pages (WebKit's own "Loaded successfully" event fires) but the rendered output
  is blank white. Direct pixel-byte inspection via gdb proved this is *not* a bug
  anywhere in the Cog/libwayland/GBM/DRM pipeline above — the raw bytes
  WebProcess exports are already uniformly `0xff` (blank) before any of that code
  touches them. The actual painting happens inside WebKit's own Cairo-based
  software compositor (traced as far as `wpebackend-fdo`'s `ws-shm.cpp`
  surface-attach/commit path and WebKit's `AcceleratedSurfaceLibWPE`/`WPEBufferSHM`
  sources), which was not resolved this session. Getting real debug visibility
  into that layer needs a WebKit Debug build, which this session confirmed is
  **not cleanly supported** by WPEWebKit 2.44.4 under this Buildroot toolchain —
  forcing `CMAKE_BUILD_TYPE=Debug` compiles successfully to 99.9% completion and
  then fails to link (`undefined reference to
  JSC::UnlinkedMetadataTable::~UnlinkedMetadataTable()`). A future attempt at this
  should either find the correct Debug-mode fix for that link error, or
  investigate WebKit's Cairo/compositor source directly without relying on
  runtime debug logging.

    ./build.sh
    ./test/run-qemu-browser.sh test/boot-browser.log test/browser-screenshot.ppm
    ./test/assert-boot-log.sh test/boot-browser.log "KIOSK_LINUX_NET_OK"
    ./test/assert-boot-log.sh test/boot-browser.log "KIOSK_LINUX_BROWSER_OK"
    sips -s format png test/browser-screenshot.ppm --out test/browser-screenshot.png

The PNG will show a blank white page — this is the honest, current result, not
a broken test. `KIOSK_LINUX_NET_OK` and `KIOSK_LINUX_BROWSER_OK` both passing
confirms the fixed layers; the blank render is the known, documented remaining
gap above.

This does NOT include auto-login (a human still authenticates against whatever
page actually renders), an update/provisioning mechanism (sub-project 4), or
real hardware support (deferred) — see
`docs/superpowers/specs/2026-07-22-kiosk-linux-rmpg-flex-browser-design.md`
for the full design and explicit non-goals.
