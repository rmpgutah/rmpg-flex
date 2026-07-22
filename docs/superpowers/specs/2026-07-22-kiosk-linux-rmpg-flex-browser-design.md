# Kiosk Linux — Running RMPG Flex (sub-project 3)

**Date:** 2026-07-22
**Status:** Approved, pending implementation plan

## Context

The Kiosk Linux program (`kiosk-linux/`) explores a custom Linux-based kiosk OS as
an alternative platform to the Windows-based Desktop Kiosk Shell Mode / UEFI Boot
Splash work already shipped elsewhere in this repo. Two sub-projects are done:

1. **Base image** — a minimal Buildroot/BusyBox image that boots to a working shell
   under QEMU (`KIOSK_LINUX_BOOT_OK` marker).
2. **Graphics stack** — kernel `virtio-gpu` + `libdrm` + Mesa3D's virgl Gallium
   driver, verified via a real QEMU screenshot of a `modetest` color-bar pattern
   (`KIOSK_LINUX_DRM_OK` marker).

Neither sub-project added networking or any browser — today's image cannot reach
any URL at all. This spec adds both: real network connectivity, and a kiosk
browser that renders the actual, live RMPG Flex web app.

## Non-goals

- **No Chromium.** Buildroot has no official Chromium package; building it from
  source would require vendoring Google's own `depot_tools`/`gn`/`ninja` toolchain,
  a 30–100GB source+build tree, and many hours of build time — realistically its
  own separate multi-day-to-multi-week program, not a slice of this sub-project.
  This spec uses **WPE WebKit** (via the **Cog** launcher) instead — a real,
  modern WebKit engine purpose-built for embedded/kiosk Linux, with an existing
  Buildroot package (`BR2_PACKAGE_WPEWEBKIT` + `BR2_PACKAGE_COG`).
- **No auto-login or stored credentials.** The kiosk shows whatever RMPG Flex's
  login page renders; a human operator still authenticates normally.
- **No fix for Cloudflare's managed challenge**, if WPE WebKit's TLS/JS
  fingerprint gets blocked by it (see "Known risk" below). That outcome is a
  documented finding, not a defect this sub-project resolves.
- **No update/provisioning mechanism** (still sub-project 4) or **real hardware
  support** (still deferred until specific target hardware is identified) —
  QEMU/virtio-gpu/virtio-net only.
- **No compositor** — Cog renders directly against the DRM/KMS backend from
  sub-project 2; no X11/Wayland session is introduced.

## Overview

1. **Networking**: add kernel `virtio-net` driver support (new kernel config
   fragment entries alongside the existing `kernel-drm.fragment`), wire BusyBox's
   existing `udhcpc` DHCP client into a new boot-time init script, and add the
   `ca-certificates` Buildroot package so TLS/HTTPS has a trust root bundle.
2. **Browser**: add `BR2_PACKAGE_WPEWEBKIT` and `BR2_PACKAGE_COG` to the defconfig.
   Cog is a minimal fullscreen launcher shell around WPE WebKit; it renders
   directly to the DRM/KMS output already working from sub-project 2, no
   compositor needed.
3. **Boot sequence**: a new `S99kiosk-net-marker` init script waits for a DHCP
   lease (bounded polling, not a fixed sleep — same pattern as sub-project 2's DRM
   marker) and confirms outbound connectivity via `curl`/`wget` to a known-good
   URL, printing `KIOSK_LINUX_NET_OK` only on genuine success. A following
   `S99kiosk-browser-marker` script launches `cog https://rmpgutah.us` and prints
   `KIOSK_LINUX_BROWSER_OK` once the process is confirmed alive and not
   immediately crashed.
4. **Target URL**: hardcoded to `https://rmpgutah.us` (live production) — no
   config-file indirection, matching what a real deployed kiosk device would
   actually run against.

## Data flow

```
kernel boots (virtio-net driver loaded)
  → udhcpc acquires a DHCP lease over the QEMU SLIRP NAT interface (-netdev user)
  → S99kiosk-net-marker: curl a known-good URL → prints KIOSK_LINUX_NET_OK
  → S99kiosk-browser-marker: cog https://rmpgutah.us (WPE WebKit, DRM/KMS output)
  → cog process alive + no immediate crash → prints KIOSK_LINUX_BROWSER_OK
  → QEMU screenshot capture (-vga none -device virtio-gpu-pci, reusing
    sub-project 2's screendump pattern) → real rendered framebuffer
```

## Error handling

Follows this project's established honesty-first pattern — no silent success:

- **No DHCP lease within a bounded timeout** → boot log shows the failure
  plainly; no `KIOSK_LINUX_NET_OK` marker is printed. Bounded polling loop, not
  a single fixed sleep (mirrors the false-positive lesson learned in
  sub-project 2's DRM marker).
- **`cog` crashing or failing to launch** → no `KIOSK_LINUX_BROWSER_OK` marker;
  raw process stderr/stdout goes to the boot log for diagnosis.
- **Cloudflare's managed challenge blocks WPE WebKit** (real, untested risk —
  per this repo's own `CLAUDE.md`, every path except `/api/health` sits behind a
  Cloudflare managed challenge requiring a JS-solvable bot check, and WPE
  WebKit's TLS/JS fingerprint against that check is unverified). If this
  happens, the screenshot will show the "Just a moment…" challenge page instead
  of the RMPG Flex login screen. This is reported as the real, honest result —
  not treated as a broken build — and documented as a known limitation in
  `kiosk-linux/README.md`, the same way "QEMU/virtio-gpu only, not real
  hardware" is already documented there.

## Testing

Two-tier verification, matching sub-project 2's established pattern:

1. **Boot markers**: `KIOSK_LINUX_NET_OK` (DHCP + curl succeed) and
   `KIOSK_LINUX_BROWSER_OK` (cog process launches and stays alive) via
   `test/assert-boot-log.sh`, same as the existing `KIOSK_LINUX_BOOT_OK` /
   `KIOSK_LINUX_DRM_OK` checks.
2. **Screenshot**: a real QEMU framebuffer capture (`test/run-qemu-browser.sh`,
   modeled on `test/run-qemu-graphics.sh`) showing actual rendered page content —
   either the RMPG Flex login page, or the Cloudflare challenge page if that
   blocks it. Either outcome is a valid, informative capture; script-only
   markers alone are not sufficient proof, consistent with why sub-project 2
   required an actual screenshot rather than trusting `modetest`'s exit code.

QEMU test networking uses `-netdev user` (SLIRP), which gives the guest real
outbound internet access via NAT without any host firewall/bridge configuration
— appropriate for a test harness, not a claim about how a real deployed device
would get network access (that's a real-hardware concern, explicitly deferred).

## Rollout

This is a local build/test-only sub-project — same as sub-projects 1 and 2, it
does not ship through the Cloudflare Workers/Pages deploy pipeline and produces
no user-facing change to the live site. Output remains local build artifacts
under `kiosk-linux/output/images/`, optionally packaged and uploaded to R2 via
the existing manual `kiosk-linux/RELEASE.md` process as a superseding version
once this sub-project's build is verified.
