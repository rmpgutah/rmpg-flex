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

## Phases

### Phase 1 — OTA updates on commit (next)

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

### Phase 2 — Enterprise desktop UI/UX

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

## Validation still owed on physical hardware

1. Wi-Fi association with a real AP (WPA2-PSK and Enterprise)
2. FZ-55 boot: i915 graphics, touchscreen, dual battery gauge
3. No-USB installer against real firmware (and CSM-less revisions)
4. OTA update end-to-end on a fielded unit
