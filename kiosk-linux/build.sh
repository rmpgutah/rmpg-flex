#!/usr/bin/env bash
# kiosk-linux/build.sh
# Fetches a pinned Buildroot release and builds the kiosk-linux defconfig,
# producing kiosk-linux/output/images/{bzImage,rootfs.cpio.gz}.
#
# Buildroot version pinned for reproducibility (see uefi-bootsplash/build-gnuefi-pe.sh
# for the same rationale applied to gnu-efi) — override on the command line if a
# specific machine already has a different checkout:
#   BUILDROOT_DIR=/path/to/existing/checkout ./build.sh
#
# --- macOS host note (read before assuming this behaves like a plain `make`) ---
# Buildroot officially supports Linux hosts only. Task 1's Step 1 confirmed
# this directly on this machine: even after working around an unrelated
# harness-PATH issue (spaces in $PATH broke Buildroot's dependency-check
# script), the native build failed with Buildroot's own host check:
#   "You must install 'gcc' on your build machine"
# macOS's `gcc` is a Clang alias, not a real GCC, and Buildroot's build system
# assumes a POSIX/GNU toolchain producing ELF binaries throughout — this is
# the documented Linux-only constraint, not a fixable flag.
#
# This machine also has no running Docker daemon out of the box (Docker
# Desktop's GUI app would not start under this environment's sandboxing), so
# this script uses Colima (https://github.com/abiosoft/colima) — a
# lightweight Linux VM manager built on macOS's Virtualization.framework —
# as the actual container runtime. `brew install colima docker` +
# `colima start` stood up a real `docker` CLI talking to an Ubuntu 24.04
# aarch64 Linux VM in ~30s, with no GUI interaction required. Everything below
# assumes `docker` is already working (`docker info` succeeds) — if it's not,
# run `colima start` first (see kiosk-linux docs / task-1 report for the full
# recipe if Colima itself isn't installed yet).
#
# The actual Buildroot build therefore runs inside a Docker container (image
# built from docker/Dockerfile, a stock Ubuntu 24.04 + Buildroot's documented
# "Mandatory packages" list) rather than directly on the host. Buildroot
# itself still cross-compiles a real x86_64 target from that Linux
# container regardless of the container's own aarch64 host architecture --
# ordinary GCC cross-compilation, no QEMU user-mode emulation of the host
# toolchain required.
#
# The O= build output tree ALSO lives in a named Docker volume, not a host
# bind mount. First attempt bind-mounted kiosk-linux/output/ directly and hit
# a real, repeatable failure: extracting the Linux kernel source tarball
# (package/pkg-generic.mk's plain `tar` extract step) threw dozens of
# "Permission denied" errors on specific files/subdirectories every single
# time, at the exact same paths — not file-corruption from an interrupted
# run, since a from-scratch retry against a freshly-deleted extraction
# directory hit the identical failures immediately. Root cause: Colima's
# virtiofs/9p bind-mount translation between the Linux VM and the macOS host
# filesystem does not faithfully preserve POSIX directory-permission
# semantics during extraction — some kernel-tarball directories are archived
# with restrictive permission bits on the directory entry itself, and the
# translated bind-mount filesystem enforces that against the *extracting*
# process too early, before its own child files can be written. A named
# Docker volume is a real filesystem inside the Linux VM (no host-permission
# translation involved), so the entire Buildroot build now happens there;
# only the two final images this project actually needs get copied out to
# the host-visible kiosk-linux/output/ directory at the very end.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILDROOT_TAG="${BUILDROOT_TAG:-2024.02.9}"
OUTPUT_DIR="$SCRIPT_DIR/output"
IMAGE_TAG="kiosk-linux-buildroot:latest"
BUILDROOT_VOLUME="${BUILDROOT_VOLUME:-kiosk-linux-buildroot-src}"
BUILD_OUTPUT_VOLUME="${BUILD_OUTPUT_VOLUME:-kiosk-linux-build-output}"

mkdir -p "$OUTPUT_DIR/images"

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: docker is not available/running. On macOS, install+start Colima first:" >&2
  echo "  brew install colima docker" >&2
  echo "  colima start --cpu 4 --memory 8 --disk 60" >&2
  exit 1
fi

echo "Building the Buildroot build-environment image ($IMAGE_TAG) ..."
docker build -t "$IMAGE_TAG" "$SCRIPT_DIR/docker"

# BUILDROOT_DIR lives inside a named Docker volume (not a host bind mount) so
# the toolchain Buildroot builds from source persists across runs without
# fighting host/container filesystem-permission or symlink differences.
# BUILDROOT_TAG is baked into a marker file inside the volume so a stale
# checkout (wrong pinned tag) is detected and re-cloned automatically, mirroring
# the plan's host-native script's WARNING-and-continue behavior but safely
# automated since this volume is exclusively managed by this script.
# Named volumes are created root-owned by Docker; fix that up once so the
# unprivileged --user below can write into them.
docker run --rm \
  -v "$BUILDROOT_VOLUME":/buildroot-src \
  -v "$BUILD_OUTPUT_VOLUME":/build-output \
  "$IMAGE_TAG" \
  chown "$(id -u):$(id -g)" /buildroot-src /build-output

docker run --rm \
  -e HOME=/tmp/home \
  -e BUILDROOT_TAG="$BUILDROOT_TAG" \
  -v "$SCRIPT_DIR":/kiosk-linux \
  -v "$BUILDROOT_VOLUME":/buildroot-src \
  -v "$BUILD_OUTPUT_VOLUME":/build-output \
  -w /kiosk-linux \
  --user "$(id -u):$(id -g)" \
  "$IMAGE_TAG" \
  bash -c '
    set -euo pipefail
    mkdir -p "$HOME"
    BUILDROOT_DIR=/buildroot-src/buildroot
    TAG_MARKER="/buildroot-src/.tag"

    if [ ! -d "$BUILDROOT_DIR/.git" ]; then
      echo "Cloning Buildroot $BUILDROOT_TAG to $BUILDROOT_DIR ..."
      git clone --branch "$BUILDROOT_TAG" --depth 1 https://github.com/buildroot/buildroot.git "$BUILDROOT_DIR"
      echo "$BUILDROOT_TAG" > "$TAG_MARKER"
    elif [ ! -f "$TAG_MARKER" ] || [ "$(cat "$TAG_MARKER")" != "$BUILDROOT_TAG" ]; then
      echo "WARNING: existing volume checkout tag ($(cat "$TAG_MARKER" 2>/dev/null || echo unknown)) != requested BUILDROOT_TAG ($BUILDROOT_TAG)." >&2
      echo "Re-cloning a fresh pinned checkout ..." >&2
      rm -rf "$BUILDROOT_DIR"
      git clone --branch "$BUILDROOT_TAG" --depth 1 https://github.com/buildroot/buildroot.git "$BUILDROOT_DIR"
      echo "$BUILDROOT_TAG" > "$TAG_MARKER"
    else
      echo "Using existing pinned Buildroot $BUILDROOT_TAG checkout at $BUILDROOT_DIR"
    fi

    echo "Applying defconfig ..."
    make -C "$BUILDROOT_DIR" O=/build-output BR2_DEFCONFIG=/kiosk-linux/configs/qemu_x86_64_kiosk_defconfig defconfig

    echo "Building (this takes a while on first run) ..."
    make -C /build-output

    echo "Build complete inside the volume:"
    ls -la /build-output/images/bzImage /build-output/images/rootfs.cpio.gz

    echo "Copying final images out to the host-visible output/ directory ..."
    mkdir -p /kiosk-linux/output/images
    cp /build-output/images/bzImage /build-output/images/rootfs.cpio.gz /kiosk-linux/output/images/
  '

ls -la "$OUTPUT_DIR/images/bzImage" "$OUTPUT_DIR/images/rootfs.cpio.gz" 2>/dev/null || {
  echo "ERROR: expected output images not found in $OUTPUT_DIR/images/ — build likely failed partway; check the make output above." >&2
  exit 1
}
