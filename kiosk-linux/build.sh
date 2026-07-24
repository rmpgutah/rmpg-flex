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

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: docker is not available/running." >&2
  echo "  On macOS: install+start Colima —" >&2
  echo "    brew install colima docker && colima start --cpu 4 --memory 8 --disk 60" >&2
  echo "  On Windows/WSL2: enable Docker Desktop's WSL Integration for your distro" >&2
  echo "    (Settings > Resources > WSL Integration), or install docker-ce directly" >&2
  echo "    inside the WSL2 distro — no Colima/VM workaround needed there." >&2
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
