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

- `kiosk-linux-os-1.0.0.tar.gz` — first published OS image release, uploaded
  2026-07-22. Contains the sub-project 1 (base image) + sub-project 2 (DRM/KMS
  graphics stack) build output. QEMU/virtio-gpu target only — see
  `kiosk-linux/README.md` for the full scope and current limitations. Not yet
  tested or intended for real hardware.
