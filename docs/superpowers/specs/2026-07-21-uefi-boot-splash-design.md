# UEFI Boot Splash (gnu-efi, chainload to Windows)

**Date:** 2026-07-21
**Status:** Approved, pending implementation plan

## Context

Following Desktop Kiosk Shell Mode (which replaces `explorer.exe` as the Windows login
shell so a machine boots straight into the RMPG Flex desktop), the user asked to push
further: for RMPG "to own its full software system and bootloader." A literal
from-scratch bootloader/OS was ruled out during brainstorming — RMPG Flex depends on
Chromium/Node to run at all, and a hand-written bootloader with real hardware support
(disk, USB, networking, graphics) reaching parity with what UEFI/Windows already
provides is a multi-year systems-engineering effort, not a buildable feature here.

This was narrowed, across several brainstorming questions, to something real and
scoped: a custom UEFI application that shows an RMPG-branded splash screen at
power-on, before Windows starts, then chainloads the existing Windows Boot Manager —
which in turn boots into the machine's existing Kiosk Shell Mode. This is the closest
achievable version of "RMPG owns the boot experience" without requiring a from-scratch
OS/bootloader.

## Non-goals

- Not a real bootloader/OS — no disk drivers, filesystem drivers (beyond what UEFI's
  own FAT driver already provides for the ESP), memory management, or process
  scheduling of any kind.
- No Secure Boot signing in this pass — the app is built and tested assuming Secure
  Boot is disabled on target machines (a one-time firmware setting IT sets per
  machine). Signing (Microsoft UEFI CA submission, or custom key enrollment) is a
  separate, later effort if Secure Boot needs to stay on.
- No interactivity — no boot menu, no keypress-to-continue, no configuration UI. The
  splash shows for a fixed duration and always proceeds to chainload.
- No automated installation/deployment tooling — copying the `.efi` onto a machine's
  ESP and registering it as a firmware boot entry is a manual, documented IT/ops step,
  not something this codebase automates (parallel to how Kiosk Shell Mode's Winlogon
  registry write requires per-machine admin action, not a fleet-push mechanism).
- No dual-boot/multi-OS menu logic — the app assumes exactly one Windows install on
  the same ESP and chainloads to it directly.
- Does not replace or modify Desktop Kiosk Shell Mode in any way — this sits strictly
  before it in the boot chain (UEFI splash → Windows Boot Manager → Windows →
  Winlogon shell replacement → RMPG Flex desktop).

## Overview

A small standalone C project, `uefi-bootsplash/`, builds a single `.efi` PE executable
using **gnu-efi** (not the full EDK2 SDK — lighter, standard `gcc`/`clang`
cross-compilation, sufficient for a single splash-and-chainload app). At power-on, if
installed as the machine's default firmware boot entry, this app:

1. Initializes UEFI Graphics Output Protocol (GOP), clears the screen to the RMPG
   Blue & Silver brand colors, and draws a simple centered logo/wordmark.
2. Waits a fixed short duration (2–3 seconds) — no keypress, no menu.
3. Locates the Windows Boot Manager (`\EFI\Microsoft\Boot\bootmgfw.efi`) on the same
   EFI System Partition the splash app itself was loaded from.
4. Uses UEFI's `LoadImage`/`StartImage` to chainload it. Normal Windows boot proceeds
   from there — Kiosk Shell Mode (already built) takes over once Windows loads.
5. If the Windows Boot Manager cannot be found, prints a plain-text error message to
   the UEFI console and halts (`BS->Stall` loop) rather than looping, crashing, or
   attempting any fallback — a clear, debuggable failure rather than a silent one.

## Components

### 1. Splash rendering

Uses the UEFI Graphics Output Protocol (`EFI_GRAPHICS_OUTPUT_PROTOCOL`), obtained via
`BS->LocateProtocol`, to get the current framebuffer mode and draw directly into it.
Colors sourced from the same Blue & Silver values already defined in
[`client/src/styles/theme-palettes.css`](client/src/styles/theme-palettes.css)
(`--surface-base #0c1a2b` background, `--brand-gold #b7c2cf` / silver for the
wordmark) — converted to the raw RGB values GOP needs, since there's no CSS variable
system available in a pre-OS environment. The wordmark itself is a simple
monospace-style bitmap glyph renderer (a small embedded font table), not an image
file — keeps the binary self-contained with no external asset loading step, which
would need a filesystem driver call this app doesn't otherwise need.

### 2. Timing

A fixed wait implemented via `BS->Stall(microseconds)` — no polling for a keypress, no
`WaitForEvent` on the input protocol. This is a deliberate simplification per the
non-interactive scope decision.

### 3. Chainload logic

- Obtain the `EFI_LOADED_IMAGE_PROTOCOL` for the currently-running splash app to find
  its own `DeviceHandle` (the ESP it was loaded from).
- Build a device path pointing at `\EFI\Microsoft\Boot\bootmgfw.efi` on that same
  device handle (this is the standard, well-known path Windows installs its own boot
  manager to on a UEFI system — not a heuristic search, a fixed well-known path).
- Call `BS->LoadImage` with that device path; if it returns success, call
  `BS->StartImage` on the resulting handle. Control passes to the Windows Boot Manager
  and does not return (a normal, successful chainload never returns to this app).
- If `LoadImage` fails (file not found, wrong architecture, etc.), print the specific
  UEFI status code and a human-readable message, then halt via `BS->Stall` in a loop
  — deliberately not a silent black screen, and deliberately not a reboot loop.

### 4. Build system

A `Makefile` (matching how gnu-efi projects conventionally build — cross-compiling
with `-fpic -ffreestanding -fno-stack-protector -fno-stack-check -fshort-wchar
-mno-red-zone` and linking against gnu-efi's `crt0-efi-x86_64.o` / `elf_x86_64_efi.lds`)
produces `BOOTX64.EFI` (or a custom-named `.efi`; the manual installation doc
specifies exactly how it's registered as a firmware boot entry either way).

## Data flow

```
Power on
  → Firmware boot manager loads this app's .efi (per its registered boot entry)
  → App initializes GOP, draws Blue & Silver splash + RMPG wordmark
  → BS->Stall(2-3 seconds)
  → App reads its own EFI_LOADED_IMAGE_PROTOCOL to find its ESP device handle
  → App builds device path for \EFI\Microsoft\Boot\bootmgfw.efi on that handle
  → BS->LoadImage + BS->StartImage
  → [success] control passes to Windows Boot Manager — this app's job is done
  → [failure] print UEFI status + message to console, halt via BS->Stall loop
```

## Error handling

- Missing/renamed Windows Boot Manager file: `LoadImage` returns a UEFI error status
  (e.g. `EFI_NOT_FOUND`); the app prints that status code plus a plain-English
  message ("Could not find Windows Boot Manager at \EFI\Microsoft\Boot\bootmgfw.efi")
  and halts — an IT technician sees exactly what's wrong on the physical screen.
- GOP not available (extremely rare on modern UEFI firmware, but possible on some
  virtual/embedded firmware): falls back to UEFI's basic text-mode console output
  (`ConOut->OutputString`) for both the "wordmark" (as plain text) and any error
  message, so the app never crashes or blank-screens purely because graphics mode
  isn't available — it degrades to text, not failure.
- No retry loops, no reboot-on-failure behavior of any kind — this app either
  chainloads successfully (and doesn't return) or halts visibly. It does not touch
  any firmware boot-order settings itself; that stays a manual IT step.

## Testing

- **Real verification is possible here**, unlike Kiosk Shell Mode's Windows-registry
  work: `qemu-system-x86_64` plus the OVMF UEFI firmware build (both installable via
  Homebrew on macOS) can boot the compiled `.efi` in a virtual machine, rendering the
  actual splash screen and exercising the real GOP/chainload code paths.
- The chainload logic is tested against a **dummy stand-in `.efi`** placed at the
  well-known path inside a scratch virtual ESP image (there is no real Windows install
  available in this dev environment) — this verifies the device-path construction and
  `LoadImage`/`StartImage` call succeeds against *some* target file at that path, which
  is the actual logic this app owns; it does not verify chainloading a genuine Windows
  Boot Manager binary specifically, since none is available to test against here.
- The "Windows Boot Manager not found" error path is tested by pointing the same setup
  at an ESP image with no file at that path, confirming the app prints its error and
  halts rather than crashing or looping.
- **Constraint, called out explicitly**: booting into a *real* Windows install via this
  chainload path, and any Secure Boot interaction, cannot be verified in this
  environment — that requires a real Windows machine with Secure Boot disabled, per
  the Non-goals section. The plan will include a manual verification checklist for
  that, the same pattern used for Kiosk Shell Mode's `[WINDOWS-UNVERIFIED]` items.

## Rollout

This is a standalone artifact (`BOOTX64.EFI` or similarly named file) — it does not
ship through the existing `deploy.yml`/Cloudflare pipeline, the Electron
`electron-builder` pipeline, or any existing release channel. It's a small,
independently-built binary that IT copies onto a machine's ESP and registers as a
firmware boot entry, documented as a manual per-machine procedure (matching how Kiosk
Shell Mode's registry change is also a manual, deliberate per-machine action, not an
automatic fleet rollout). First real-machine validation should happen on a single
non-production test laptop with Secure Boot disabled, never a production
patrol/dispatch machine first.
