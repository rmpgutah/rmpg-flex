# Kiosk Linux Base Image (sub-project 1)

A minimal Buildroot-based Linux kernel + root filesystem that boots to a working
BusyBox shell under QEMU. This is the FIRST of a multi-sub-project program exploring
a custom Linux-based kiosk OS as an alternative platform to the Windows-based Desktop
Kiosk Shell Mode / UEFI Boot Splash work already shipped elsewhere in this repo.

See [`docs/superpowers/specs/2026-07-21-kiosk-linux-base-image-design.md`](../docs/superpowers/specs/2026-07-21-kiosk-linux-base-image-design.md)
for the full design and explicit scope decisions.

## What this does NOT do yet

- No graphics/display stack (sub-project 2)
- Does not run RMPG Flex or any browser (sub-project 3)
- No update/provisioning mechanism (sub-project 4)
- No real hardware support — QEMU/generic x86_64 only (deferred until specific target
  hardware is identified)
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
