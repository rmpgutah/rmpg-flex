# Kiosk Linux OS Image — Release Process

How to publish a new Kiosk Linux OS image release for download from
`rmpgutah.us/downloads` and the Admin console's Downloads tab.

This is a manual, one-time-per-release process — there is no CI pipeline for this
yet (Buildroot doesn't build on macOS directly; see `build.sh`'s own comments for
the Colima/Docker toolchain this requires).

## Steps

1. **Build**: `cd kiosk-linux && ./build.sh` — produces
   `output/images/{bzImage,rootfs.cpio.gz}`.
2. **Package**: `cd output/images && tar czf kiosk-linux-os-<version>.tar.gz disk.img`
   — `<version>` is this OS image's own release number, independent of the RMPG
   Flex app version; this is a separate artifact with its own release lifecycle.

   **Ship `disk.img` ONLY.** It already contains the bootloader plus a full
   kernel + rootfs in *each* of the two A/B slots, so adding the standalone
   `bzImage` and `rootfs.cpio.gz` ships the same data a third and fourth time.
   Doing that pushed the 1.2.0 tarball to 354 MiB and **`wrangler r2 object put`
   hard-rejects anything over 300 MiB** ("Wrangler only supports uploading files
   up to 300 MiB in size" — it fails in milliseconds, so a "finished" command is
   not evidence the upload happened; always confirm with Step 4). disk.img alone
   compresses to ~236 MiB, under the cap and a far smaller field download.
   `disk.img` also boots directly under QEMU, so developers lose nothing.
2b. **Also package a `.zip`** — `zip -9 kiosk-linux-os-<version>.zip disk.img`.
   These images get written to a USB stick from whatever laptop is on hand,
   which in practice is a **Windows** machine, and Windows cannot open a
   `.tar.gz` by double-clicking — serving only that made the very first
   install step a blocker for the people who actually do installs. A `.zip`
   opens in Explorer natively and compresses to essentially the same size
   (236.1 MB vs 236.1 MB for 1.2.0). `scanInstallers()` prefers the `.zip`
   when both are present and falls back to the `.tar.gz`, so keep publishing
   both: Linux/macOS users and scripts still get a tarball.

3. **Upload**: `wrangler r2 object put rmpg-flex-downloads/kiosk-linux-os-<version>.tar.gz
   --file=kiosk-linux-os-<version>.tar.gz --remote` (and again for the `.zip`)
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

7. **Package the no-USB installer bundle** (added 2026-07-25):

   ```bash
   scripts/package-nousb-installer.sh
   ```

   This step did not exist before, and its absence was a real gap rather than an
   omission of convenience. The no-USB install is the **primary** method for this
   fleet — it needs no USB stick carried to each vehicle — and its installer
   refuses to start unless `bzImage`, `rootfs.cpio.gz` and **`grubx64.efi`** all
   sit beside it. Buildroot emits that third file as
   `output/images/efi-part/EFI/BOOT/bootx64.efi`, under a different name, and
   nothing here told the publisher to include it. So every release to date shipped
   a download that could not perform a no-USB install, and the failure surfaced as
   the installer refusing to run on the operator machine.

   The script stages the three artifacts under the names the installer expects,
   adds both PowerShell scripts, the `.bat` launcher and a READ-ME-FIRST that
   states the (now doubled, for A/B slots) free-space requirement, then zips it.
   Upload the resulting `rmpg-flex-os-nousb-installer-<version>.zip` the same way
   as the disk image in Steps 3-4.

   ⚠️ The READ-ME-FIRST warns operators to fully shut Windows down with Fast
   Startup disabled before installing. This is not boilerplate: a volume left
   dirty by Fast Startup or hibernation cannot be mounted writable by `ntfs3`, so
   the terminal reports its boot store as read-only and **over-the-air updates
   cannot be staged on that unit** until someone performs a real shutdown.

## Current release

- `kiosk-linux-os-1.2.0.tar.gz` — **the first release that actually renders the
  RMPG Flex console.** Contains `disk.img` only (the flashable A/B-slot disk
  image field installs use, which also boots directly under QEMU — see the
  packaging note above for why the standalone kernel/rootfs are no longer
  shipped). Verified by a real QEMU screenshot showing the live
  login screen — warning banner, seal, login panel, and the device panel
  reporting Server/Connection Online — with zero segfaults across the run.
  - **Root cause of the 1.1.0 "loads pages but renders blank white"
    limitation: `glib-networking` was missing.** That package provides the GIO
    TLS module libsoup3 (WPE WebKit's HTTP stack) loads to perform HTTPS.
    `ca-certificates` supplied the trust roots, but nothing in the image could
    actually speak TLS, so every `https://` load "succeeded" in ~50ms with an
    empty document that painted white. Isolation testing proved it: `data:`
    URLs and plain-HTTP pages rendered perfectly (colors, fonts, layout) while
    *every* HTTPS page — rmpgutah.us and example.com alike — came back blank.
    The rendering pipeline was never at fault.
  - **Cog SIGSEGV finally root-caused (patch 0005).** Once real content flowed,
    cog crashed immediately and reproducibly. Cog's DRM renderer writes its own
    pointer into the wl_shm buffer resource's `user_data` slot, but that slot is
    owned by libwayland's `wayland-shm.c`. Real pages destroy buffers (blank
    pages never did), and on the first destroy libwayland dereferenced the NULL
    cog's listener had written there — segfault at address 0x20. Fixed by
    keeping the renderer pointer in cog's own `buffer_object`. ⚠️ The two
    affected call sites end in *identical* lines and GNU `patch -t` silently
    skips the second as "already applied" — a `COG_POST_PATCH_HOOKS` hook
    (`configs/cog-post-patch-hook.mk`) now enforces the fix at every call site
    and **fails the build** if any survive.
  - **Panasonic Toughbook FZ-55 hardware enablement** (`configs/kernel-fz55.fragment`
    + Mesa `iris`): Intel UHD 620 graphics, Intel gigabit ethernet, NVMe/SATA
    storage, USB boot, and HID/multitouch input. Purely additive — the same
    image still boots under QEMU on virtio. **Not yet validated on physical
    FZ-55 hardware** — first-article validation is required before fleet rollout.
  - **Boot-marker fixes:** three markers were reporting false failures — the DRM
    self-test raced the browser for display ownership (`modetest` cannot set a
    mode while cog holds DRM master — that the browser is scanning out *is* the
    proof the stack works), the network check used plain HTTP on a network that
    blocks port 80, and the browser started before DNS was ready (renamed
    `S99kiosk-net-marker` → `S98` so ordering is numeric, not a lexicographic
    accident).
  - Removed the `WEBKIT_DEBUG` / compositing-debug-visuals env vars from the
    browser launcher — those drew literal yellow tile borders over the kiosk UI.

### Previous releases

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
