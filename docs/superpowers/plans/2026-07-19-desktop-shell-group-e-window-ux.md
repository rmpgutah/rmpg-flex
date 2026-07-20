# Desktop Shell — Group E (Window/UX/Notifications) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `desktop/main.js` (and `desktop/preload.js`) with the 10 Window/UX/Notifications functions for the RMPG Flex desktop shell (secondary-window management, dock/taskbar badge + flash, tray shift-status, window-bounds persistence, fullscreen toggle, clipboard access) — per Group E of the 10-group sequence in [`docs/superpowers/specs/2026-07-18-desktop-shell-functions-and-hardening-design.md`](../specs/2026-07-18-desktop-shell-functions-and-hardening-design.md) (spec functions #41-50). This is the last Section-1 group per the spec's own sequencing note.

**Architecture:** No new capability module — per the spec's own file-placement table, this group "extends `main.js`" directly (unlike Groups A/B/C/D, which each got a new `desktop/*.js` file). Pure/testable logic (input coercion, enum validation, URL-path validation, bounds sanitization) is still extracted into small, exported, DI-testable functions — placed in `desktop/main.js` itself near their usage (this file already has non-trivial logic living inline, e.g. `PRINT_OVERRIDE_JS`), OR, if a function is substantial and cleanly separable, a new `desktop/windowManager.js` capability module is acceptable — **implementer's call per task, document the choice**. This branch is stacked on the current tip of `main` (which already includes Groups G/F/H/A/B/D, merged; Group C, #2864, still open but independent — this group doesn't touch `sync:*`/`localDb.js`'s sync tables, so no dependency wait was needed).

**Tech Stack:** Plain Node.js (CommonJS), Electron's `BrowserWindow`/`app`/`clipboard`/`screen`/`Tray` APIs, `node:test` + `node:assert/strict`.

## Global Constraints

- Match existing `desktop/main.js` conventions: CommonJS, no TypeScript, `guardedHandle`/`guardedOn` for every new IPC registration (never raw `ipcMain.handle`/`on`).
- **Scope decision on `openSecondaryWindow`'s `path` parameter — read before implementing Task 1**: the spec's signature is `(path, opts) => {id}`. A secondary window must NOT be able to load an arbitrary renderer-supplied URL — that would be a navigation-hijack vector via IPC, the exact class of issue Group F's `shouldAllowNavigation`/`shouldAllowNewWindow` exist to close for the main window. `path` must be treated as an in-app ROUTE (e.g. `/dispatch-board`), never a full URL, and resolved against the SAME trusted base the main window loads from (`REMOTE_SERVER_URL`/`TRUSTED_HOST` — read how `createMainWindow()` currently constructs its load URL and reuse that exact base). Reject any `path` containing a scheme (`http:`, `https:`, `javascript:`, `file:`, `//`) or otherwise not a simple relative path starting with `/`.
- **Scope decision on `setTrayStatus`**: the existing `createTray()` (search `desktop/main.js`) uses a single static icon (`getIconPath()`) with no per-status icon variants currently shipped as assets. This plan implements shift-state reflection via `tray.setToolTip(...)` (and optionally the context-menu label) rather than icon-swapping, since no distinct status icons exist to swap to. Document this explicitly; icon-swapping is a follow-up if/when status-specific icon assets are added.
- **Scope decision on `setDockBadge`**: Electron's cross-platform badge API (`app.setBadgeCount(count)`) works on Linux/macOS; Windows has no equivalent via this API (would need a custom taskbar overlay icon, a meaningfully larger feature). This plan calls `app.setBadgeCount()` where the platform supports it and no-ops elsewhere — matching the "gracefully degrade on unsupported platforms" pattern already established by Group A's `getBatteryStatus`.
- **Scope decision on `setClipboardText`'s stated enforcement**: the spec says this function's contract includes "never called with secret values (enforced by `sessionAuth.disableClipboardAutoSyncOfSecrets`)" — but `desktop/security/sessionAuth.js` does not exist yet; it's Group I's file, and Group I comes AFTER Group E in the dependency-ordered sequence (per the spec's own note that Group I "depends on Groups A-E existing"). This plan implements `setClipboardText` as a plain, unenforced wrapper around `clipboard.writeText()` — the described secret-value guard is Group I's responsibility to wire in later, matching the "unwired, for a future group" pattern already used repeatedly across this program (e.g. Group A wiring Group H's `encryptDiagnosticsBundleOnExport`, Group C wiring Group H's `upsertUserWithEncryptedHash`).
- **Scope decision on window-bounds persistence**: `saveWindowBounds`/`restoreWindowBounds` use `localDb.js`'s existing `getConfig`/`setConfig` key-value helpers (already imported in `main.js`) under a new key `'main_window_bounds'`, storing `JSON.stringify({x,y,width,height})` — reusing the existing persistence mechanism rather than introducing a new one (e.g. `electron-store`). `restoreWindowBounds()` must validate the restored bounds still intersect a currently-connected display (via Electron's `screen.getAllDisplays()`) before using them — a saved position from a since-disconnected external monitor must not restore the window off-screen and unreachable.
- Commit after each task.

---

### Task 1: `openSecondaryWindow` + `closeSecondaryWindow`

**Files:**
- Modify: `desktop/main.js`, `desktop/preload.js`
- Test: `desktop/__tests__/main.windowUx.test.js` (new — pure helpers only, no real `BrowserWindow`)

**Interfaces:**
- `buildSecondaryWindowUrl(baseUrl, routePath)` — pure. Throws (or returns `{ok:false,error}` — implementer's call, document it) if `routePath` doesn't start with `/`, or contains `:` (catches `http:`, `javascript:`, `file:`, protocol-relative `//`) anywhere before the first legitimate path segment. Otherwise returns `` `${baseUrl}${routePath}` ``. Export it (from `main.js` or a new small module — see Global Constraints).
- Module-level `const secondaryWindows = new Map();` (id → `BrowserWindow` instance) in `main.js`, alongside the existing `let mainWindow`/`let tray` module state.
- `guardedHandle('window:open-secondary', (event, routePath, opts) => {...})`: validates `routePath` via `buildSecondaryWindowUrl`, on failure returns `{ok:false, error}`; on success creates a new `BrowserWindow` using `hardenWebPreferencesDefaults({ preload: resolveTrustedPreloadPath(...) })` (the SAME hardening + trusted-preload-path helpers `createMainWindow()` already uses — read that function's current exact `BrowserWindow` constructor call for the pattern to mirror), loads the built URL, generates an `id` (e.g. `require('crypto').randomUUID()`), stores it in `secondaryWindows`, removes it from the map on the window's own `'closed'` event, returns `{id}`.
- `guardedHandle('window:close-secondary', (event, id) => { const win = secondaryWindows.get(id); if (win && !win.isDestroyed()) win.close(); })`.
- Preload: `openSecondaryWindow: (path, opts) => ipcRenderer.invoke('window:open-secondary', path, opts)`, `closeSecondaryWindow: (id) => ipcRenderer.invoke('window:close-secondary', id)`.

- [ ] **Step 1: Write failing tests** for `buildSecondaryWindowUrl`: valid relative path → correct concatenation; missing leading `/` → rejected; `http://evil.example.com` → rejected; `javascript:alert(1)` → rejected; `//attacker.example.com` (protocol-relative) → rejected.
- [ ] **Step 2: Run tests, verify they fail.**
- [ ] **Step 3: Implement `buildSecondaryWindowUrl`.**
- [ ] **Step 4: Run tests, verify they pass.**
- [ ] **Step 5: Wire `window:open-secondary`/`window:close-secondary` into `main.js`**, reading `createMainWindow()`'s current exact `BrowserWindow` options first to mirror the hardening setup faithfully (don't hand-guess the `webPreferences` shape).
- [ ] **Step 6: Wire into `preload.js`.**
- [ ] **Step 7: `node --check`, run the test suite, commit.**

---

### Task 2: `setDockBadge`

**Files:**
- Modify: `desktop/main.js`, `desktop/preload.js`
- Test: `desktop/__tests__/main.windowUx.test.js`

**Interfaces:**
- `coerceBadgeCount(count)` — pure. Returns a non-negative integer: `Math.max(0, Math.floor(Number(count) || 0))`, capped at some reasonable upper bound (e.g. `Math.min(..., 9999)` — pick a sane cap and document it, spec just says "bounded integer").
- `guardedHandle('notify:dock-badge', (event, count) => { const n = coerceBadgeCount(count); if (app.setBadgeCount) app.setBadgeCount(n); })` — `app.setBadgeCount` exists on Linux/macOS; guard its presence before calling (matches the "no-op on unsupported platforms" scope decision).
- Preload: `setDockBadge: (count) => ipcRenderer.invoke('notify:dock-badge', count)`.

- [ ] **Step 1: Write failing tests** for `coerceBadgeCount`: negative → `0`; non-numeric → `0`; float → floored; above the cap → clamped to the cap.
- [ ] **Step 2-4: Fail → implement → pass.**
- [ ] **Step 5: Wire `notify:dock-badge` into `main.js`.**
- [ ] **Step 6: Wire into `preload.js`.**
- [ ] **Step 7: `node --check`, run the test suite, commit.**

---

### Task 3: `flashFrame`

**Files:**
- Modify: `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- `guardedHandle('notify:flash-frame', () => { mainWindow?.flashFrame(true); })`.
- Also wire a `mainWindow.on('focus', () => mainWindow.flashFrame(false))` listener inside `createMainWindow()` (near the existing `'close'`/`'closed'` listeners) so the flash auto-clears when the officer actually looks at the window — matching standard desktop-app UX for attention flashes (read Electron's `flashFrame` semantics: it keeps flashing until either focus is given natively by the OS in some cases, or explicitly cleared via `flashFrame(false)` — the explicit clear-on-focus listener is the reliable cross-platform behavior).
- Preload: `flashFrame: () => ipcRenderer.invoke('notify:flash-frame')`.

- [ ] **Step 1: Wire `notify:flash-frame` into `main.js`** — thin wiring only, no new pure function (real Electron `BrowserWindow` behavior, not independently unit-testable without a live window — matches how other "wraps a single Electron API call with no branching logic" functions in this program went untested at the `main.js` layer, e.g. Group A's `restartApp`).
- [ ] **Step 2: Add the focus-clears-flash listener to `createMainWindow()`.**
- [ ] **Step 3: Wire into `preload.js`.**
- [ ] **Step 4: `node --check`, commit.**

---

### Task 4: `setTrayStatus`

**Files:**
- Modify: `desktop/main.js`, `desktop/preload.js`
- Test: `desktop/__tests__/main.windowUx.test.js`

**Interfaces:**
- `isValidTrayStatus(state)` — pure. Returns `true` only for the exact strings `'on-shift'`, `'off-shift'`, `'alert'` (a genuine enum check — reject anything else, including near-matches or extra whitespace).
- `formatTrayTooltip(state)` — pure. Maps each valid state to a human-readable tooltip string (e.g. `'RMPG Flex — On Shift'` / `'RMPG Flex — Off Shift'` / `'RMPG Flex — ALERT'`); throws or returns a fallback for an invalid state (the caller validates first via `isValidTrayStatus`, so this should not normally be reached with bad input, but don't let it silently produce a blank tooltip either).
- `guardedHandle('notify:tray-status', (event, state) => { if (!isValidTrayStatus(state)) return; if (tray) tray.setToolTip(formatTrayTooltip(state)); })` — void return per spec, silently no-ops on invalid input or if `tray` hasn't been created yet (matches the fail-safe pattern used elsewhere, e.g. `fs:reveal`'s validation-failure handling).
- Preload: `setTrayStatus: (state) => ipcRenderer.invoke('notify:tray-status', state)`.

- [ ] **Step 1: Write failing tests** for `isValidTrayStatus` (all 3 valid values → true; invalid strings, empty string, non-string → false) and `formatTrayTooltip` (each of the 3 valid states → the expected string).
- [ ] **Step 2-4: Fail → implement → pass.**
- [ ] **Step 5: Wire `notify:tray-status` into `main.js`**, reading the existing `createTray()`'s current tray-creation code first to confirm the module-level `tray` variable's exact name/scope.
- [ ] **Step 6: Wire into `preload.js`.**
- [ ] **Step 7: `node --check`, run the test suite, commit.**

---

### Task 5: `saveWindowBounds` + `restoreWindowBounds`

**Files:**
- Modify: `desktop/main.js`
- Test: `desktop/__tests__/main.windowUx.test.js`

**Interfaces:**
- `boundsIntersectSomeDisplay(bounds, displays)` — pure. Given `{x,y,width,height}` and an array of Electron `Display` objects (each with a `.bounds` rectangle), returns `true` if the window's rectangle overlaps at least one display's rectangle (simple AABB intersection test), `false` otherwise (e.g. bounds from a disconnected second monitor). Export it.
- `saveWindowBounds(win, setConfigFn)` — takes the `BrowserWindow` and `setConfig` as parameters (DI-testable, even though this lives in `main.js` — the function itself doesn't need to close over module state): `setConfigFn('main_window_bounds', JSON.stringify(win.getBounds()))`. Not exported for IPC (per spec, "main-internal" — no renderer trigger).
- `restoreWindowBounds(getConfigFn, getAllDisplaysFn)` — takes `getConfig` and `screen.getAllDisplays` as parameters: reads `'main_window_bounds'`, `JSON.parse`s it (wrapped in try/catch — malformed/missing data returns `null`, never throws), validates via `boundsIntersectSomeDisplay` against `getAllDisplaysFn()`'s result, returns the parsed `{x,y,width,height}` object if valid, `null` otherwise. Not exported for IPC.
- Wire `saveWindowBounds` into `createMainWindow()`'s existing `mainWindow.on('close', ...)` handler (the one that currently does `event.preventDefault(); mainWindow.hide();` — add the bounds-save call there, since it fires on every hide-to-tray, which is a reasonable persistence point) AND add new `mainWindow.on('resize', ...)`/`mainWindow.on('move', ...)` listeners — these fire very frequently, so DEBOUNCE the actual `setConfig` write (e.g. a simple `setTimeout`-based debounce, ~500ms, cleared/reset on each event) rather than writing to the DB on every pixel of drag.
- Wire `restoreWindowBounds()`'s result into `createMainWindow()`'s `BrowserWindow` constructor call: if it returns non-null bounds, spread `{x, y, width, height}` into the constructor options (overriding the hardcoded `width: 1440, height: 900` defaults only when a valid saved value exists); if `null`, fall back to the existing hardcoded defaults unchanged.

- [ ] **Step 1: Write failing tests** for `boundsIntersectSomeDisplay`: bounds fully within a display → true; bounds fully outside all displays → false; bounds partially overlapping a display edge → true (a window mostly off-screen but with SOME visible/draggable area should still count as recoverable — use your judgment on the exact overlap threshold, document it).
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3: Implement `boundsIntersectSomeDisplay`, `saveWindowBounds`, `restoreWindowBounds` in `main.js`.** Export the pure `boundsIntersectSomeDisplay` for testing; the other two can stay module-local (used only within `createMainWindow()`/its listeners) if that's cleaner, or exported too — implementer's call.
- [ ] **Step 4: Run test, verify it passes.**
- [ ] **Step 5: Write a failing test for `restoreWindowBounds`** using fake `getConfigFn`/`getAllDisplaysFn`: valid stored bounds intersecting a fake display → returns the parsed bounds; malformed JSON → returns `null`; valid JSON but bounds outside all fake displays → returns `null`.
- [ ] **Step 6: Run, implement/adjust, pass.**
- [ ] **Step 7: Wire the debounced resize/move listeners and the close-handler save call, and the restore-on-create call, into `createMainWindow()`** — read its current exact code (from Task 1's step, already fresh) before editing.
- [ ] **Step 8: `node --check`, run the test suite, commit.**

---

### Task 6: `toggleFullScreen`

**Files:**
- Modify: `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- `guardedHandle('window:toggle-fullscreen', () => { mainWindow?.setFullScreen(!mainWindow.isFullScreen()); })`.
- Preload: `toggleFullScreen: () => ipcRenderer.invoke('window:toggle-fullscreen')`.

- [ ] **Step 1: Wire `window:toggle-fullscreen` into `main.js`** — trivial, thin wiring only, no new pure function (same "not independently testable without a live window" reasoning as Task 3).
- [ ] **Step 2: Wire into `preload.js`.**
- [ ] **Step 3: `node --check`, commit.**

---

### Task 7: `getClipboardText` + `setClipboardText`

**Files:**
- Modify: `desktop/main.js`, `desktop/preload.js`

**Interfaces:**
- `guardedHandle('clipboard:get', () => clipboard.readText())` — `clipboard` from `require('electron')`, add to the top-of-file destructure (check whether it's already imported; if not, add it there — do not add a second `require('electron')` line).
- `guardedHandle('clipboard:set', (event, text) => { clipboard.writeText(String(text)); })` — per the Global Constraints scope decision, this is a PLAIN wrapper with NO secret-value enforcement (that's Group I's future responsibility) — do not attempt to guess at or half-implement `sessionAuth.disableClipboardAutoSyncOfSecrets`'s logic here.
- Preload: `getClipboardText: () => ipcRenderer.invoke('clipboard:get')`, `setClipboardText: (text) => ipcRenderer.invoke('clipboard:set', text)`.

- [ ] **Step 1: Confirm whether `clipboard` is already in `main.js`'s `require('electron')` destructure** (`grep -n "require('electron')" desktop/main.js`) — extend it if not, don't duplicate the require line.
- [ ] **Step 2: Wire `clipboard:get`/`clipboard:set` into `main.js`** — thin wiring, no new pure function (direct Electron API wraps).
- [ ] **Step 3: Wire into `preload.js`.**
- [ ] **Step 4: `node --check`, commit.**

---

### Task 8: Final verification pass

**Files:** none (verification only, no production code changes)

- [ ] Run the full `desktop` test suite: `node --test desktop/__tests__/*.test.js` — expect all prior-group tests still passing plus this group's new cases.
- [ ] `node --check` on `main.js` and `preload.js`.
- [ ] Confirm exactly 8 new IPC channels are registered in `main.js` (2 `window:*` open/close-secondary + `notify:dock-badge` + `notify:flash-frame` + `notify:tray-status` + `window:toggle-fullscreen` + `clipboard:get` + `clipboard:set` = 8 — `saveWindowBounds`/`restoreWindowBounds` are main-internal, no IPC channel, per spec) via `grep -c "guardedHandle('window:\|guardedHandle('notify:\|guardedHandle('clipboard:" desktop/main.js`, and that all 8 are exposed in `preload.js`.
- [ ] Confirm `auditIpcHandlerRegistry` has nothing new to flag.
- [ ] Confirm no duplicate `require(...)` lines were introduced for `./security/ipcGuard`, `./security/sessionHardening`, `./localDb`, or `electron` in `main.js` across all of Tasks 1-7.
- [ ] Update the progress ledger, mark Group E complete.
