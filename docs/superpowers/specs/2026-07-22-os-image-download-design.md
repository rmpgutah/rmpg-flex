# Kiosk Linux OS Image Download

**Date:** 2026-07-22
**Status:** Approved, pending implementation plan

## Context

The public `/downloads` page and the new Admin Downloads tab both serve real desktop
app installers (Windows/Mac/Android) from a dedicated Cloudflare R2 bucket
(`DOWNLOADS` binding), auto-detected by `scanInstallers()` in
`src/routes/downloads.ts` based on filename patterns (`.exe`/`.zip`, `.dmg`, `.apk`).

The Kiosk Linux OS image (`kiosk-linux/output/images/bzImage` +
`rootfs.cpio.gz`, from the merged sub-project 1/2 work) has never been uploaded
anywhere — it only exists as local build output on the dev machine that built it.
This spec adds it as a fourth downloadable category, reusing the existing bucket,
route, and detection pattern rather than building new infrastructure.

## Non-goals

- No CI/automated build-and-upload pipeline — per explicit decision, this is a
  one-time manual build + upload, repeated by hand whenever a new OS image needs
  publishing. An automated pipeline is a separate, later decision if this proves
  worth maintaining regularly.
- No versioning/release-notes system beyond what the existing filename-based
  version extraction (`extractVersion()`, a `\d+\.\d+\.\d+` regex match) already
  provides.
- No changes to how the OS image itself is built (`kiosk-linux/build.sh`,
  unmodified) — this only concerns packaging the existing build output for
  distribution and serving it.
- Does not touch the UEFI boot splash (`uefi-bootsplash/`) — out of scope for this
  spec; a separate future addition if ever wanted.
- No install instructions/documentation for what to DO with this OS image once
  downloaded (e.g., how to flash it, boot it on real hardware) — the OS image
  itself is still QEMU-only per its own design spec's explicit scope; this spec is
  purely about making the existing build artifact downloadable, not about
  real-hardware deployment instructions that don't exist yet.

## Overview

1. **Packaging**: bundle `kiosk-linux/output/images/{bzImage,rootfs.cpio.gz}` into a
   single archive, `kiosk-linux-os-<version>.tar.gz`, where `<version>` is a plain
   semver-shaped string (matching the existing `extractVersion()` regex) chosen at
   packaging time (e.g. matching the app's own version, or a simple incrementing
   scheme — implementation plan decides which, documented either way).
2. **Upload**: `wrangler r2 object put` (or the Cloudflare dashboard) to the
   existing `DOWNLOADS` bucket, manually, following the same process an installer
   build already would.
3. **Detection**: extend `InstallerInfo` (currently `{ win?, mac?, android? }`) with
   a new `os?: InstallerMeta` field, and extend `scanInstallers()` with a branch
   matching `name.endsWith('.tar.gz') && name.startsWith('kiosk-linux-os-')` —
   picking the highest version present, same `verLt()` comparison the other three
   categories already use.
4. **Serving**: no changes needed to `serveDownloadFile()` — it already serves any
   filename generically, falling back to `application/octet-stream` for an
   unrecognized extension (`.tar.gz` isn't in its explicit MIME list, so it uses the
   generic octet-stream default, which is correct for this file type; no
   `Content-Disposition: attachment` currently applies to `.tar.gz` either, since
   that's only added for `.dmg`/`.exe`/`.apk`/`.zip` — the plan should extend that
   list so the download behaves as a "Save As" rather than the browser trying to
   render/preview a `.tar.gz`).
5. **UI**: add a fourth card to both the public `DownloadsPage.tsx` and the Admin
   `AdminDownloadsTab.tsx` — "Kiosk Linux OS" (or similar label), showing version +
   size, linking to `/downloads/<filename>` exactly like the other three.

## Data flow

```
[Manual, one-time, repeated per future update]
kiosk-linux/build.sh (existing, unmodified)
  → output/images/{bzImage, rootfs.cpio.gz}
  → tar czf kiosk-linux-os-<version>.tar.gz [both files]
  → wrangler r2 object put rmpg-flex-downloads/kiosk-linux-os-<version>.tar.gz --file=...

[Runtime, automatic, every request]
GET /api/downloads/info
  → scanInstallers(DOWNLOADS bucket)
  → detects kiosk-linux-os-*.tar.gz alongside existing win/mac/android detection
  → returns { win, mac, android, os }

DownloadsPage.tsx / AdminDownloadsTab.tsx
  → renders a 4th "Kiosk Linux OS" card if info.os is present
  → download button → GET /downloads/kiosk-linux-os-<version>.tar.gz
  → serveDownloadFile() (existing, extended MIME/Content-Disposition list)
```

## Error handling

- If no `kiosk-linux-os-*.tar.gz` object exists in the bucket yet (before the first
  manual upload), `info.os` is simply absent — both UIs already have an established
  "Not available" fallback pattern for a missing platform; the new OS card follows
  the same pattern, not a new error state.
- Filename collisions/version comparison reuse the exact same `extractVersion()` /
  `verLt()` logic already proven correct for the other three categories — no new
  parsing logic to get wrong.

## Testing

- Backend: extend the existing (if any) `scanInstallers()` test coverage — check
  what test file, if any, currently covers `src/routes/downloads.ts` before writing
  new tests, and follow that file's existing convention exactly.
- Frontend: extend `AdminDownloadsTab.test.tsx` (from the just-merged Admin
  Downloads tab work) with an `os` fixture in its mock `/api/downloads/info`
  response, confirming the 4th card renders. Also verify `DownloadsPage.tsx` renders
  the new card (check whether that page has existing test coverage first).
- Manual: after the real upload, hit the live `/api/downloads/info` and confirm the
  `os` field appears with the real uploaded file's metadata; confirm the actual
  download link produces a working file (not a 404 or an HTML error page).

## Rollout

Ships through the existing Cloudflare Pages/Workers deploy for the code changes
(routes + UI). The actual OS image upload is a separate, manual, one-time action
performed after this code deploys (or before — order doesn't matter, since `info.os`
being absent is a handled state, not an error).
