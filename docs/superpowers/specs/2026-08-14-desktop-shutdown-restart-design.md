# Desktop — Shut Down, Restart, Return to Windows

**Date:** 2026-08-14  
**Scope:** Electron desktop only (Windows Toughbooks)  
**Status:** Approved for implementation

---

## Overview

Add three OS-level power actions to the FlexOS Power Menu:

| Action | Who sees it | Auth required |
|---|---|---|
| Shut Down | All Windows Electron users | Native confirm dialog (main process) |
| Restart | All Windows Electron users | Native confirm dialog (main process) |
| Return to Windows | Kiosk-shell users only | Live admin/manager API credential check |

All three are no-ops (return `{ ok: false, error: 'not_supported' }`) on non-Windows platforms.

---

## Component 1 — IPC Handlers (`desktop/main.js`)

### `os:shutdown` and `os:restart`

Registered via `guardedHandle` (trusted remote origin).

Flow:
1. Platform guard — return `not_supported` on non-win32.
2. Show `dialog.showMessageBox` (native confirm) with "Shut Down in 5 seconds — cancel with `shutdown /a`" or "Restart in 5 seconds — cancel with `shutdown /a`".
3. If operator clicks Cancel → return `{ ok: false, error: 'cancelled' }` with no side effects.
4. If operator confirms → `execFile('shutdown.exe', ['/s' | '/r', '/t', '5'], { windowsHide: true })`.
5. Return `{ ok: true }` on execFile success; `{ ok: false, error: err.message }` on failure.

Rate limiting: shared `checkRateLimit` (existing 10-calls/min general limiter is sufficient — shutdown is not a hot path).

### `os:return-to-windows`

Registered via `guardedHandle` (trusted remote origin — NOT `guardedLocalFileHandle`, which is for `file://` callers like `kioskEscape.html`).

Dedicated rate limiter: `createRateLimiter(5, 60_000)` — same ceiling as the existing `kioskEscapeRateLimiter`.

Flow:
1. Platform guard — return `not_supported` on non-win32.
2. Kiosk guard — if `getConfig('kiosk_shell_enabled') !== true`, return `{ ok: false, error: 'not_in_kiosk_mode' }`.
3. Rate limit check via the dedicated limiter.
4. Validate credential shape via `validateKioskEscapeCredentials(username, password)`.
5. POST `{ username, password }` to `KIOSK_ESCAPE_API_BASE/api/auth/login` (same host-allowlist guard as `kiosk:attempt-escape` — reuses `KIOSK_ESCAPE_API_HOSTNAME`).
6. Parse response with `validateEscapeLoginResponse` — requires `admin` or `manager` role.
7. On valid credentials: set `kioskDeliberatelyReverting = true`, call `deleteHkcuShell()`.
8. On `deleteHkcuShell` success: `setConfig('kiosk_shell_enabled', false)`, `setConfig('kiosk_boot_attempts', resetBootAttemptState())`.
9. Show `dialog.showMessageBoxSync` — "Kiosk Mode disabled. Restart to return to Windows desktop."
10. Return `{ ok: true }`.
11. All error paths: un-latch `kioskDeliberatelyReverting` if it was set and the revert failed (same defensive pattern as the existing `kiosk:attempt-escape` handler). Return `{ ok: false, error }`.

Security audit events logged (via `logSecurityAuditEvent`) at: rate-limit denial, credential validation result, registry revert success/failure.

---

## Component 2 — Preload Bridge (`desktop/preload.js`)

Three new entries on the `window.electron` contextBridge object:

```js
shutdownOs:        () => ipcRenderer.invoke('os:shutdown'),
restartOs:         () => ipcRenderer.invoke('os:restart'),
returnToWindows:   (username, password) => ipcRenderer.invoke('os:return-to-windows', username, password),
```

These sit alongside the existing `restartApp` (which restarts the Electron process, not the OS) and `setKioskShell` entries in the System/Device sections.

---

## Component 3 — FlexOS Power Menu (`client/src/components/desktop/FlexOSPowerMenu.tsx`)

### New state

```ts
const [kioskActive, setKioskActive] = useState(false);
const [view, setView] = useState<'menu' | 'return-to-windows'>('menu');
const [rtw, setRtw] = useState({ username: '', password: '', error: '', loading: false });
```

`kioskActive` is populated once on mount via `window.electron?.getKioskShellState()`. If the IPC fails or returns `supported: false`, it stays `false` (Return to Windows button stays hidden).

### Main menu view

New buttons added below the existing three (Lock, Sign Out, Restart App), but only on Windows:

```
if (platform === 'win32'):
  [ Shut Down ]       (Power icon)      — calls shutdownOs()
  [ Restart ]         (RotateCcw icon)  — calls restartOs()

if (platform === 'win32' && kioskActive):
  [ Return to Windows ] (Monitor icon)  — sets view = 'return-to-windows'
```

Shut Down and Restart call `window.electron.shutdownOs()` / `restartOs()` directly. The main-process `dialog.showMessageBox` handles confirmation — the renderer does nothing further (if the operator clicks Cancel in the native dialog, the IPC resolves `{ ok: false, error: 'cancelled' }` and the power menu stays open).

A visual separator (`<hr>` or equivalent) divides the OS-level actions from the app-level actions (Lock, Sign Out, Restart App).

### Return to Windows sub-panel (`view === 'return-to-windows'`)

Replaces the button list with:

```
← Back
──────────────────────────────
Return to Windows

Admin or manager credentials required.

[ Username input ]
[ Password input ]
[ error text ]
[ Return to Windows ] (submit)
```

On submit:
1. Set `rtw.loading = true`, clear error.
2. Await `window.electron.returnToWindows(username, password)`.
3. On `{ ok: true }`: show a brief "Restarting…" message (the `dialog.showMessageBoxSync` in main blocks; the renderer just shows loading state until the dialog is dismissed and the OS starts rebooting).
4. On `{ ok: false }`: display `result.error` in the error field, re-enable the form.

The sub-panel uses the same `PowerButton` visual style as the rest of the overlay.

---

## Props change

`FlexOSPowerMenuProps` gains no new required props. The kiosk state is fetched internally via IPC on mount (same pattern as `DesktopKioskSettings.tsx`).

---

## What does NOT change

- `DesktopPage.tsx` — zero changes; existing `<FlexOSPowerMenu>` call site is unaffected.
- `kioskEscape.html` / `kioskEscapePreload.js` — the emergency escape hatch for when the renderer is dead remains intact and independent.
- `kiosk:attempt-escape` handler — not modified; the new `os:return-to-windows` duplicates its credential logic rather than refactoring it, keeping the two paths independent (escape hatch must never depend on a channel the renderer can gate).

---

## Tests

- `desktop/__tests__/main.windowUx.test.js` or a new `main.osPower.test.js`: unit tests for the two `os:shutdown` / `os:restart` handlers (mock `execFile`, verify `/s`/`/r` args, verify platform guard).
- `client/src/components/desktop/__tests__/FlexOSPowerMenu.test.tsx` (new): render tests for button visibility by platform/kiosk state, and the credential form state machine (submit → loading → error display path).

---

## Constraints

- `shutdown.exe` is Win32 only — handlers must guard `process.platform !== 'win32'` before spawning.
- The 5-second OS countdown (`/t 5`) is intentional: it gives the operator a brief window to abort with `shutdown /a` if they clicked by mistake after the native confirm dismissed.
- `returnToWindows` always makes a live API call — same policy as `kiosk:attempt-escape`. Offline credentials are never accepted for a kiosk-revert action.
- The rate limiter for `os:return-to-windows` is independent of `kioskEscapeRateLimiter` — they serve different callers and must not share budget.
