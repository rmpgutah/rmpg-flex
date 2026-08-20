# FlexOS — Windows-Style Startup Sequence Design

**Date:** 2026-08-13  
**Status:** Approved  
**Scope:** `desktop/main.js` only — no client, preload, or kioskShell changes

---

## Overview

Replace the current RMPG splash screen with a three-phase Windows-style startup
sequence that mirrors the Windows 11 boot-to-desktop experience while keeping
FlexOS as the active shell. Microsoft background services (OneDrive, Windows
Security, WMI, Entra/Azure AD) are explicitly preserved. The Windows account
identity (name + avatar) is surfaced on the lock screen.

---

## State Machine

A single `BrowserWindow` opened on `app.whenReady()` progresses through three
phases, driven by `ipcMain → webContents.send('splash:phase', { phase, data })`.
The window closes only after Phase 3 completes.

```
Phase 1 — BOOT    → Phase 2 — LOCK    → Phase 3 — WELCOME    → main window shows
```

Two async operations run in **parallel during Phase 1** so Phase 2 is ready the
instant the animation ends:
- `getWindowsAccountInfo()` — Microsoft account name + avatar
- `checkServerConnectivity()` — existing connectivity check (unchanged)

---

## Phase 1 — BOOT (~3 s minimum, or until both parallel operations resolve)

**Visual:**
- Pure black `#000000` background
- RMPG logo centered, 96 px — loaded via existing `getSplashLogoDataUri()`
- Windows 11 spinning-dots animation directly below the logo: 5 dots in a 28 px
  orbit, 5 px each, staggered `animation-delay` — the exact Windows chase
  pattern (not a bar, not a ring)
- `ROCKY MOUNTAIN PROTECTIVE GROUP` in 9 px all-caps silver letterspace, fades
  in at 1.5 s
- No status text, no progress bar — matches Windows boot minimalism

**Timing:** Phase 1 holds until both `connectivityPromise` and
`accountInfoPromise` resolve. Minimum 3 s enforced via a `setTimeout` so the
animation is never clipped on fast hardware.

---

## Phase 2 — LOCK SCREEN

**Visual:**
- Background: FlexOS `--surface-base #22405f` with radial vignette (dark edges,
  lighter center) — mimics Windows frosted lock screen without requiring a
  wallpaper
- **Top third:** time `HH:MM` in 72 px light-weight white; date
  `Thursday, August 13` in 14 px below; both derived from `new Date()` inside
  the HTML, updated via `setInterval` every 30 s
- **Center — user card:**
  - 72 px circular avatar: Windows account picture as base64 data URI sent in
    `splash:phase` payload; falls back to initials rendered in an
    `--accent-silver-400` filled circle
  - Full name from `Get-LocalUser` (`fullName` field, fallback to `name`)
  - `RMPG Flex` in 10 px silver below the name
- **Password field** directly under card: no visible border until focused,
  placeholder `Password`, reveal-eye toggle, Enter key or `→` button submits
- **Error message** inline below field in `--sev-critical` red, replaces
  placeholder text on failure; field clears on each failed attempt
- No "Forgot password" link — officers use the `Ctrl+Alt+Shift+F12` escape
  hatch for lockout recovery

**Non-Windows / dev mode:** `getWindowsAccountInfo()` returns `null`; Phase 2
shows a minimal card with `RMPG Flex` as the display name and the initials
fallback avatar.

---

## Phase 3 — WELCOME (2.5 s, then fade out)

**Visual:**
- Same dark background as Phase 2
- Greeting derived from local hour: "Good morning / afternoon / evening, [First
  Name]" — first name parsed as the first word of the officer's FlexOS
  `user.name` returned by the auth response
- Officer role badge below the greeting: `ADMIN`, `OFFICER`, etc. in a small
  silver pill using `--accent-silver-400`
- 400 ms CSS `opacity` fade-out, then `splash:close` IPC fires →
  `mainWindow.show()` + `mainWindow.focus()`

---

## Data Flow & IPC

### `getWindowsAccountInfo()` — new async function in `main.js`

1. PowerShell `Get-LocalUser $env:USERNAME | Select-Object Name,FullName |
   ConvertTo-Json` — 3 s timeout
2. Searches `%USERPROFILE%\AppData\Roaming\Microsoft\Windows\AccountPictures\`
   for the largest `.png` / `.jpg` by file size; converts to base64 data URI
3. Returns `{ name, fullName, avatarDataUri }` on success
4. Returns `null` on non-`win32` platforms or any error — never throws

Result is cached in a module-level variable; never re-queried after splash
closes.

### IPC channels

| Direction | Channel | Payload |
|---|---|---|
| main → splash | `splash:phase` | `{ phase: 'boot'\|'lock'\|'welcome', data: {...} }` |
| splash → main | `splash:auth` | `{ username, password }` |
| main → splash | `splash:auth-result` | `{ ok: boolean, error?: string, officer?: { name, role } }` |
| main → splash | `splash:close` | — |

All channels registered via `guardedOn` / `guardedHandle` with `TRUSTED_HOST`
validation.

### Auth flow (Phase 2 → Phase 3)

1. Splash sends `splash:auth { username, password }`
2. Main forwards to `POST KIOSK_ESCAPE_API_BASE/api/auth/login` — same
   allowlisted endpoint the escape hatch uses; host validated against
   `KIOSK_ESCAPE_API_HOSTNAME`
3. Response parsed via a **new `validateFlexOsLoginResponse()`** in
   `kioskShell.js` — identical to `validateEscapeLoginResponse()` but accepts
   **all roles** (not just admin/manager), since this is officer sign-in, not
   escape-hatch auth
4. On success: JWT stored via `setConfig('last_session_token')`; main sends
   `splash:auth-result { ok: true, officer: { name, role } }`; splash
   transitions to Phase 3
5. On failure: main sends `splash:auth-result { ok: false, error }`; splash
   shows inline error; field clears

---

## Microsoft Background Service Preservation

`suppressWindowsShellProcesses()` (added in PR #3509) kills only four shell UI
processes. The following Microsoft services are **explicitly never targeted**
and must not be added to that list:

| Process | Service |
|---|---|
| `OneDrive.exe` | File sync |
| `SecurityHealthSystray.exe` | Windows Security |
| `WinStore.App.exe` | Microsoft Store |
| `WmiPrvSE.exe` | WMI provider host |
| `MicrosoftEdgeUpdate.exe` | Edge update service |
| `AADCloudAPPlugin.dll` (svchost) | Entra / Azure AD sync |
| `lsass.exe` | Credential / authentication store |
| `winlogon.exe` | Session manager |

A block comment in `suppressWindowsShellProcesses()` documents this exclusion
list explicitly so future edits cannot accidentally add them.

---

## Implementation Scope

**Only `desktop/main.js` changes.** No changes to:
- `client/` (React SPA)
- `desktop/preload.js`
- `desktop/kioskShell.js` — except adding `validateFlexOsLoginResponse()`
- Any other desktop module

### New / modified functions in `main.js`

| Function | Change |
|---|---|
| `getWindowsAccountInfo()` | New — PowerShell account + avatar lookup |
| `getSplashHTML()` | New — extracted from `createSplashWindow()`, returns full state-machine HTML |
| `createSplashWindow()` | Modified — calls `getSplashHTML()`, window is now 100vw × 100vh frameless |
| `guardedOn('splash:auth', ...)` | New — credential forwarding handler |
| `app.whenReady()` block | Modified — adds `getWindowsAccountInfo()` to parallel startup work |
| `suppressWindowsShellProcesses()` | Modified — add exclusion comment block only |

### New function in `kioskShell.js`

| Function | Purpose |
|---|---|
| `validateFlexOsLoginResponse()` | Like `validateEscapeLoginResponse()` but accepts all roles |

---

## Error & Edge Cases

| Scenario | Behavior |
|---|---|
| No network at boot | Phase 1 plays fully; Phase 2 shows; auth fails with "Unable to reach server"; offline mode note shown |
| PowerShell account lookup fails | `getWindowsAccountInfo()` returns null; Phase 2 shows initials-only card |
| No account picture found | Initials avatar used; no error |
| Wrong password | Inline error in Phase 2; 3 consecutive failures trigger the same lockout as `/api/auth/login` (server-side rate limiting) |
| Phase 1 takes >15 s | Existing `startSplashTimeout(15000)` fires; splash force-closes; main window shows directly |
| Non-Windows platform | Phase 1 and 3 play normally; Phase 2 shows minimal card with no Windows account data |

---

## Testing

- Desktop test suite (`npm test` in `desktop/`) — no new test files required;
  the new pure helper `validateFlexOsLoginResponse()` in `kioskShell.js` gets
  unit tests alongside the existing `validateEscapeLoginResponse()` tests in
  `__tests__/kioskShell.test.js`
- Manual verification on MDT-D19 (FZ-55, win32/x64, OS 10.0.26200):
  - Phase 1 plays ~3 s with spinning dots
  - Phase 2 shows Windows account name + avatar
  - Correct password → Phase 3 → desktop
  - Wrong password → inline error
  - No Windows taskbar or Start Menu visible at any point
