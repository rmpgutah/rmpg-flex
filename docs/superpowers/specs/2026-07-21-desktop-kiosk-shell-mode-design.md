# Desktop Kiosk Shell Mode (Windows)

**Date:** 2026-07-21
**Status:** Approved, pending implementation plan

## Context

The user asked for the "Desktop" feature to become "a functional OS for any Windows
running computer, that can be the actual OS." Literally replacing Windows (bootloader,
kernel, drivers) is out of scope for a web/Electron app — an Electron app always runs
on top of Windows, never in place of it. During brainstorming, this was narrowed to
the closest real equivalent: Windows' own **custom shell** mechanism, where
`explorer.exe` is replaced as the login shell (`HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\
Windows NT\CurrentVersion\Winlogon\Shell`) so a dedicated patrol/dispatch machine boots
straight into the existing RMPG Flex desktop (`DesktopPage.tsx` — already a full
Windows-desktop-style shell: icon grid, taskbar, floating windows, widgets, wallpaper)
with no Windows Explorer, taskbar, or Start Menu underneath.

This is one sub-project. Related but out-of-scope follow-ons the user did not ask for
here: remote/MDM-pushed kiosk provisioning, auto-login/device-bound credentials, and
further in-app desktop-simulation features (file system, more built-in apps).

## Non-goals

- Not a Windows replacement at the OS level — no bootloader, kernel, or driver work.
- No changes to macOS/Linux desktop app behavior — Winlogon shell replacement is a
  Windows-only concept; this feature is inert (hidden/disabled) on other platforms.
- No remote/MDM push mechanism for enabling kiosk mode across a fleet — v1 is a
  single-machine, locally-triggered admin toggle only.
- No changes to the login flow itself — kiosk mode changes what happens *around* the
  existing app window (fullscreen, no Windows chrome), not how a user authenticates
  into RMPG Flex.

## Overview

An admin/manager-role user, sitting at the machine to be converted, opens the existing
Desktop Settings app and enables "Kiosk Mode." This triggers an elevated helper that
rewrites the Winlogon shell registry key to point at the RMPG Flex executable, after an
explicit confirmation dialog. On next boot, `main.js` detects it is running as the
system shell and opens the main window in true OS kiosk mode (frameless, fullscreen,
`kiosk: true`) instead of its normal windowed mode. An admin-gated global-shortcut +
password escape hatch reverts the registry key and restores normal Windows behavior.
A self-revert safety net protects against bricking the machine if the app fails to
load repeatedly.

## Components

### 1. Admin toggle — `DesktopSettingsApp.tsx`

A new category (or a section within an existing one — implementation plan decides,
following the existing `CATEGORIES` pattern in
[`DesktopSettingsApp.tsx`](client/src/components/desktop/DesktopSettingsApp.tsx)),
visible only when `isAdmin` (mirrors the existing admin gate in `DesktopPage.tsx`) AND
`window.electron?.platform === 'win32'` (the existing preload exposes platform info;
implementation plan confirms the exact accessor). Shows:
- Current state (Off / On, and — if on — a note that this machine boots directly into
  RMPG Flex).
- An "Enable Kiosk Mode" button that opens a confirmation dialog explaining: the
  machine will restart, Windows Explorer will no longer load normally, and how to
  escape (hotkey shown here, not hidden — this is an operational safety document, not
  a security-through-obscurity scheme).
- A "Disable Kiosk Mode" button (same confirmation-then-restart flow) available from
  within a booted kiosk session (reachable via the Settings app, which is itself
  reachable via the normal desktop UI) as the primary, friendly way out — the hotkey
  is the emergency fallback, not the only way back.

### 2. IPC channel — `device:set-kiosk-shell` (main.js / preload.js / ipcGuard.js)

Follows the existing `device:set-auto-launch` pattern exactly:
- `preload.js`: `setKioskShell: (enabled) => ipcRenderer.invoke('device:set-kiosk-shell', enabled)`, plus `getKioskShellState: () => ipcRenderer.invoke('device:kiosk-shell-state')`.
- `ipcGuard.js`: add validation/rate-limiting for the new channel alongside the other
  `device:*` guards, and register it in the existing IPC handler audit
  (`auditIpcHandlerRegistry`).
- `main.js` handler:
  - Rejects immediately on non-Windows (`process.platform !== 'win32'`).
  - Requires the renderer-supplied caller to already be authenticated as an
    admin/manager (session identity extracted the same way other sensitive IPC calls
    validate role — see `extractSessionIdentity`/`isReconLaunchAuthorized` for the
    existing pattern of gating privileged IPC on the live session's role).
  - Delegates the actual registry write to a small elevated helper process (a
    separate `.exe`/PowerShell script invoked via Windows' UAC elevation prompt,
    since the main Electron process does not run elevated) — implementation plan
    picks the concrete mechanism (`ShellExecute` with `runas` verb is the standard
    approach).
  - On success, prompts the user (native dialog) to restart now or later.

### 3. Kiosk boot path — `main.js`

At startup, before creating `mainWindow`, check whether this process is running as
the system shell (e.g. via a marker written alongside the registry change, or by
checking the registry value itself — implementation plan decides the most reliable
signal, since command-line args alone aren't a trustworthy indicator of *why* the
process started).

When in shell mode:
- `BrowserWindow` opens with `kiosk: true, frame: false, fullscreen: true, autoHideMenuBar: true` instead of the normal `width/height/minWidth/minHeight` windowed config.
- Skip `restoreWindowBounds` (there's no "last position" concept in kiosk mode).
- `Menu.setApplicationMenu(null)` — no native menu bar at all, not even hidden.
- The renderer boots to the normal login flow → `DesktopPage` exactly as it does
  today; kiosk mode changes window chrome, not in-app routing.
- On graceful app quit in shell mode (which would normally leave the user staring at
  a black screen with no shell running), automatically relaunch the app rather than
  exiting — mirrors how a normal shell (explorer.exe) is expected to always be
  present. Does not apply to the deliberate revert-and-restart path in the escape
  hatch, which explicitly changes the shell key first.

### 4. Escape hatch

- Global shortcut `Ctrl+Alt+Shift+F12` (reuses the existing `registerGlobalShortcut`
  IPC/registration machinery already in `main.js`/`preload.js`), registered only when
  running in shell mode.
- Triggers a native password prompt (a small always-on-top `BrowserWindow`, not a
  renderer route, so it works even if the main app's renderer has crashed or is
  offline). Submits the entered password against the existing live-API admin auth
  check (never validated locally/offline — this is a deliberate exception to the
  desktop app's normal offline-auth support, since granting shell-revert access must
  not be possible from a stolen/offline machine with a cached credential).
- On success: reverts the registry key to `explorer.exe` and prompts restart-now/later,
  identical to the in-app disable flow.
- On failure: rate-limited (reuses `createRateLimiter`, same pattern as other
  sensitive IPC in `ipcGuard.js`) to prevent a password-guessing loop.

### 5. Self-revert safety net

Main process persists a small boot-attempt counter (via the existing `getConfig`/
`setConfig` local-DB helpers, or a plain JSON file if the local DB is unavailable —
mirrors the existing lazy-load fallback pattern for `localDb.js` at the top of
`main.js`) each time it starts in shell mode. If the app fails to reach a
successfully-loaded state (main window `ready-to-show` never fires, or the app
crashes) more than 3 times in a row, the *next* boot automatically reverts the shell
registry key back to `explorer.exe` before attempting to load anything, and shows a
plain native dialog explaining kiosk mode was disabled after repeated failures. This
counter resets to 0 on any successful load.

## Data flow

```
Admin (in DesktopSettingsApp)
  → toggle "Enable Kiosk Mode"
  → confirmation dialog (renderer)
  → IPC device:set-kiosk-shell(true)
  → main.js validates admin role from live session
  → spawns elevated helper (UAC prompt)
  → helper writes Winlogon\Shell registry key
  → main.js resets boot-attempt counter to 0
  → native "Restart now?" dialog

[Machine reboots]

main.js startup
  → detects shell-mode marker
  → increments boot-attempt counter
  → if counter > 3: revert key, show dialog, load normally instead
  → else: create BrowserWindow with kiosk:true, load REMOTE_SERVER_URL
  → on ready-to-show: reset counter to 0
  → registers Ctrl+Alt+Shift+F12 global shortcut

[Officer works normally in RMPG Flex desktop]

Escape hatch:
  Ctrl+Alt+Shift+F12
  → always-on-top password prompt window
  → live API admin-credential check (never offline)
  → on success: revert registry key, "Restart now?" dialog
  → on failure: rate-limited retry
```

## Error handling

- Non-Windows platforms: the Settings UI never shows the kiosk toggle; the IPC
  handler rejects defensively if somehow invoked anyway.
- Elevation (UAC) denied or the helper process fails: `device:set-kiosk-shell`
  returns `{ ok: false, error }`, no registry change occurs, user sees an inline
  error in Settings — never a silent no-op.
- Registry write succeeds but the machine never reboots (user picks "later"): app
  keeps running normally in its current window until the next natural restart;
  nothing forces an immediate reboot.
- Repeated load failure in shell mode: handled by the self-revert safety net above —
  this is the critical guard against bricking a machine.
- Escape-hatch password check has no network: the check fails closed (cannot revert
  offline) — documented clearly in the admin-facing confirmation dialog so nobody
  enables kiosk mode on a machine expected to run disconnected for long stretches
  without understanding this tradeoff.

## Testing

- Pure helper functions (registry-key value builder, boot-attempt-counter logic,
  hotkey/accelerator validation, elevated-helper argument construction) get
  `node --test` unit tests in `desktop/__tests__/`, following the existing pattern for
  `windowManager.js`/`fileOps.js`/`deviceInfo.js`.
- **Constraint**: this repo's dev/build environment is macOS. The actual Winlogon
  shell swap, UAC elevation flow, and kiosk `BrowserWindow` behavior can only be
  verified by installing the built app on a real Windows machine — that verification
  is out of scope for this implementation session and must happen separately before
  this ships to any patrol/dispatch machine. The plan will call this out explicitly
  rather than claim Windows-side behavior is verified when it isn't.

## Rollout

Ships behind the existing desktop-app release channel (`electron-builder` /
`AppUpdater`, same as every other desktop feature) — no separate installer, per the
"admin toggle inside the app" decision. First real-machine validation should happen
on a single non-production test laptop before any patrol/dispatch machine is
converted.
