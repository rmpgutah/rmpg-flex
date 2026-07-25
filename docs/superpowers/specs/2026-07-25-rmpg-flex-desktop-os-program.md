# RMPG Flex Desktop OS — multi-session program

**Status:** in progress · **Started:** 2026-07-25 · **Owner:** Christopher Zamora

A Windows-like enterprise desktop OS for RMPG kiosk/patrol terminals, delivered
over several sessions. This document is the resume point — read it first, then
`kiosk-linux/README.md` and `RELEASE.md` for the current build state.

## Why this exists

Terminals are Panasonic Toughbook FZ-55 units at sites with **no wired
ethernet**. They need to boot straight into RMPG Flex, be usable as a general
workstation, survive a bad update unattended, and be updatable without anyone
carrying a USB stick to each vehicle.

## Where things stand (2026-07-25)

Shipped and verified:

- **Kiosk OS 1.2.0** published, boot-verified, screenshotted; live for download.
- **Desktop session works** — `KIOSK_LINUX_DESKTOP_OK`, taskbar with Start
  button, window list, RAM/IP/clock indicators, Flex running as a managed
  window. Screenshot: `kiosk-linux/test/desktop-screenshot.png`.
- **Wi-Fi stack built** — iwlwifi + 32 firmware blobs, connman (autostarts
  S45), wpa_supplicant incl. WPA2-Enterprise, regulatory.db, taskbar picker.
  **Not yet validated against a real access point** (QEMU has no Wi-Fi).
- **A/B boot slots** with automatic rollback after 3 failed boots.
- **No-USB Windows installer** (GRUB EFI + boot entry, fully reversible).
  **Not yet run on physical hardware.**
- **Download outage fixed** — `/downloads/<file>` had no route and returned
  11,630 bytes of SPA HTML for every artifact.
- **Idle lock** (`rmpg-lock` + watcher in the taskbar). Verified: extension live
  in the server, watcher armed with no poll errors, lock grabs input
  exclusively. Signs the Flex session out BEFORE covering the screen, so
  dismissing the overlay reveals only the login page — Flex's own auth stays the
  access boundary rather than inventing local credential storage on a device in
  a vehicle.
- **OTA update system** — `rmpg-update` agent, `/api/os/manifest`, staging
  channel with an explicit promote gate, 12 tests. Payload publishing blocked,
  see below.

## FZ-55 stabilization pass (2026-07-25, OS 1.4.0)

Scope chosen with the owner: hardware stabilization, **no audio userspace** (it
forces a full WebKitGTK rebuild and adds 30-50 MB to an already-unpublishable
payload), and **full A/B on the no-USB install path**.

### What was actually broken

The pass began as kernel enablement and turned into defect repair. Four faults,
none of which any existing test could see, all of which only manifest on real
hardware:

1. **A/B rollback and OTA were both inert on every fielded unit.**
   `S01kiosk-boot-slot-check` and `rmpg-update` hardcoded
   `mount -t ext2 /dev/vda1` — a QEMU virtio name. On an FZ-55 the store is
   `nvme0n1p1`/`sda1`, or a directory on the Windows NTFS volume. The mount
   failed, so the failed-boot counter never incremented and rollback could never
   fire; `rmpg-update` died at its first step. QEMU passed throughout.

2. **A rollback ping-pong waiting behind fix 1.** The counter *reset* was
   `[ -w /mnt/kiosk-boot/boot_attempts ]`, false both on the NTFS layout (wrong
   path) and on a read-only mount. Fixing discovery alone would have made three
   *healthy* boots cross the 3-strike limit and flip slots forever.

3. **The no-USB install had no A/B slots at all** — one payload directory, so a
   bad update had nothing to fall back to, on the primary install path.

4. **The no-USB path could not boot or return to Windows.** `search --file`
   requires the `search_fs_file` GRUB module and `chainloader` requires `chain`;
   neither was in `BR2_TARGET_GRUB2_BUILTIN_MODULES_EFI`, and with built-in
   modules there is no module directory on the ESP for `insmod` to fall back to.
   Plus `RELEASE.md` never told anyone to ship `grubx64.efi` at all (Buildroot
   emits it as `efi-part/EFI/BOOT/bootx64.efi`), so no published release could
   perform a no-USB install.

Faults 3 and 4 were latent since the installer was written; it had never run on
hardware.

### Kernel/firmware findings worth remembering

- **`=m` is a silent no-op in this image.** `X86_PKG_TEMP_THERMAL` and
  `EFIVAR_FS` were modules in an initramfs with no module loading, so thermal
  protection was inert while every grep for "is not set" reported them enabled.
- **`merge_config.sh` drops a symbol with unmet dependencies and only warns**,
  leaving *no trace* in `.config`. `I2C_DESIGNWARE_PLATFORM` was absent (not
  disabled) because `COMMON_CLK` was unset, so the touchscreen bus had no driver.
  Grepping for `is not set` cannot find this class; only a source-level
  dependency audit can.
- **`CONFIG_PINCTRL` is a menuconfig gate** — while unset, the entire Intel
  pinctrl menu was invisible, so the digitizer GPIO interrupt had no driver.
- i915 DMC blobs are 888 KB of a 26.9 MB firmware directory; the other 25 MB is
  GuC/HuC this image never enables. Keep all DMC (i915 selects by runtime
  platform detection, so per-model pruning breaks on the next revision), drop the
  rest.

### New components

`rootfs-overlay/usr/lib/rmpg/boot-store.sh` (shared store discovery by marker
file, both layouts), `rmpg-watchdog` (Intel TCO fed only while a bounded X round
trip succeeds), `rmpg-hwreport` (what actually bound, persisted to the store),
`rmpg-update rollback`, `scripts/prune-firmware.sh`,
`scripts/package-nousb-installer.sh`.

### Verification

`build.sh` now asserts 22 FZ-55 kernel symbols are `=y` in the generated
`.config` before the compile. New tests: `test/test-boot-store.sh` (17
assertions, verified to go red when the `vda1` hardcoding is reintroduced),
`test/run-qemu-nvme.sh` (boots the real image on NVMe/AHCI instead of virtio),
`test/assert-build-payload.sh`, `test/lint-installer.py`.

Hard-won build knowledge — do not rediscover these:

| Trap | Symptom | Fix |
| --- | --- | --- |
| Stale `target/` artifacts survive config changes | Wildly misleading errors far from the cause | Per-package list in `build.sh` (`DESKTOP_STALE_PKGS`) + `scripts/prune-stale-overlay.sh` |
| `modesetting_drv.so` unlinked to libgbm | `(EE) no screens found` | `Load "glamoregl"` in `xorg.conf` |
| `/tmp` is an empty tmpfs (initramfs root) | `XIO: fatal IO error 11` | Create `/tmp/.X11-unix` mode 1777 before X |
| Stale `/tmp/.X0-lock` between retries | `Server is already active` masks the real error | Clear lock + kill X between attempts |
| WebKitGTK OOM on 8 GiB VM | `Killed signal terminated program cc1plus` | Colima ≥ 16 GiB (24 used) |
| Wrangler 300 MiB object cap | Fails in ms; looks like success | Ship `disk.img` only (~236 MiB) |
| Pages `_redirects` status-200 proxy | Silently ignored → SPA HTML served | Absolute Worker-origin URLs |
| Reading a proxy signal, not the component's log | Three wrong hypotheses in a row | `test/run-qemu-shell.sh`; init scripts echo `(EE)` lines to console |
| Package needing a SECOND rebuild for a new reason | Guard tracked by name, so it never re-fired | `DESKTOP_STALE_PKGS` entries take a `pkg:reason` suffix |
| MIT-SCREEN-SAVER absent from the X server | Taskbar logs "idle lock armed" then NEVER locks | Rebuild xorg-server after adding xlib_libXScrnSaver |
| Grepping a log for the success string only | Confirmation and contradiction were 4 lines apart | Read the whole log |
| An apostrophe in a comment inside `build.sh`'s `bash -c '...'` block | Argument splits, container script TRUNCATES, and `bash -n` says SYNTAX OK whenever the apostrophe count is even | `test/assert-build-payload.sh` asserts what the container actually receives |
| Kernel fragment edited, `.config` unchanged | `pkg-kconfig.mk:158` declares the dependency, but it did not fire through Colima virtiofs — the stamp regenerated and the fragment was still ignored | `build.sh` removes the linux `.stamp_dotconfig` every run (~2s) |
| A package variable changed but the binary is stale | `BR2_TARGET_GRUB2_BUILTIN_MODULES_EFI` is consumed at LINK time; the package stamp already existed, so grubx64.efi kept the old module list | Add a `pkg:reason` entry to `DESKTOP_STALE_PKGS` |
| `\| tail -60` on the build | Masks `build.sh`'s exit code (you get `tail`'s) and truncates the log you need | Redirect to a file, then read it |
| Editing the overlay while a build runs | Buildroot already copied the overlay; `target/` keeps the old file and the image ships it | Rebuild after the last overlay edit, and verify content in the packed cpio |
| **Two worktrees building at once** | `BUILDROOT_VOLUME`/`BUILD_OUTPUT_VOLUME` default to FIXED names, so builds in different worktrees share one output tree. Observed twice on 2026-07-25: once producing a rootfs.cpio.gz holding 1329 of 11063 entries that still passed `gzip -t`, once silently dropping three init scripts (11011 → 2282 entries) from an image that was otherwise internally consistent and correctly versioned | `build.sh` refuses to start when a container already holds the volume, and gates the finished image on decompressed-size, version, and a full overlay manifest. **The refusal only protects builds that HAVE the guard** — a pre-2026-07-25 copy of `build.sh` in another worktree will still start alongside yours, which is why the post-build gates exist as well |

## Phases

### Phase 1 — OTA updates on commit (code complete; publishing blocked)

Highest value: without it every future improvement needs a physical visit.
The A/B mechanism already exists and self-heals; what is missing is delivery.

- `rmpg-update` agent on the terminal: poll a manifest, compare version,
  download the inactive slot's payload, verify SHA-256, flip default slot,
  reboot on a schedule. Never touch the running slot.
- Manifest endpoint (`/api/os/manifest`) + R2 payload naming per version.
- Device registry already has D1 schema (migration `kiosk-linux/migrations/0001`)
  — report version/health/last-seen so a fleet can be audited.
- CI: on merge to `main` touching `kiosk-linux/`, build, checksum, upload,
  publish the manifest. **Must not** auto-promote — publish to a `staging`
  channel and require an explicit promote, or one bad commit reboots the fleet.
- Resilience: refuse to update on battery below a threshold; never update while
  a call is active on that terminal.

### Phase 2 — Enterprise desktop UI/UX (started: idle lock done)

Modelled on Windows behaviours officers already know. Concrete items:

- Start menu: search, pinned/recent, categories, power submenu
- Notification area: volume, brightness, battery detail popup, Wi-Fi detail
- Lock screen + idle lock; session lock on badge-out
- Window snapping (Super+arrows), Alt+Tab switcher with previews, virtual desktops
- Settings app: display/resolution, network, date-time, printers, about
- On-screen keyboard (FZ-55 touchscreen), screenshot tool, file associations
- Desktop icons, wallpaper, right-click context menus
- Accessibility: text scaling, high-contrast for daylight use

### Phase 3 — `rmpg-browser` hardening

First-party WebKitGTK browser, company-owned. Tabs/address bar/downloads exist.
Add: bookmarks, history, find-in-page, zoom, print, PDF view, downloads manager,
certificate/TLS UI, policy-driven allow/deny lists, kiosk mode lockdown.

### Phase 4 — Fleet management surface

Admin UI over the device registry: terminal list, versions, health, update
channel assignment, remote reboot, per-site policy.

## Working agreements

- **Verify before claiming.** A screenshot showing *something* is not proof the
  right thing rendered — check the boot markers too. The colour-count check in
  `run-qemu-desktop.sh` once passed on a leftover browser while the desktop was
  failing.
- **Read the failing component's own log first.** Not the proxy signal.
- **Nothing ships unbooted.** Publish only what has passed a QEMU boot, and say
  plainly what is unvalidated on hardware.
- **Feature counting:** the ask included "150 front and backend functions".
  Track what genuinely works in `docs/kiosk-os-feature-inventory.md`, counted
  honestly — a padded list is worse than a short one.

## Known blocker: publishing the OTA payload

`wrangler r2 object put` **stalled for 1h21m** on the ~244 MiB rootfs (2026-07-25)
while the 13 MB kernel uploaded in seconds on the same run. It is a single-shot
PUT with no resume and no progress output, so a slow uplink is
indistinguishable from a hang.

The partial state is safe — the manifest is written last, so a terminal cannot
discover a release whose payload did not finish. **Do not reorder those steps.**

OS 1.3.0 is therefore **not yet on staging**: kernel uploaded, rootfs and
manifest not. Options are in `scripts/publish-os-release.sh` (retry,
`SKIP_PAYLOAD=1` after uploading elsewhere, or the dashboard's multipart
uploader). Worth solving properly — a 250 MB single-shot PUT is not a viable
release mechanism long-term, and the same size problem will hit every terminal
downloading over Wi-Fi.

## Validation still owed on physical hardware

Unchanged in substance by the 2026-07-25 pass — that pass removed reasons the
hardware would fail and added a way to see what happens, but nothing here is
verified until an FZ-55 boots.

1. Wi-Fi association with a real AP (WPA2-PSK and Enterprise)
2. FZ-55 boot: i915 graphics **and whether DMC loads**, touchscreen (the LPSS
   I2C + pinctrl chain is inference, not evidence), dual battery gauge
3. No-USB installer against real firmware (and CSM-less revisions), now including
   the A/B slot layout and the `slot.cfg` pointer GRUB sources
4. OTA update end-to-end on a fielded unit
5. Watchdog behaviour: that `ITCO_WDT` binds on the FZ-55 PCH, that a clean
   `reboot` is not mistaken for a hang, and that the startup grace period is long
   enough for a cold boot on real storage

**Run `rmpg-hwreport` output first.** It is written to the boot store under
`hwreports/` and answers most of items 1-3 in one pass, including whether any
firmware blob failed to load — which is the most likely reason a radio or the
display engine is silently degraded.

### Highest-value next steps

1. **Get one FZ-55 booted** and read the hardware report. Everything else is
   guessing until then.
2. **Solve payload publishing** (still blocked, see above). A 250 MB single-shot
   PUT is not a release mechanism, and the same size lands on every terminal over
   Wi-Fi. Options worth costing: R2 multipart, or shipping a delta against the
   previous rootfs.
3. **Trim the rootfs.** iwlwifi firmware is ~70 MB of it, covering every radio
   the FZ-55 might have. Unlike i915 DMC there is no cheap way to know which one
   a given unit needs, so this needs a decision rather than a prune.
4. **Fleet check-in** (Phase 4). `rmpg-hwreport` deliberately posts nowhere: the
   only OS endpoints are manifest/channels/promote, and a device-data ingest
   endpoint needs a device-token design first — not something to add casually in
   a codebase that recently had to close an unauthenticated CAD leak.
5. Audio userspace, if dispatch tones on the terminal are wanted (deferred
   2026-07-25 on cost grounds; the kernel half is already in place).
