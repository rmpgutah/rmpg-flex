#!/usr/bin/env bash
# kiosk-linux/build.sh
# Fetches a pinned Buildroot release and builds the kiosk-linux defconfig,
# producing kiosk-linux/output/images/{bzImage,rootfs.cpio.gz}.
#
# Buildroot version pinned for reproducibility (see uefi-bootsplash/build-gnuefi-pe.sh
# for the same rationale applied to gnu-efi). The Buildroot source checkout and the O=
# build-output tree both live inside named Docker volumes (BUILDROOT_VOLUME,
# BUILD_OUTPUT_VOLUME below) rather than a host path — override those variables on the
# command line if a machine needs a different volume name (e.g. running two independent
# builds side by side):
#   BUILDROOT_VOLUME=my-other-src BUILD_OUTPUT_VOLUME=my-other-output ./build.sh
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
#
# --- Windows host note (WSL2) ---
# This script is unmodified-portable to a WSL2 shell (bash + the `docker` CLI
# is all it needs) and does NOT need Colima — WSL2 already runs a real Linux
# kernel, so either Docker Desktop's WSL2 backend (Settings > Resources > WSL
# Integration, enabled for your distro) or `docker-ce` installed directly
# inside the WSL2 distro gives a working `docker info` with no VM workaround.
# The named-Docker-volume requirement still applies for the same reason as on
# macOS: WSL2's own bind-mount into Windows drives (`/mnt/c/...`) goes through
# a comparable cross-filesystem translation (Plan 9 protocol) and is not a
# substitute for a real Linux volume — always run this script from a path
# inside the WSL2 filesystem itself (e.g. `~/kiosk-linux`, NOT
# `/mnt/c/Users/.../kiosk-linux`), and let BUILDROOT_VOLUME/BUILD_OUTPUT_VOLUME
# stay Docker-managed named volumes as below.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILDROOT_TAG="${BUILDROOT_TAG:-2024.02.9}"
OUTPUT_DIR="$SCRIPT_DIR/output"
IMAGE_TAG="kiosk-linux-buildroot:latest"
BUILDROOT_VOLUME="${BUILDROOT_VOLUME:-kiosk-linux-buildroot-src}"
BUILD_OUTPUT_VOLUME="${BUILD_OUTPUT_VOLUME:-kiosk-linux-build-output}"

# Some WSL2 kernels (observed on an aarch64/Windows-on-ARM host, 2026-07-23)
# ship with no bridge/netfilter kernel modules at all — dockerd then can't
# create its default docker0 bridge network ("no such device"), which the
# daemon-level fix is to run with iptables/bridge networking disabled
# entirely (/etc/docker/daemon.json: {"iptables": false, "bridge": "none"}).
# With no bridge, containers get no network unless they share the host's
# network namespace directly. This is opt-in (empty by default) rather than
# always-on: macOS/Colima's bridge networking already works fine, and forcing
# --network host there is unnecessary. Set KIOSK_LINUX_DOCKER_NETWORK=host
# on a host where dockerd has no working bridge network.
DOCKER_NETWORK_ARGS=()
if [ -n "${KIOSK_LINUX_DOCKER_NETWORK:-}" ]; then
  DOCKER_NETWORK_ARGS=(--network "$KIOSK_LINUX_DOCKER_NETWORK")
fi

mkdir -p "$OUTPUT_DIR/images"

# --- Build-VM sizing (read this before a "mysterious" compiler crash) ---
# The desktop build compiles WebKitGTK, which is one of the most
# memory-hungry C++ builds in common use. An 8 GiB Colima VM was NOT enough:
# the build ran for ~40 minutes and then died with
#   "x86_64-buildroot-linux-gnu-g++.br_real: fatal error: Killed signal
#    terminated program cc1plus"
# That is the Linux OOM killer, not a code error — nothing in the log points
# at memory, so it reads like a compiler bug. Give the VM at least 16 GiB
# (24 GiB used here) and as many cores as the host can spare:
#   colima stop && colima start --cpu 10 --memory 24 --disk 60
# Resizing preserves the named volumes, so no build cache is lost.
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: docker is not available/running." >&2
  echo "  On macOS: install+start Colima —" >&2
  echo "    brew install colima docker && colima start --cpu 10 --memory 24 --disk 60" >&2
  echo "  On Windows/WSL2: enable Docker Desktop's WSL Integration for your distro" >&2
  echo "    (Settings > Resources > WSL Integration), or install docker-ce directly" >&2
  echo "    inside the WSL2 distro — no Colima/VM workaround needed there." >&2
  exit 1
fi

# ── Concurrent-build guard (2026-07-25) ──────────────────────────────────────
#
# BUILDROOT_VOLUME and BUILD_OUTPUT_VOLUME default to FIXED names, and this repo
# is worked on through many git worktrees at once. Two worktrees running
# build.sh therefore share one Buildroot source tree and one output tree by
# default — a warning that was already in this file, but only as prose.
#
# What that actually does was measured on 2026-07-25, when a build in the
# warrant-tab worktree overlapped one here:
#
#   - target/ ended up holding the OTHER worktree overlay, so the image carried
#     the wrong /etc/rmpg-os-version
#   - gzip compressed images/rootfs.cpio while the other build was still writing
#     it, emitting only "file size changed while zipping" and producing a
#     rootfs.cpio.gz that decompressed to 218 MB of a 651 MB archive: 1329 of
#     11063 entries, ending mid usr/lib
#
# That last one is the dangerous one. A truncated initramfs is a valid gzip file
# of the right general size that passes `gzip -t`, so nothing downstream notices
# — it just panics at boot, on a terminal in a vehicle, after an OTA update.
#
# A running build is exactly a running container holding the volume, so ask
# Docker rather than maintaining a lock file with its own staleness problems.
CONCURRENT="$(docker ps --filter volume="$BUILD_OUTPUT_VOLUME" --format '{{.ID}} {{.Image}}' 2>/dev/null || true)"
if [ -n "$CONCURRENT" ]; then
  echo "ERROR: another container is already using the build-output volume '$BUILD_OUTPUT_VOLUME':" >&2
  echo "$CONCURRENT" | sed 's/^/  /' >&2
  cat >&2 <<'CONCURRENTHELP'

Two builds sharing one output volume corrupt each other. The damage is quiet:
the losing build can emit a TRUNCATED rootfs.cpio.gz that still passes gzip -t
and only fails as a kernel panic at boot.

Either wait for that build to finish, or give this one its own volumes:

  BUILDROOT_VOLUME=kiosk-src-$(basename "$PWD") \
  BUILD_OUTPUT_VOLUME=kiosk-out-$(basename "$PWD") ./build.sh

Note a fresh output volume means a full from-scratch build (WebKitGTK alone is
roughly an hour), so waiting is usually the cheaper option.
CONCURRENTHELP
  exit 1
fi

echo "Building the Buildroot build-environment image ($IMAGE_TAG) ..."
docker build ${DOCKER_NETWORK_ARGS[@]+"${DOCKER_NETWORK_ARGS[@]}"} -t "$IMAGE_TAG" "$SCRIPT_DIR/docker"

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
  ${DOCKER_NETWORK_ARGS[@]+"${DOCKER_NETWORK_ARGS[@]}"} \
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

    # Sub-project 3 (browser) fix: the real crash mechanism, found via
    # register-level inspection of the faulting instruction (movzbl through
    # a non-canonical garbage pointer, not an out-of-bounds index — the
    # earlier 0002 dimension-clamp patch on cog own side did not address
    # this and the crash was unchanged). Traced to libwayland own
    # wl_shm_buffer_get_data() (src/wayland-shm.c): when a wl_shm_pool
    # resize is deferred (an external reference, e.g. from Cog, is still
    # held), this function already detects the exact unsafe condition and
    # LOGS a warning ("has an external reference and a deferred resize
    # pending") — the literal message observed before every single crash —
    # but then returns a pointer computed against the buffer own
    # already-updated offset into the pool current, not-yet-grown mapping
    # anyway, instead of signalling the caller. Patched to return NULL in
    # that exact branch instead, so callers can detect and drop the frame.
    WAYLAND_MK="$BUILDROOT_DIR/package/wayland/wayland.mk"
    WAYLAND_PATCH_DIR="$BUILDROOT_DIR/package/wayland"
    WAYLAND_PATCH_FILE="$WAYLAND_PATCH_DIR/0001-shm-return-null-on-deferred-resize.patch"
    if [ ! -f "$WAYLAND_PATCH_FILE" ]; then
      echo "Writing $WAYLAND_PATCH_FILE (real fix for the wl_shm_buffer_get_data stale-pointer race) ..."
      cat > "$WAYLAND_PATCH_FILE" <<'WAYLANDPATCH'
Fix a real, reproducible SIGSEGV in a downstream consumer (Cog own DRM
platform SHM buffer handling), root-caused via register-level inspection
of the faulting instruction to a non-canonical garbage pointer read
through the value wl_shm_buffer_get_data() returns. This function already
detects the exact unsafe condition (an external reference holding a
deferred pool resize open) and logs a warning about it, but then still
returns a pointer computed against the pool current, not-yet-grown
mapping using the buffer own already-updated offset -- unsafe to
dereference. Returning NULL in that branch lets callers detect and drop
the frame instead of reading through a stale/invalid pointer.

--- a/src/wayland-shm.c
+++ b/src/wayland-shm.c
@@ -457,10 +457,12 @@
 wl_shm_buffer_get_data(struct wl_shm_buffer *buffer)
 {
 	if (buffer->pool->external_refcount &&
-	    (buffer->pool->size != buffer->pool->new_size))
+	    (buffer->pool->size != buffer->pool->new_size)) {
 		wl_log("Buffer address requested when its parent pool "
 		       "has an external reference and a deferred resize "
 		       "pending.\n");
+		return NULL;
+	}
 	return buffer->pool->data + buffer->offset;
 }
WAYLANDPATCH
      grep -q "return NULL" "$WAYLAND_PATCH_FILE" || {
        echo "ERROR: wayland patch failed to write correctly." >&2
        exit 1
      }
    else
      echo "wayland SHM null-return patch already written."
    fi

    # Sub-project 3 (browser) fix: real segfault (SIGSEGV, si_addr=NULL) hit
    # in cog own DRM platform module, confirmed with a full gdb backtrace
    # (frame in libcogplatform-drm.so via wl_event_loop_dispatch). Read the
    # actual source (platform/drm/cog-drm-modeset-renderer.c,
    # on_export_shm_buffer()) and found the real root cause:
    # wpe_fdo_shm_exported_buffer_get_shm_buffer() is used with NO null
    # check, and passed straight into drm_copy_shm_buffer_into_bo() /
    # drm_create_buffer_for_shm_buffer(), which immediately dereference it
    # (e.g. wl_shm_buffer_get_format()). libwayland own wayland-shm.c can
    # legitimately return NULL here ("parent pool has an external reference
    # and a deferred resize pending" — confirmed as the exact warning
    # observed right before every crash). Confirmed via `git diff 0.19.1
    # HEAD` against the real Igalia/cog upstream repository that this bug
    # is UNFIXED even at current HEAD — not something a newer version
    # bump would resolve. Buildroot auto-applies any *.patch file placed in
    # a package own directory to its extracted source before building, so
    # this writes one directly rather than trying to sed-patch already-
    # extracted source (which a "make cog-dirclean" would just discard).
    COG_PATCH_DIR="$BUILDROOT_DIR/package/cog"
    COG_PATCH_FILE="$COG_PATCH_DIR/0001-drm-modeset-null-check-shm-buffer.patch"
    if [ ! -f "$COG_PATCH_FILE" ]; then
      echo "Writing $COG_PATCH_FILE (null-check fix for the real on_export_shm_buffer segfault) ..."
      cat > "$COG_PATCH_FILE" <<'COGPATCH'
Fix a real, reproducible SIGSEGV (confirmed via gdb backtrace) in
on_export_shm_buffer(): wpe_fdo_shm_exported_buffer_get_shm_buffer() can
legitimately return NULL when libwayland own wl_shm_pool has "an external
reference and a deferred resize pending" (a real, observed warning from
wayland-shm.c), and the result was used with no null check at all,
immediately dereferenced by wl_shm_buffer_get_format(). Confirmed unfixed
in the real upstream Igalia/cog repository even at current HEAD.

--- a/platform/drm/cog-drm-modeset-renderer.c
+++ b/platform/drm/cog-drm-modeset-renderer.c
@@ -529,6 +529,12 @@ on_export_shm_buffer(void *data, struct wpe_fdo_shm_exported_buffer *exported_b
     struct wl_resource   *exported_resource = wpe_fdo_shm_exported_buffer_get_resource(exported_buffer);
     struct wl_shm_buffer *exported_shm_buffer = wpe_fdo_shm_exported_buffer_get_shm_buffer(exported_buffer);

+    if (!exported_shm_buffer) {
+        g_warning("on_export_shm_buffer: shm buffer unavailable (pool busy or resize pending), dropping frame");
+        wpe_view_backend_exportable_fdo_dispatch_release_shm_exported_buffer(self->exportable, exported_buffer);
+        return;
+    }
+
     struct buffer_object *buffer = drm_buffer_for_resource(self, exported_resource);
     if (buffer) {
         drm_copy_shm_buffer_into_bo(exported_shm_buffer, buffer->bo);
COGPATCH
    else
      echo "cog SHM null-check patch already written."
    fi

    # The 0001 patch above was a defensive check, but a real gdb backtrace
    # against an UNSTRIPPED build of libcogplatform-drm.so (BR2_STRIP_EXCLUDE_FILES,
    # confirmed working after two real format mistakes — a leading slash and
    # a full path both failed silently since findfileclauses only matches a
    # bare basename via find -name) pinpointed the actual crash to
    # drm_copy_shm_buffer_into_bo() itself. Reading that function: it maps
    # the gbm_bo using the SHM buffer own (possibly stale, mid-resize)
    # width/height, then copies that many pixels into the mapped region with
    # NO clamping against the bo own actual dimensions — an out-of-bounds
    # write exactly when a resize is "deferred" (the shm buffer already
    # reports new, larger dimensions the target bo was never reallocated
    # for). Clamping both the map call and the copy loop to the SMALLER of
    # the two dimensions is a safe, standard defensive fix for this class of
    # buffer-pool resize race.
    COG_PATCH_FILE2="$COG_PATCH_DIR/0002-drm-modeset-clamp-shm-copy-dimensions.patch"
    if [ ! -f "$COG_PATCH_FILE2" ]; then
      echo "Writing $COG_PATCH_FILE2 (clamp shm-to-bo copy dimensions, real fix for the drm_copy_shm_buffer_into_bo segfault) ..."
      cat > "$COG_PATCH_FILE2" <<'COGPATCH2'
Fix a real, reproducible SIGSEGV (confirmed via an unstripped-build gdb
backtrace pinpointing drm_copy_shm_buffer_into_bo itself) that happens
when a wl_shm_pool resize is deferred: the SHM buffer already reports its
new, larger width/height, but the target gbm_bo was never reallocated for
it. The existing code used the SHM buffer own width/height unclamped, for
both the gbm_bo_map() call and the pixel-copy loop bounds, writing past
the actual mapped region. Clamping to the smaller of the SHM buffer and bo
dimensions is a safe, standard defensive fix for this exact buffer-pool
resize race.

--- a/platform/drm/cog-drm-modeset-renderer.c
+++ b/platform/drm/cog-drm-modeset-renderer.c
@@ -287,9 +287,14 @@
     int32_t height = wl_shm_buffer_get_height(shm_buffer);
     int32_t stride = wl_shm_buffer_get_stride(shm_buffer);

+    uint32_t bo_width = gbm_bo_get_width(bo);
+    uint32_t bo_height = gbm_bo_get_height(bo);
+    uint32_t copy_width = (uint32_t) width < bo_width ? (uint32_t) width : bo_width;
+    uint32_t copy_height = (uint32_t) height < bo_height ? (uint32_t) height : bo_height;
+
     uint32_t bo_stride = 0;
     void    *map_data = NULL;
-    gbm_bo_map(bo, 0, 0, width, height, GBM_BO_TRANSFER_WRITE, &bo_stride, &map_data);
+    gbm_bo_map(bo, 0, 0, copy_width, copy_height, GBM_BO_TRANSFER_WRITE, &bo_stride, &map_data);
     if (!map_data)
         return;

@@ -298,11 +303,9 @@
     uint8_t *src = wl_shm_buffer_get_data(shm_buffer);
     uint8_t *dst = map_data;

-    uint32_t bo_width = gbm_bo_get_width(bo);
-    uint32_t bo_height = gbm_bo_get_height(bo);
-    if (!(width == bo_width && height == bo_height && stride == bo_stride)) {
-        for (uint32_t y = 0; y < height; ++y) {
-            for (uint32_t x = 0; x < width; ++x) {
+    if (!((uint32_t) width == bo_width && (uint32_t) height == bo_height && (uint32_t) stride == bo_stride)) {
+        for (uint32_t y = 0; y < copy_height; ++y) {
+            for (uint32_t x = 0; x < copy_width; ++x) {
                 dst[bo_stride * y + 4 * x + 0] = src[stride * y + 4 * x + 0];
                 dst[bo_stride * y + 4 * x + 1] = src[stride * y + 4 * x + 1];
                 dst[bo_stride * y + 4 * x + 2] = src[stride * y + 4 * x + 2];
@@ -310,7 +313,7 @@
             }
         }
     } else
-        memcpy(dst, src, stride * height);
+        memcpy(dst, src, stride * copy_height);

     wl_shm_buffer_end_access(shm_buffer);
     gbm_bo_unmap(bo, map_data);
COGPATCH2
      grep -q "copy_width" "$COG_PATCH_FILE2" || {
        echo "ERROR: cog SHM clamp patch failed to write correctly." >&2
        exit 1
      }
    else
      echo "cog SHM clamp patch already written."
    fi

    # 0003: pairs with the libwayland patch above (0001-shm-return-null-on-
    # deferred-resize.patch) — that patch makes wl_shm_buffer_get_data()
    # return NULL instead of a stale pointer when a resize is deferred;
    # this patch makes the caller here actually check for that NULL and
    # drop the frame instead of dereferencing it, which is what the real
    # register-level crash (a movzbl through a non-canonical pointer) traced
    # back to.
    COG_PATCH_FILE3="$COG_PATCH_DIR/0003-drm-modeset-check-shm-data-null.patch"
    if [ ! -f "$COG_PATCH_FILE3" ]; then
      echo "Writing $COG_PATCH_FILE3 (check wl_shm_buffer_get_data for NULL, drop the frame instead of crashing) ..."
      cat > "$COG_PATCH_FILE3" <<'COGPATCH3'
Pairs with the libwayland patch (package/wayland/0001-shm-return-null-on-
deferred-resize.patch) that makes wl_shm_buffer_get_data() return NULL
instead of a stale pointer when a resize is deferred. This patch makes
the caller here actually check for that NULL and drop the frame instead
of dereferencing it — the real root cause of a reproducible SIGSEGV,
confirmed via register-level inspection of the faulting instruction (a
movzbl reading through a non-canonical garbage pointer).

--- a/platform/drm/cog-drm-modeset-renderer.c
+++ b/platform/drm/cog-drm-modeset-renderer.c
@@ -303,6 +303,15 @@
     uint8_t *src = wl_shm_buffer_get_data(shm_buffer);
     uint8_t *dst = map_data;

+    if (!src) {
+        /* libwayland detected a deferred pool resize with an external
+         * reference held and refused to hand back a pointer into the
+         * not-yet-grown mapping -- drop this frame instead of crashing. */
+        wl_shm_buffer_end_access(shm_buffer);
+        gbm_bo_unmap(bo, map_data);
+        return;
+    }
+
     if (!((uint32_t) width == bo_width && (uint32_t) height == bo_height && (uint32_t) stride == bo_stride)) {
         for (uint32_t y = 0; y < copy_height; ++y) {
             for (uint32_t x = 0; x < copy_width; ++x) {
COGPATCH3
      grep -q "if (!src)" "$COG_PATCH_FILE3" || {
        echo "ERROR: cog SHM null-data-check patch failed to write correctly." >&2
        exit 1
      }
    else
      echo "cog SHM null-data-check patch already written."
    fi

    # 0004: the real fix for the blank-screen problem (the crash-fix patches
    # above stopped the SIGSEGV, but confirmed via gdb breakpoints that
    # drm_commit_buffer was then NEVER reached at all — every single frame
    # was hitting the deferred-resize-pending drop path, not just
    # occasionally). Root cause, found by reading on_export_shm_buffer own
    # buffer-reuse fast path: it overwrites buffer->export.shm_buffer with
    # the newly exported buffer WITHOUT releasing the PREVIOUS one first —
    # a real reference leak that keeps the wl_shm_pool external reference
    # held forever after the first couple of frames, permanently blocking
    # its resize and permanently tripping the deferred-resize condition for
    # every later frame.
    COG_PATCH_FILE4="$COG_PATCH_DIR/0004-drm-modeset-release-previous-shm-export.patch"
    if [ ! -f "$COG_PATCH_FILE4" ]; then
      echo "Writing $COG_PATCH_FILE4 (release the previous shm export before overwriting it, the real fix for frames never committing) ..."
      cat > "$COG_PATCH_FILE4" <<'COGPATCH4'
Real fix for the blank-screen problem: the crash-fix patches (0001-0003)
correctly stopped the SIGSEGV, but confirmed via gdb breakpoints that
drm_commit_buffer was then never reached at all afterward — the deferred-
resize-pending condition was tripping on every single frame, not
occasionally. Root cause: on_export_shm_buffer own buffer-reuse fast path
overwrites buffer->export.shm_buffer with the newly exported buffer
without releasing the PREVIOUS one first, leaking a reference that keeps
the wl_shm_pool external reference held forever after the first couple of
frames, permanently blocking its resize.

--- a/platform/drm/cog-drm-modeset-renderer.c
+++ b/platform/drm/cog-drm-modeset-renderer.c
@@ -552,6 +552,16 @@
     if (buffer) {
         drm_copy_shm_buffer_into_bo(exported_shm_buffer, buffer->bo);

+        if (buffer->export.shm_buffer && buffer->export.shm_buffer != exported_buffer) {
+            /* Release the PREVIOUS export before overwriting it with the new
+             * one -- otherwise its external reference on the wl_shm_pool is
+             * never released, permanently blocking any pending pool resize
+             * (confirmed via gdb: the pool never grows past its first
+             * couple of frames, and drm_commit_buffer is silently never
+             * reached again once this happens). */
+            wpe_view_backend_exportable_fdo_dispatch_release_shm_exported_buffer(self->exportable,
+                                                                                  buffer->export.shm_buffer);
+        }
         buffer->export.shm_buffer = exported_buffer;
         drm_commit_buffer(self, buffer);
         return;
COGPATCH4
      grep -q "Release the PREVIOUS export" "$COG_PATCH_FILE4" || {
        echo "ERROR: cog SHM release-previous-export patch failed to write correctly." >&2
        exit 1
      }
    else
      echo "cog SHM release-previous-export patch already written."
    fi

    # 0005 (2026-07-24): the DEEPEST root cause in this whole family of SHM
    # crashes, found once glib-networking finally let real page content
    # render (every earlier patch was validated only against blank pages,
    # which never destroy buffers): cog own modeset renderer calls
    # wl_resource_set_user_data(buffer_resource, self) on the wl_shm
    # buffer resource — but that user_data slot is OWNED BY LIBWAYLAND own
    # wayland-shm.c, which stores its own struct wl_shm_buffer* there.
    # wl_shm_buffer_get() and destroy_buffer() both read it back. Cog own
    # hijack means (a) any later wl_shm_buffer_get() on that resource
    # returns the renderer pointer as if it were a wl_shm_buffer (the
    # original garbage-pointer SIGSEGV family), and (b) when the web
    # process destroys a buffer, cog own destroy listener runs first, nulls
    # user_data, and libwayland own own destroy_buffer then dereferences
    # NULL->pool (offset 0x20) — a 100%-reproducible segfault at address
    # 0x20 in libwayland-server.so observed the moment real page content
    # started flowing (real pages resize and destroy buffers; blank pages
    # never did). Fix: keep the renderer pointer in cog own own
    # buffer_object (found via wl_container_of from the destroy listener)
    # and leave the resource own user_data alone entirely.
    # NOTE: the two create functions end in IDENTICAL 5-line blocks; the
    # second hunk below deliberately carries extra UNIQUE context lines
    # (the g_strerror error path) because GNU patch -t (as invoked by
    # Buildroot) silently SKIPPED an identical-context second hunk as
    # "already applied" once the first hunk had landed — observed for real:
    # the shm-buffer create path kept the user_data hijack and crashed with
    # renderer==NULL in the destroy listener.
    COG_PATCH_FILE5="$COG_PATCH_DIR/0005-drm-modeset-dont-hijack-shm-resource-user-data.patch"
    if [ ! -f "$COG_PATCH_FILE5" ]; then
      echo "Writing $COG_PATCH_FILE5 (stop clobbering libwayland own wl_shm buffer resource user_data) ..."
      cat > "$COG_PATCH_FILE5" <<'COGPATCH5'
Stop hijacking the wl_shm buffer resource own user_data slot. That slot is
owned by libwayland own wayland-shm.c (it stores its struct wl_shm_buffer*
there; wl_shm_buffer_get() and its internal destroy_buffer() both read it
back). Overwriting it with the renderer pointer meant later
wl_shm_buffer_get() calls returned a non-wl_shm_buffer pointer, and — once
real page content caused the web process to destroy buffers — libwayland own
destroy_buffer() dereferenced the NULL this module had written into
user_data from its own destroy listener, a 100%-reproducible segfault at
address 0x20 inside libwayland-server.so. Keep the renderer pointer in the
module own own buffer_object instead, reachable via wl_container_of from the
destroy listener.

--- a/platform/drm/cog-drm-modeset-renderer.c
+++ b/platform/drm/cog-drm-modeset-renderer.c
@@ -70,6 +70,8 @@
 struct buffer_object {
     struct wl_list     link;
     struct wl_listener destroy_listener;
+    /* Owning renderer; the typedef is declared later in this file. */
+    void *renderer;

     uint32_t            fb_id;
     struct gbm_bo      *bo;
@@ -137,7 +139,7 @@
 destroy_buffer_notify(struct wl_listener *listener, void *data)
 {
     struct buffer_object  *buffer = wl_container_of(listener, buffer, destroy_listener);
-    CogDrmModesetRenderer *renderer = wl_resource_get_user_data(buffer->buffer_resource);
+    CogDrmModesetRenderer *renderer = buffer->renderer;

     if (renderer->committed_buffer == buffer)
         renderer->committed_buffer = NULL;
@@ -145,7 +147,6 @@

     wl_list_remove(&buffer->link);

-    wl_resource_set_user_data(buffer->buffer_resource, NULL);
     destroy_buffer(renderer, buffer);
 }

@@ -218,7 +219,7 @@
     struct buffer_object *buffer = g_new0(struct buffer_object, 1);
     wl_list_insert(&self->buffer_list, &buffer->link);
     buffer->destroy_listener.notify = destroy_buffer_notify;
     wl_resource_add_destroy_listener(buffer_resource, &buffer->destroy_listener);
-    wl_resource_set_user_data(buffer_resource, self);
+    buffer->renderer = self;

     buffer->fb_id = fb_id;
     buffer->bo = bo;
@@ -267,15 +268,15 @@
     uint32_t fb_id = 0;
     int ret = drmModeAddFB2(get_drm_fd(self), width, height, gbm_format, in_handles, in_strides, in_offsets, &fb_id, 0);
     if (ret) {
         gbm_bo_destroy(bo);
         g_warning("failed to create framebuffer: %s", g_strerror(errno));
         return NULL;
     }

     struct buffer_object *buffer = g_new0(struct buffer_object, 1);
     wl_list_insert(&self->buffer_list, &buffer->link);
     buffer->destroy_listener.notify = destroy_buffer_notify;
     wl_resource_add_destroy_listener(buffer_resource, &buffer->destroy_listener);
-    wl_resource_set_user_data(buffer_resource, self);
+    buffer->renderer = self;

     buffer->fb_id = fb_id;
     buffer->bo = bo;
COGPATCH5
      grep -q "buffer->renderer = self" "$COG_PATCH_FILE5" || {
        echo "ERROR: cog user-data-hijack patch failed to write correctly." >&2
        exit 1
      }
      # Patches only auto-apply on a fresh extract — force cog to re-extract
      # and rebuild so an incremental run picks 0005 up.
      touch /buildroot-src/.cog-needs-dirclean 2>/dev/null || true
    else
      echo "cog user-data-hijack patch already written."
    fi

    # Debugging aid attempted and reverted: tried overriding cog own meson
    # buildtype to get DWARF debug info for gdb struct/variable printing.
    # Meson rejects a duplicate -Dbuildtype (Buildroot own generic
    # meson-package infra already passes --buildtype=release, confirmed by
    # a real failed configure: "Got argument buildtype as both -Dbuildtype
    # and --buildtype. Pick one."), and the actual debug-info disable
    # (-g0) is baked into Buildroot own shared cross-compilation.conf via
    # the global BR2_ENABLE_DEBUG setting — enabling that would invalidate
    # every already-built package cache (including WebKit own ~90 minute
    # build). Not worth that cost; using register/disassembly-level gdb
    # inspection instead (same technique already used successfully for the
    # original crash), which needs only the symbol table already kept via
    # BR2_STRIP_EXCLUDE_FILES, not full DWARF info.

    # Sub-project 3 (browser) fix: confirmed via a real run with verbose EGL
    # debug output (EGL_LOG_LEVEL=debug) that WPEWebProcess legitimately
    # fails to eglInitialize because libEGL picks "wayland" as its
    # EGL_DEFAULT_DISPLAY native platform, and no real Wayland compositor
    # exists in this image. An earlier attempt patched MESA3D_PLATFORMS
    # (the meson -Dplatforms= windowing-backend list) to add "drm" — WRONG
    # variable: Mesa 24.0.9 meson.build rejects "drm" there outright
    # (Options drm are not in allowed choices: auto, x11, wayland,
    # haiku, android, windows, confirmed by a real failed configure). The
    # actual option controlling EGL_DEFAULT_DISPLAY is the SEPARATE
    # `-Degl-native-platform=` meson option (meson_options.txt, choices:
    # auto/x11/wayland/haiku/android/windows/surfaceless/drm) — Buildroot
    # mesa3d.mk has no Kconfig-driven way to set it, so this appends it
    # directly here, right after the existing -Dplatforms= line (the one
    # unique, unambiguous anchor in this file — MESA3D_CONF_OPTS itself
    # appears many times throughout mesa3d.mk for unrelated options).
    # REVERTED: tried forcing WPEWebKit own CMAKE_BUILD_TYPE=Debug
    # explicitly on the command line (BR2_ENABLE_RUNTIME_DEBUG alone was
    # not enough — two rebuilds still showed Release in CMakeCache.txt).
    # The explicit override DID take effect (confirmed: "-- The CMake
    # build type is: Debug" in a real configure log) but the resulting
    # build failed to LINK at 99.9% completion ("undefined reference to
    # JSC::UnlinkedMetadataTable::~UnlinkedMetadataTable()") — a genuine
    # structural incompatibility between this WebKit version and Debug
    # mode under this Buildroot toolchain, not a quick patch. If
    # reattempting this investigation, the checked-out
    # package/wpewebkit/wpewebkit.mk in the Buildroot volume must also be
    # manually reverted (removing the appended
    # "WPEWEBKIT_CONF_OPTS += -DCMAKE_BUILD_TYPE=Debug" line) since this
    # script only writes patches once — an already-broken checkout is not
    # automatically fixed by removing this code block alone.

    MESA3D_MK="$BUILDROOT_DIR/package/mesa3d/mesa3d.mk"
    if ! grep -q "egl-native-platform=drm" "$MESA3D_MK"; then
      echo "Patching $MESA3D_MK to force the drm EGL native platform ..."
      # Appended as a brand-new, fully self-contained line at the end of the
      # file ($a = append after the last line) rather than inserted into the
      # middle of the existing -Dplatforms= block — Make does not care where
      # a "VAR += ..." append happens, and this sidesteps needing to
      # correctly re-escape that block own line-continuation backslash.
      sed -i "\$a MESA3D_CONF_OPTS += -Degl-native-platform=drm" "$MESA3D_MK"
      grep -q "egl-native-platform=drm" "$MESA3D_MK" || {
        echo "ERROR: mesa3d.mk patch failed to apply — check the sed pattern against the real file." >&2
        exit 1
      }
    else
      echo "mesa3d.mk already patched to force the drm EGL native platform."
    fi

    # Sub-project 3 (browser) fix: a real run got past every earlier bug
    # (kernel panic, crtc/fbdev, GBM/Mesa software fallback, fbcon unbind,
    # zink/EGL native platform, missing fonts) and the real page genuinely
    # loaded — but cog itself then segfaulted (SIGSEGV, si_addr=NULL) inside
    # libwayland-server SHM buffer-pool handling, right after a "parent pool
    # has an external reference and a deferred resize pending" warning.
    # Checked libwayland own history for a relevant fix — none applicable
    # (the one segfault-related shm fix found was already in our pinned
    # 1.22.0). Checked cog own history instead: many buffer/surface-resize
    # fixes exist between the pinned 0.18.4 and the newer 0.19.1 release
    # (e.g. "Ensure surface is not configured with zero sizes", "Force a
    # View resize on the output changed", "Fix the validation of the
    # exported image in outputs with scale factor") — a strong match for
    # this exact bug class. Confirmed 0.19.1 only requires WPEWebKit
    # >=2.39.91 for its wpe_api=2.0 target (our pinned WPEWebKit is 2.44.4,
    # comfortably newer) before committing to this bump. Real tarball hash
    # verified directly against wpewebkit.org (Buildroot own COG_SITE).
    COG_MK="$BUILDROOT_DIR/package/cog/cog.mk"
    COG_HASH="$BUILDROOT_DIR/package/cog/cog.hash"
    if ! grep -q "COG_VERSION = 0.19.1" "$COG_MK"; then
      echo "Patching $COG_MK to bump cog 0.18.4 to 0.19.1 (real buffer/resize fixes) ..."
      sed -i "s/COG_VERSION = 0.18.4/COG_VERSION = 0.19.1/" "$COG_MK"
      cat > "$COG_HASH" <<'COGHASH'
# Verified directly against https://wpewebkit.org/releases/cog-0.19.1.tar.xz.sums
sha256  633760ba69e36e4fbc24757c927f46fa1fdb3c526d0a6ac6ab35a21d35ad57b3  cog-0.19.1.tar.xz

# Hashes for license files:
sha256  e6c42d93c68b292bcccf6d2ec3e13da85df90b718ba27c2c2a01053a9d009252  COPYING
COGHASH
      grep -q "COG_VERSION = 0.19.1" "$COG_MK" || {
        echo "ERROR: cog.mk version bump failed to apply — check the sed pattern against the real file." >&2
        exit 1
      }
    else
      echo "cog.mk already bumped to 0.19.1."
    fi
    # 0.19.1 introduced a new optional libportal dependency (meson feature,
    # default "enabled" — auto-detected, not gated by a Buildroot Kconfig
    # option at all), confirmed by a real failed configure
    # ("Dependency libportal not found, tried pkgconfig and cmake"). This
    # project has no libportal package and does not need file-picker dialog
    # support for a kiosk browser with no user file-open UI — disabled
    # explicitly rather than adding a whole new, unrelated package.
    if ! grep -q "Dlibportal=disabled" "$COG_MK"; then
      echo "Patching $COG_MK to disable the new libportal feature ..."
      sed -i "/-Dcog_home_uri=/a\\	-Dlibportal=disabled \\\\" "$COG_MK"
      grep -q "Dlibportal=disabled" "$COG_MK" || {
        echo "ERROR: cog.mk libportal-disable patch failed to apply — check the sed pattern against the real file." >&2
        exit 1
      }
    else
      echo "cog.mk already patched to disable libportal."
    fi

    # Post-patch enforcement for the 0005 user_data fix. The two functions
    # that create a buffer_object end in IDENTICAL 5-line blocks, and GNU
    # patch (invoked by Buildroot with -t) silently treats the second
    # occurrence as "already applied" and skips it — observed for real
    # across three rebuilds, each time leaving the shm-buffer create path
    # still hijacking libwayland own user_data slot and segfaulting the
    # moment a real page destroyed a buffer. Extra unique context in the
    # patch hunk did not reliably fix it, so this POST_PATCH hook enforces
    # the invariant directly: after patching, NO call site may still pass
    # `self` into wl_resource_set_user_data(). The build fails loudly if the
    # rewrite does not stick, rather than shipping a half-patched renderer.
    if ! grep -q "COG_POST_PATCH_HOOKS" "$COG_MK"; then
      echo "Adding the POST_PATCH user_data-fix hook to $COG_MK ..."
      cat /kiosk-linux/configs/cog-post-patch-hook.mk >> "$COG_MK"
      grep -q "COG_POST_PATCH_HOOKS" "$COG_MK" || {
        echo "ERROR: cog.mk POST_PATCH hook failed to append." >&2
        exit 1
      }
      touch /buildroot-src/.cog-needs-dirclean 2>/dev/null || true
    else
      echo "cog.mk POST_PATCH user_data hook already present."
    fi

    # First-party desktop components (rmpg-shell taskbar + rmpg-browser).
    # Buildroot can only build packages that live inside its own tree, so the
    # package definition is copied in and registered in package/Config.in. The
    # SOURCE stays in this repo at kiosk-linux/rmpg-shell and is pulled in via
    # SITE_METHOD=local, so editing the C is a plain rmpg-shell-rebuild with no
    # tarball or version bump.
    RMPG_SHELL_PKG_DIR="$BUILDROOT_DIR/package/rmpg-shell"
    mkdir -p "$RMPG_SHELL_PKG_DIR"
    cp /kiosk-linux/rmpg-shell/buildroot-package/Config.in "$RMPG_SHELL_PKG_DIR/"
    cp /kiosk-linux/rmpg-shell/buildroot-package/rmpg-shell.mk "$RMPG_SHELL_PKG_DIR/"

    if ! grep -q "package/rmpg-shell/Config.in" "$BUILDROOT_DIR/package/Config.in"; then
      echo "Registering rmpg-shell in package/Config.in ..."
      # Insert next to another package in the same menu so it appears in a
      # sensible place; appending at EOF would land outside every menu block
      # and the symbol would never become visible to Kconfig.
      sed -i "s|\tsource \"package/openbox/Config.in\"|\tsource \"package/openbox/Config.in\"\n\tsource \"package/rmpg-shell/Config.in\"|" "$BUILDROOT_DIR/package/Config.in"
      grep -q "package/rmpg-shell/Config.in" "$BUILDROOT_DIR/package/Config.in" || {
        echo "ERROR: failed to register rmpg-shell in package/Config.in" >&2
        exit 1
      }
    else
      echo "rmpg-shell already registered in package/Config.in."
    fi

    # Always force a rebuild: SITE_METHOD=local copies the source at build
    # time, and without this an edit to rmpg-shell.c would be ignored because
    # the package stamp is already present.
    rm -f /build-output/build/rmpg-shell-*/.stamp_built 2>/dev/null || true

    # The desktop fragment (X.org + Openbox + GTK3 + midori + pcmanfm) is
    # purely ADDITIVE to the kiosk defconfig — it removes nothing, so one image
    # serves both roles: it boots to a Windows-like desktop, with the original
    # fullscreen kiosk browser still installed and launchable as an app.
    # Buildroot own `defconfig` target takes a single BR2_DEFCONFIG file, so the
    # two are concatenated into one generated file rather than merged by
    # Kconfig. Set KIOSK_LINUX_DESKTOP=0 to build the lean kiosk-only image.
    GEN_DEFCONFIG=/tmp/kiosk-linux-generated-defconfig
    cat /kiosk-linux/configs/qemu_x86_64_kiosk_defconfig > "$GEN_DEFCONFIG"
    if [ "${KIOSK_LINUX_DESKTOP:-1}" != "0" ]; then
      echo "Including the desktop fragment (X.org + Openbox + GTK3 + browser) ..."
      cat /kiosk-linux/configs/desktop.fragment >> "$GEN_DEFCONFIG"
    else
      echo "KIOSK_LINUX_DESKTOP=0 — building the lean kiosk-only image."
    fi

    # AX211 (Wi-Fi 6E, Mk3) firmware gap: Buildroot own linux-firmware.mk only
    # globs "iwlwifi-so-a0-gf-a0*" for BR2_PACKAGE_LINUX_FIRMWARE_IWLWIFI_6E, but
    # real-world AX211 units request EITHER "so-a0-gf-a0" OR "ty-a0-gf-a0"
    # firmware depending on the exact host chipset combo -- confirmed both
    # exist in the pinned linux-firmware-20240115 source tarball, and confirmed
    # via real dmesg reports from Raptor Lake AX211 systems that "ty-a0" is a
    # genuinely live variant, not a hypothetical one. Missing this would
    # silently break Wi-Fi on whichever Mk3 units happen to need the variant
    # Buildroot does not glob for -- the driver loads, finds no matching
    # firmware file, and the radio simply never comes up, with nothing in the
    # boot log pointing at firmware as the cause unless someone thinks to check
    # dmesg for "Direct firmware load ... failed".
    LINUX_FW_MK="$BUILDROOT_DIR/package/linux-firmware/linux-firmware.mk"
    if ! grep -q "ty-a0-gf-a0" "$LINUX_FW_MK"; then
      echo "Patching $LINUX_FW_MK to also glob the ty-a0-gf-a0 (AX211) firmware variant ..."
      sed -i "/LINUX_FIRMWARE_FILES += iwlwifi-so-a0-gf-a0\*/a\\
LINUX_FIRMWARE_FILES += iwlwifi-ty-a0-gf-a0*.{ucode,pnvm}" "$LINUX_FW_MK"
      grep -q "ty-a0-gf-a0" "$LINUX_FW_MK" || {
        echo "ERROR: ty-a0-gf-a0 firmware patch failed to apply — check the sed pattern against the real linux-firmware.mk." >&2
        exit 1
      }
    else
      echo "linux-firmware.mk already patched for ty-a0-gf-a0."
    fi

    echo "Applying defconfig ..."
    make -C "$BUILDROOT_DIR" O=/build-output BR2_DEFCONFIG="$GEN_DEFCONFIG" defconfig

    # Verify the headline desktop symbols actually survived into .config.
    # Buildroot silently DROPS any symbol whose dependencies are unmet, with no
    # error — this project has lost packages that way before, so fail loudly
    # here instead of discovering it in a boot log an hour later.
    if [ "${KIOSK_LINUX_DESKTOP:-1}" != "0" ]; then
      for sym in BR2_PACKAGE_XSERVER_XORG_SERVER BR2_PACKAGE_OPENBOX \
                 BR2_PACKAGE_LIBGTK3 BR2_PACKAGE_LIBGTK3_X11 \
                 BR2_PACKAGE_WEBKITGTK BR2_PACKAGE_PCMANFM \
                 BR2_PACKAGE_RMPG_SHELL BR2_PACKAGE_CONNMAN \
                 BR2_PACKAGE_LINUX_FIRMWARE BR2_PACKAGE_WPA_SUPPLICANT; do
        grep -q "^${sym}=y" /build-output/.config || {
          echo "ERROR: $sym did not survive into .config — its dependencies are unmet." >&2
          grep -n "$sym" /build-output/.config >&2 || true
          exit 1
        }
      done
      echo "Desktop symbols verified present in .config."
    fi

    # Buildroot only auto-applies package patches on a fresh source extract —
    # when a patch block above just wrote a NEW patch file, force that
    # package to re-extract/rebuild so an incremental run actually picks it
    # up (flag file written by the patch-writing blocks).
    if [ -f /buildroot-src/.cog-needs-dirclean ]; then
      echo "New cog patch detected — forcing cog re-extract/rebuild ..."
      make -C /build-output cog-dirclean
      rm -f /buildroot-src/.cog-needs-dirclean
    fi

    # Packages built BEFORE the desktop fragment was introduced were configured
    # without X11 and without desktop OpenGL, and Buildroot will not reconfigure
    # them on its own because their stamp files already exist. That surfaces as
    # baffling downstream failures rather than anything pointing at the cause —
    # observed for real: libgtk3 configure died on "cairo-xlib found: NO"
    # because cairo had been built in the kiosk era when BR2_PACKAGE_XORG7 was
    # off, and pango kept emitting a .gir long after introspection was turned
    # back off. Force-reconfigure the X/GL-sensitive packages the first time a
    # desktop build runs against a kiosk-era output tree.
    DESKTOP_MARKER=/build-output/.rmpg-desktop-reconfigured
    # xserver_xorg-server MUST come after mesa3d in this list. Its modesetting
    # driver uses GBM (via glamor), but it was originally built in this tree
    # before mesa3d was rebuilt, so gbm.pc did not exist at configure time and
    # the driver was linked WITHOUT libgbm while still referencing GBM symbols.
    # X then died at every startup with "no screens found", whose real cause
    # only appeared in the guest own /var/log/Xorg.0.log:
    #   Failed to load modesetting_drv.so: undefined symbol: gbm_bo_get_plane_count
    # NOTE: entries are tracked by NAME in the marker file, so a package that must
    # be rebuilt AGAIN for a different reason needs a NEW name here. xorg-server
    # appears twice for exactly that reason: first for libgbm/glamor, then for the
    # MIT-SCREEN-SAVER extension, which Buildroot only enables when
    # xlib_libXScrnSaver exists at ITS configure time (xserver_xorg-server.mk:
    # --enable-screensaver is conditional on that package). Adding libXScrnSaver
    # later left the server without the extension, and the failure is nearly
    # invisible: the taskbar logs "idle lock armed at 600s" and then every poll
    # fails with `Xlib: extension "MIT-SCREEN-SAVER" missing`, so the terminal
    # never locks while appearing to be configured to.
    # grub2:builtin-modules — (2026-07-25) BR2_TARGET_GRUB2_BUILTIN_MODULES_EFI
    # gained search_fs_file and chain, without which the no-USB install cannot
    # locate its own volume and cannot chainload back into Windows. That variable
    # is consumed while LINKING grubx64.efi, and Buildroot will not relink it just
    # because the value changed — the package stamp already exists — so the new
    # modules would silently not be in the shipped binary. The entry name carries
    # the reason because this list is tracked BY NAME in the marker file.
    #
    # linux-firmware:fz55 — the FZ-55 hardware audit added
    # BR2_PACKAGE_LINUX_FIRMWARE_I915 (i915 DMC blobs, required for display
    # power management on Mk2/Mk3) and patched linux-firmware.mk to also glob
    # the ty-a0-gf-a0 AX211 variant. linux-firmware was already built, so
    # neither change took effect: the patch applied to the .mk but the package
    # never re-extracted, and the built image had zero i915 and zero ty-a0
    # firmware files despite both symbols being =y in .config. Verified by
    # listing target/lib/firmware rather than trusting the build exit code.
    #
    # (This entry also explains an oddity seen from the other side of the same
    # week: a build in this worktree DID come out with the 33 i915 DMC blobs
    # present, because a build in another worktree had already forced
    # linux-firmware to re-extract in the SHARED Docker volume. Same symbol, same
    # config, different outcome depending on what another checkout had done —
    # exactly the reason both this list and the post-build gates exist.)
    #
    # alsa-utils:amixer — same class. amixer is a per-command sub-option that
    # was not previously requested, so the already-built package had no reason
    # to rebuild and amixer stayed absent from the image.
    DESKTOP_STALE_PKGS="mesa3d cairo libepoxy pango libgtk3 ncurses xserver_xorg-server xserver_xorg-server:screensaver grub2:builtin-modules linux-firmware:fz55 alsa-utils:amixer"
    if [ "${KIOSK_LINUX_DESKTOP:-1}" != "0" ]; then
      # The marker is a LIST of packages already reconfigured, not a single
      # all-or-nothing flag. The first version of this was a bare touch file,
      # which meant a package discovered stale later (ncurses, found when htop
      # failed with "can not find required library libncursesw" despite
      # BR2_PACKAGE_NCURSES_WCHAR=y being set) could never be added — the
      # marker already existed, so the whole block was skipped. Tracking each
      # package individually makes adding one to the list above take effect on
      # the next build, and never re-does work that is already done.
      #
      # Seed the list from the legacy empty marker so upgrading this logic does
      # not needlessly rebuild the five packages it had already handled.
      if [ -f /build-output/.rmpg-desktop-enabled ] && [ ! -f "$DESKTOP_MARKER" ]; then
        printf "mesa3d\ncairo\nlibepoxy\npango\nlibgtk3\n" > "$DESKTOP_MARKER"
      fi
      for pkg in $DESKTOP_STALE_PKGS; do
        if ! grep -qx "$pkg" "$DESKTOP_MARKER" 2>/dev/null; then
          echo "Reconfiguring package for the desktop build: ${pkg%%:*} (${pkg#*:})"
          make -C /build-output "${pkg%%:*}-dirclean" >/dev/null 2>&1 || true
          echo "$pkg" >> "$DESKTOP_MARKER"
        fi
      done
    fi

    # ── FZ-55 kernel-symbol gate (2026-07-25) ────────────────────────────────
    # The same "silently dropped symbol" hazard the desktop check above guards
    # against exists one layer down, in the KERNEL config, and is worse there
    # because the failure only appears on real hardware:
    # scripts/kconfig/merge_config.sh applies our fragments over the expanded
    # x86_64 defconfig and, when the dependencies of a requested symbol are not
    # met,
    # it prints a warning and CARRIES ON — leaving the symbol absent from
    # .config entirely rather than "=n". Two real instances found in the
    # shipped 1.3.0 image by auditing its generated .config:
    #
    #   - CONFIG_I2C_DESIGNWARE_PLATFORM was absent, not disabled, because
    #     `depends on (ACPI && COMMON_CLK)` was unmet (COMMON_CLK unset). The
    #     FZ-55 touchscreen bus therefore had no driver, with nothing in any
    #     log pointing at the cause.
    #   - CONFIG_X86_PKG_TEMP_THERMAL was =m in an initramfs image that never
    #     loads modules, so thermal protection was inert while every grep for
    #     "is not set" reported it as enabled.
    #
    # NOTE: no apostrophes anywhere in this block. It lives inside a
    # `bash -c '...'` string, and an apostrophe surrounded by whitespace closes
    # that quote, splits the argument, and TRUNCATES the container script at
    # that point — while `bash -n` still reports the file as valid, because an
    # even number of apostrophes re-balances the quoting. That is why other
    # comments here read "the guest own log" rather than the natural phrasing.
    #
    # `linux-configure` stops after the kernel config+configure step, so this
    # asserts on the REAL generated .config for pennies of build time, before
    # the ~15 minute compile — and long before a boot log on hardware nobody
    # has in front of them. Keep this list in sync with
    # configs/kernel-fz55.fragment.
    # Force the kernel fragments to be re-merged on EVERY run.
    #
    # In theory this is unnecessary: pkg-kconfig.mk:158 declares
    # .stamp_dotconfig as depending on LINUX_KCONFIG_FRAGMENT_FILES, so editing
    # a fragment should make it stale and trigger a re-merge. In practice that
    # did NOT fire on 2026-07-25 — a run whose fragment was 16 minutes newer
    # than the stamp regenerated the stamp and still produced a .config with
    # none of the new symbols in it, and removing the stamp by hand merged them
    # correctly on the very next attempt with no other change. The fragments
    # reach the container through a Colima virtiofs bind mount, which is the
    # same layer that already broke POSIX directory permissions badly enough to
    # move this whole build into named volumes, so its timestamp semantics are
    # not something to stake a release on.
    #
    # Removing the stamp costs about two seconds: merge_config.sh re-runs, and
    # if the resulting .config is byte-identical then make has nothing to
    # rebuild anyway. Cheap and deterministic beats subtle and occasionally
    # silent — the failure mode being avoided is a build that reports success
    # while shipping a kernel that quietly ignored the config change.
    # Gated on a CHECKSUM of the fragments rather than done unconditionally.
    # Removing the stamp costs about two seconds by itself, but it makes the
    # kernel .config regenerate, which makes Buildroot re-run the configure step,
    # which triggers a full ~10-15 minute kernel recompile — on EVERY build, even
    # one that only edited a shell script in the overlay. Measured on 2026-07-25
    # when a pack-only rebuild spent that time in arch/x86/boot/compressed.
    #
    # The checksum lives in the output volume beside the build it describes, so
    # the compare is against what this tree actually last built from.
    LINUX_BUILD_DIR="$(ls -d /build-output/build/linux-[0-9]* 2>/dev/null | head -1)"
    FRAGMENT_SUM_FILE=/build-output/.rmpg-kernel-fragment-sum
    FRAGMENT_SUM="$(cat /kiosk-linux/configs/kernel-*.fragment 2>/dev/null | sha256sum | cut -d" " -f1)"
    if [ -n "$LINUX_BUILD_DIR" ] && [ -f "$LINUX_BUILD_DIR/.stamp_dotconfig" ]; then
      if [ "$FRAGMENT_SUM" != "$(cat "$FRAGMENT_SUM_FILE" 2>/dev/null)" ]; then
        echo "Kernel fragments changed — forcing a re-merge (removing $LINUX_BUILD_DIR/.stamp_dotconfig) ..."
        rm -f "$LINUX_BUILD_DIR/.stamp_dotconfig"
      else
        echo "Kernel fragments unchanged (sha256 matches) — skipping the forced re-merge."
      fi
    fi
    # Written only after the symbol gate below passes, so a failed build does not
    # record its fragments as successfully applied.

    echo "Configuring the kernel and verifying FZ-55 symbols survived merge_config ..."
    make -C /build-output linux-configure

    KCONFIG_FILE="$(ls -d /build-output/build/linux-[0-9]*/.config 2>/dev/null | head -1)"
    if [ -z "$KCONFIG_FILE" ]; then
      echo "ERROR: could not locate the generated kernel .config under /build-output/build/linux-*/" >&2
      exit 1
    fi
    echo "Auditing $KCONFIG_FILE"

    # Grouped by the failure each one prevents, so a future failure message
    # says WHY the symbol matters instead of just naming it.
    FZ55_REQUIRED_KSYMS="
      CONFIG_COMMON_CLK:touchscreen-bus-gate
      CONFIG_MFD_INTEL_LPSS_PCI:touchscreen-bus
      CONFIG_MFD_INTEL_LPSS_ACPI:touchscreen-bus
      CONFIG_I2C_DESIGNWARE_PLATFORM:touchscreen-bus
      CONFIG_I2C_HID_ACPI:touchscreen-transport
      CONFIG_PINCTRL:digitizer-gpio-irq-gate
      CONFIG_PINCTRL_CANNONLAKE:digitizer-gpio-irq-mk1
      CONFIG_PINCTRL_ALDERLAKE:digitizer-gpio-irq-mk3
      CONFIG_X86_PKG_TEMP_THERMAL:thermal-trip-source
      CONFIG_SENSORS_CORETEMP:thermal-telemetry
      CONFIG_INTEL_IDLE:battery-runtime-and-heat
      CONFIG_ITCO_WDT:hang-recovery
      CONFIG_DRM_SIMPLEDRM:no-black-brick-fallback
      CONFIG_SYSFB_SIMPLEFB:no-black-brick-fallback
      CONFIG_PANASONIC_LAPTOP:brightness-hotkeys
      CONFIG_SND_HDA_CODEC_REALTEK:audio-codec-parser
      CONFIG_EFIVAR_FS:read-own-boot-entries
      CONFIG_NTFS3_FS:ota-on-no-usb-install
      CONFIG_DRM_I915:fz55-graphics
      CONFIG_E1000E:fz55-wired-net
      CONFIG_IWLWIFI:fz55-wifi
      CONFIG_BLK_DEV_NVME:fz55-storage
    "
    ksym_failed=0
    for entry in $FZ55_REQUIRED_KSYMS; do
      sym="${entry%%:*}"
      why="${entry#*:}"
      if ! grep -q "^${sym}=y$" "$KCONFIG_FILE"; then
        actual="$(grep -E "^${sym}=|^# ${sym} is not set" "$KCONFIG_FILE" || true)"
        if [ -z "$actual" ]; then
          actual="ABSENT from .config — its dependencies are unmet, so merge_config.sh dropped it"
        fi
        echo "ERROR: $sym is not =y (needed for: $why)" >&2
        echo "       $actual" >&2
        ksym_failed=1
      fi
    done
    if [ "$ksym_failed" -ne 0 ]; then
      echo "" >&2
      echo "One or more FZ-55 kernel symbols did not reach the generated .config." >&2
      echo "An =m value is ALSO a failure here: this image is an initramfs with no" >&2
      echo "module loading in its init path, so a module is built and never loaded." >&2
      exit 1
    fi
    echo "FZ-55 kernel symbols verified =y in the generated .config."

    # Record the fragment checksum only now: if the gate above had failed, the
    # next run must re-merge and re-check rather than trusting a config that was
    # never accepted.
    printf "%s\n" "$FRAGMENT_SUM" > "$FRAGMENT_SUM_FILE"

    echo "Building (this takes a while on first run) ..."
    make -C /build-output

    echo "Build complete inside the volume:"
    ls -la /build-output/images/bzImage /build-output/images/rootfs.cpio.gz

    # ── Initramfs integrity gate (2026-07-25) ────────────────────────────────
    #
    # A truncated rootfs.cpio.gz is the worst artifact this build can produce,
    # because every cheap check passes it: gzip -t reports OK, the file size looks
    # plausible, and `cpio -t | grep` finds early paths just fine. It only fails
    # as a kernel panic, on a terminal, in a vehicle, possibly after an OTA update
    # that reported success.
    #
    # Observed for real on 2026-07-25: a concurrent build in another worktree
    # wrote images/rootfs.cpio while gzip was reading it, and the result held 1329
    # of 11063 entries and ended mid usr/lib. The only warning anywhere was one
    # line of gzip output: "file size changed while zipping".
    #
    # Buildroot leaves the uncompressed archive next to the compressed one, so the
    # check is exact rather than heuristic: decompressed size must equal it.
    CPIO_RAW=/build-output/images/rootfs.cpio
    if [ -f "$CPIO_RAW" ]; then
      raw_bytes="$(stat -c %s "$CPIO_RAW")"
      dec_bytes="$(gzip -dc /build-output/images/rootfs.cpio.gz | wc -c)"
      if [ "$raw_bytes" != "$dec_bytes" ]; then
        echo "ERROR: rootfs.cpio.gz is TRUNCATED." >&2
        echo "  uncompressed archive : $raw_bytes bytes" >&2
        echo "  decompresses to      : $dec_bytes bytes" >&2
        echo "" >&2
        echo "This image would panic at boot. The usual cause is another build" >&2
        echo "running against the same Docker volumes (see the concurrent-build" >&2
        echo "guard near the top of this script). Re-run the build." >&2
        exit 1
      fi
      echo "Initramfs integrity verified: $dec_bytes bytes decompressed, matching the archive."
    else
      echo "WARNING: $CPIO_RAW absent — cannot verify the initramfs was packed whole." >&2
    fi

    # The version the OTA updater compares MUST be the one from this worktree
    # overlay. A concurrent build in another worktree overwrote target/ on
    # 2026-07-25 and produced an image stamped with that worktree version, which
    # would make every terminal either skip the update or take the wrong one.
    OVERLAY_VERSION="$(tr -d "[:space:]" < /kiosk-linux/rootfs-overlay/etc/rmpg-os-version)"
    PACKED_VERSION="$(gzip -dc /build-output/images/rootfs.cpio.gz | cpio -i --to-stdout etc/rmpg-os-version 2>/dev/null | tr -d "[:space:]")"
    if [ "$OVERLAY_VERSION" != "$PACKED_VERSION" ]; then
      echo "ERROR: version mismatch between the overlay and the packed image." >&2
      echo "  overlay says : $OVERLAY_VERSION" >&2
      echo "  image says   : $PACKED_VERSION" >&2
      echo "Another build may have overwritten target/, or the overlay copy was skipped." >&2
      exit 1
    fi
    echo "Image version verified: $PACKED_VERSION"

    # ── Overlay manifest gate (2026-07-25) ───────────────────────────────────
    #
    # Assert that every file the overlay is responsible for is actually IN the
    # packed image. The integrity and version gates above both passed on an image
    # that was missing three init scripts, because a concurrent build from another
    # worktree overwrote target/ between the overlay copy and the cpio pack: the
    # archive was internally consistent and correctly versioned, just gutted from
    # 11011 entries down to 2282.
    #
    # The consequence of each missing file is severe and silent — no boot-attempt
    # counting (no rollback), no watchdog (no hang recovery), no hardware report
    # (a bring-up that yields nothing) — and the boot log looks normal, because a
    # script that does not exist cannot report that it is missing.
    #
    # Derived from the overlay itself rather than hardcoded, so a new init script
    # or helper is covered the moment it is added, with no second place to update.
    echo "Verifying the overlay reached the packed image ..."
    gzip -dc /build-output/images/rootfs.cpio.gz > /tmp/rmpg-verify.cpio
    cpio -t < /tmp/rmpg-verify.cpio > /tmp/rmpg-verify.list 2>/dev/null

    overlay_missing=0
    for f in $(cd /kiosk-linux/rootfs-overlay && find . -type f | sed "s|^\./||"); do
      case "$f" in
        # Intentionally not shipped: the disabled marker is a documentation
        # artifact retired with the browser-only boot path.
        *.disabled) continue ;;
      esac
      if ! grep -qx "$f" /tmp/rmpg-verify.list && ! grep -qx "./$f" /tmp/rmpg-verify.list; then
        echo "ERROR: overlay file missing from the packed image: $f" >&2
        overlay_missing=$((overlay_missing + 1))
      fi
    done
    rm -f /tmp/rmpg-verify.cpio /tmp/rmpg-verify.list

    if [ "$overlay_missing" -ne 0 ]; then
      echo "" >&2
      echo "$overlay_missing overlay file(s) did not reach the image." >&2
      echo "The usual cause is another build writing to the same Docker volumes" >&2
      echo "(see the concurrent-build guard near the top of this script). Note that" >&2
      echo "guard only protects builds that HAVE it — a checkout of this script from" >&2
      echo "before 2026-07-25, in another worktree, will still start alongside this" >&2
      echo "one. Confirm nothing else is building, then re-run." >&2
      exit 1
    fi
    echo "Overlay manifest verified: every overlay file is present in the image."

    echo "Copying final images out to the host-visible output/ directory ..."
    mkdir -p /kiosk-linux/output/images
    cp /build-output/images/bzImage /build-output/images/rootfs.cpio.gz /kiosk-linux/output/images/
  ' || {
  # ── Name the concurrent-build cause on failure (2026-07-25) ────────────────
  #
  # `set -e` would otherwise abort here with only Buildroot output on screen, and
  # the symptom of a mid-build collision looks nothing like its cause. Observed
  # three times in one day; the third read:
  #
  #   /bin/sh: 1: scripts/basic/fixdep: Permission denied
  #   make[5]: *** [net/netfilter/nf_nat_masquerade.o] Error 126
  #
  # fixdep is a host helper the kernel build execs for EVERY object file. It had
  # compiled fine and hundreds of objects had already used it — then a build in
  # another worktree, sharing this same Docker volume, replaced it mid-run. Two
  # random object files failed with an exec error while the config was perfectly
  # valid, which sends you looking at Kconfig for a problem that is not there.
  #
  # The guard at the top of this script only checks at START, so a build that
  # begins after ours cannot be refused. This turns the aftermath into a
  # diagnosis instead of a mystery.
  BUILD_RC=$?
  CONCURRENT_NOW="$(docker ps --filter volume="$BUILD_OUTPUT_VOLUME" --format '{{.ID}} {{.Image}}' 2>/dev/null || true)"
  echo "" >&2
  echo "ERROR: the Buildroot container exited non-zero (rc=$BUILD_RC)." >&2
  if [ -n "$CONCURRENT_NOW" ]; then
    echo "" >&2
    echo "⚠  ANOTHER BUILD IS USING THE SAME VOLUME RIGHT NOW:" >&2
    echo "$CONCURRENT_NOW" | sed 's/^/     /' >&2
    echo "" >&2
    echo "   That is very likely the cause, NOT your config. The signature is a file" >&2
    echo "   that existed moments ago going missing or unusable mid-build, because the" >&2
    echo "   other build is writing the same tree. Both of these were seen for real:" >&2
    echo "     scripts/basic/fixdep: Permission denied        (then 'Error 126')" >&2
    echo "     ld: cannot find scripts/kconfig/confdata.o: No such file or directory" >&2
    echo "   The second one happened one line after that object compiled successfully." >&2
    echo "   Do not go looking through Kconfig for either of them." >&2
    echo "   Wait for that build to finish and re-run. Separate volumes are the other" >&2
    echo "   option, but CHECK FREE SPACE FIRST — the output tree is ~32 GB, and on" >&2
    echo "   2026-07-25 the Colima VM had only 19 GB free, so a second tree could not" >&2
    echo "   have fitted even from scratch:" >&2
    echo "     docker run --rm -v $BUILD_OUTPUT_VOLUME:/out alpine df -h /out" >&2
    echo "     BUILDROOT_VOLUME=kiosk-src-mine BUILD_OUTPUT_VOLUME=kiosk-out-mine ./build.sh" >&2
    echo "   (a fresh output volume also means a full from-scratch build, ~1-2h, and" >&2
    echo "    WebKitGTK needs a Colima VM of 16 GiB RAM or more to compile at all)" >&2
    echo "   In practice, on one machine, coordinating with the other build is cheaper" >&2
    echo "   than isolating from it." >&2
  else
    echo "  No other container is holding the volume now, so this is more likely a" >&2
    echo "  real build failure — but note a colliding build may have already exited." >&2
    echo "  An 'Error 126' or 'Permission denied' on a script under scripts/ is a" >&2
    echo "  collision signature regardless of what docker ps says at this moment." >&2
  fi
  exit "$BUILD_RC"
}

ls -la "$OUTPUT_DIR/images/bzImage" "$OUTPUT_DIR/images/rootfs.cpio.gz" 2>/dev/null || {
  echo "ERROR: expected output images not found in $OUTPUT_DIR/images/ — build likely failed partway; check the make output above." >&2
  exit 1
}

# Sub-project 5: assemble the A/B boot-partition disk image from the
# bzImage/rootfs.cpio.gz just built. This runs in its own SEPARATE, small
# Docker image (kiosk-linux-disktools:latest, from docker/Dockerfile.disktools)
# rather than $IMAGE_TAG (kiosk-linux-buildroot:latest) — that image stays
# arch-native for the multi-hour Buildroot compile above. Ubuntu's
# syslinux-common/extlinux packages this step needs have no arm64 build at
# all, so kiosk-linux-disktools:latest is built (and run) with
# --platform linux/amd64 instead of forcing the whole compile under QEMU
# emulation. It also runs as its own --privileged container invocation
# (needs losetup/mount, which the rest of this script's unprivileged --user
# build steps do not have and do not need) — kept separate from the main
# build step above to limit that extra privilege to only this one, narrowly-
# scoped operation.
DISKTOOLS_IMAGE_TAG="kiosk-linux-disktools:latest"

echo "Building the disk-assembly tools image ($DISKTOOLS_IMAGE_TAG) ..."
docker build --platform linux/amd64 ${DOCKER_NETWORK_ARGS[@]+"${DOCKER_NETWORK_ARGS[@]}"} -t "$DISKTOOLS_IMAGE_TAG" -f "$SCRIPT_DIR/docker/Dockerfile.disktools" "$SCRIPT_DIR/docker"

echo "Assembling the A/B boot-partition disk image ..."
docker run --rm --privileged --platform linux/amd64 \
  -v "$SCRIPT_DIR":/kiosk-linux \
  "$DISKTOOLS_IMAGE_TAG" \
  bash /kiosk-linux/scripts/assemble-disk-image.sh

ls -la "$OUTPUT_DIR/images/disk.img" 2>/dev/null || {
  echo "ERROR: expected disk.img not found in $OUTPUT_DIR/images/ — disk assembly likely failed; check the output above." >&2
  exit 1
}
