# Kiosk Linux OS Image — Release Process

How to publish a new Kiosk Linux OS image release for download from
`rmpgutah.us/downloads` and the Admin console's Downloads tab.

This is a manual, one-time-per-release process — there is no CI pipeline for this
yet (Buildroot doesn't build on macOS directly; see `build.sh`'s own comments for
the Colima/Docker toolchain this requires).

## Steps

1. **Build**: `cd kiosk-linux && ./build.sh` — produces
   `output/images/{bzImage,rootfs.cpio.gz}`.
2. **Package**: `cd output/images && tar czf kiosk-linux-os-<version>.tar.gz bzImage
   rootfs.cpio.gz` — `<version>` is this OS image's own release number, independent
   of the RMPG Flex app version — this is a separate artifact with its own release
   lifecycle.
3. **Upload**: `wrangler r2 object put rmpg-flex-downloads/kiosk-linux-os-<version>.tar.gz
   --file=kiosk-linux-os-<version>.tar.gz --remote`
4. **Verify the upload landed** (independent of whether the site code has deployed
   yet): `wrangler r2 object get rmpg-flex-downloads/kiosk-linux-os-<version>.tar.gz
   --remote --file=/tmp/verify.tar.gz` and confirm the file size matches.
5. **Verify the site picks it up**: `curl -sf https://api.rmpgutah.us/api/downloads/info`
   should show an `os` field with the new filename/version. **This requires the
   backend detection code (the `os` branch in `src/routes/downloads.ts`'s
   `scanInstallers()`) to already be deployed to production** — the upload itself
   (Steps 1-4) works independently of that deploy, but the site won't surface the
   file until the code that recognizes `kiosk-linux-os-*.tar.gz` filenames is live.
   If `/api/downloads/info` doesn't show `os` yet, check whether this feature's
   code has actually been merged/deployed before assuming the upload failed.
6. **To supersede an old version**: upload the new `.tar.gz` under a higher version
   number — `scanInstallers()` already picks the highest version present via the
   same `verLt()` comparison used for the other installer categories. Old files are
   not deleted automatically; delete manually via `wrangler r2 object delete
   rmpg-flex-downloads/kiosk-linux-os-<old-version>.tar.gz --remote` if reclaiming
   space matters.

## Current release

- `kiosk-linux-os-1.1.0.tar.gz` — packaged 2026-07-23, not yet uploaded (pending
  explicit confirmation before the real R2 upload). Adds sub-project 3
  (networking + a real WPE WebKit/Cog kiosk browser) on top of 1.0.0's base
  image + DRM/KMS graphics stack. Real state, verified across multiple runs:
  - Networking works (DHCP lease, real outbound HTTP reachability).
  - The browser process (`cog --platform=drm`) is genuinely stable — a real,
    reproducible SIGSEGV was root-caused via gdb (register-level inspection)
    to a libwayland-server/Cog buffer-pool resize race, fixed with a two-layer
    patch (libwayland returns NULL instead of a stale pointer on a deferred
    pool resize; Cog checks for that NULL and drops the frame; a related
    reference-counting leak in Cog's buffer reuse path was also fixed).
    Confirmed crash-free across many consecutive boots.
  - **Known limitation**: the browser successfully loads pages (WebKit's own
    "Loaded successfully" event fires) but the rendered page is blank white.
    Direct pixel-byte inspection (via gdb) proved this is *not* a bug in the
    Cog/libwayland/GBM/DRM pipeline built this session — the raw bytes
    WebProcess exports are already uniformly blank before any of that code
    runs. The remaining issue lives inside WebKit's own internal Cairo-based
    software compositor, which was not resolved this session (three
    WebKit rebuild attempts were needed just to get this far: the original
    build, a wasted Debug-mode attempt that silently used a stale cached
    config, and a genuine Debug rebuild that reached 99.9% completion and
    then failed to link — confirming Debug mode is not cleanly supported by
    this WebKit version under this Buildroot toolchain).
  - Still QEMU/virtio-gpu only — see `kiosk-linux/README.md` for the full
    scope and current limitations. Not yet tested or intended for real
    hardware.
- `kiosk-linux-os-1.0.0.tar.gz` — first published OS image release, uploaded
  2026-07-22. Contains the sub-project 1 (base image) + sub-project 2 (DRM/KMS
  graphics stack) build output. QEMU/virtio-gpu target only — see
  `kiosk-linux/README.md` for the full scope and current limitations. Not yet
  tested or intended for real hardware.
