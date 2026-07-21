# Desktop Kiosk Shell Mode (Windows) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin/manager enable "Kiosk Mode" on a Windows RMPG Flex desktop-app
machine so it boots directly into the RMPG desktop instead of Windows Explorer, with a
password-gated escape hatch and an automatic safety net against bricking the machine.

**Architecture:** Pure, unit-testable helper functions in `desktop/kioskShell.js` (registry
value construction, boot-attempt-counter logic, elevated-helper argument building — no
Electron dependency, same pattern as `windowManager.js`/`deviceInfo.js`) are wired into
`main.js` via new `guardedHandle` IPC channels (`device:*`, following the existing
`device:set-auto-launch` pattern) and a small always-on-top escape-hatch `BrowserWindow`.
The renderer side is a new panel in `DesktopSettingsApp.tsx`, admin/manager-gated, that
calls the new IPC through `preload.js`.

**Tech Stack:** Electron (`desktop/`) main process + Node's built-in `child_process` for
the elevated helper, `node:test` for the pure-helper unit tests, React/TypeScript for the
Settings panel (`client/`).

## Global Constraints

- Windows-only feature: the registry/shell-swap machinery must be a no-op (and the UI
  must not appear) on any `process.platform !== 'win32'`.
- Every new IPC channel goes through `guardedHandle`/`guardedOn` — never raw
  `ipcMain.handle`/`ipcMain.on` (see `auditIpcHandlerRegistry` in
  [`desktop/security/ipcGuard.js`](desktop/security/ipcGuard.js), which fails CI-equivalent
  local checks if bypassed).
- Enabling/disabling kiosk mode requires the caller's cached role to be `admin` or
  `manager` — reuse `requireOfflineAuthForSensitiveIpc` pattern from
  [`desktop/security/ipcGuard.js:204`](desktop/security/ipcGuard.js:204), which currently
  only checks `=== 'admin'`; this plan extends the check inline where needed rather than
  broadening the shared helper (see Task 3).
- The escape-hatch password check must NEVER succeed from a cached/offline credential —
  it always makes a live `POST` to `/api/auth/login` and fails closed with no network
  (per spec's Error Handling section).
- The self-revert safety net (boot-attempt counter > 3) is the single most important
  guard in this feature — every task that touches the kiosk boot path must not bypass it.
- Pure helper functions live in `desktop/kioskShell.js` and get `node --test` coverage in
  `desktop/__tests__/kioskShell.test.js`, following the exact style of
  [`desktop/__tests__/deviceInfo.test.js`](desktop/__tests__/deviceInfo.test.js) (`'use
  strict'`, `require('node:test')`/`require('node:assert/strict')`, `assert.deepEqual`).
- This plan's Windows-registry and UAC-elevation behavior CANNOT be verified on this
  repo's macOS dev environment. Every task that touches real Windows APIs is marked
  **[WINDOWS-UNVERIFIED]** and must be manually confirmed on a real Windows machine before
  this ships to any patrol/dispatch device — this is not covered by this plan's test steps.

---

## File Structure

- **Create:** `desktop/kioskShell.js` — pure helpers: registry key value builder, boot-attempt
  counter increment/reset/threshold logic, elevated-helper command-line argument builder,
  escape-hatch password-check request/response shape validation. No Electron dependency.
- **Create:** `desktop/__tests__/kioskShell.test.js` — unit tests for the above.
- **Modify:** `desktop/main.js` — new `device:set-kiosk-shell`, `device:kiosk-shell-state`
  IPC handlers; kiosk-mode `BrowserWindow` creation branch; escape-hatch global shortcut
  registration + always-on-top password-prompt window; boot-attempt-counter check at
  startup.
- **Modify:** `desktop/preload.js` — expose `setKioskShell`, `getKioskShellState` to the
  renderer.
- **Modify:** `desktop/security/ipcGuard.js` — add `validateKioskEscapeCredentials`
  (shape-validates the escape-hatch prompt's username/password before it's sent anywhere),
  registered alongside the other pure validators.
- **Create:** `client/src/components/desktop/DesktopKioskSettings.tsx` — the admin-only
  Settings panel: current state, enable/disable buttons, confirmation dialog, inline error
  display. Kept as its own file (not inlined into the already-large
  `DesktopSettingsApp.tsx`) so it has one clear responsibility and stays easy to hold in
  context.
- **Modify:** `client/src/components/desktop/DesktopSettingsApp.tsx` — add a
  `'kiosk-mode'` entry to `CATEGORIES` (admin/manager-gated, Windows-only) that renders
  `DesktopKioskSettings`.
- **Modify:** `client/src/data/settingsSearchIndex.ts` — add the new panel's searchable
  entries (existing pattern used by every other Settings category — confirmed present via
  the `SETTINGS_SEARCH_INDEX` import in `DesktopSettingsApp.tsx`).

---

### Task 1: Pure kiosk-shell helpers

**Files:**
- Create: `desktop/kioskShell.js`
- Test: `desktop/__tests__/kioskShell.test.js`

**Interfaces:**
- Produces: `buildShellRegistryValue(exePath)`, `MAX_BOOT_FAILURES` (const, `3`),
  `nextBootAttemptState(prevState)`, `shouldSelfRevert(state)`,
  `resetBootAttemptState()`, `validateEscapeLoginResponse(rawJson)` — all consumed by
  Task 3 (main.js wiring).

- [ ] **Step 1: Write the failing tests**

```js
// desktop/__tests__/kioskShell.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildShellRegistryValue,
  MAX_BOOT_FAILURES,
  nextBootAttemptState,
  shouldSelfRevert,
  resetBootAttemptState,
  validateEscapeLoginResponse,
} = require('../kioskShell');

test('buildShellRegistryValue: wraps the exe path in quotes for the Shell value', () => {
  assert.equal(
    buildShellRegistryValue('C:\\Program Files\\RMPG Flex\\RMPG Flex.exe'),
    '"C:\\Program Files\\RMPG Flex\\RMPG Flex.exe"'
  );
});

test('buildShellRegistryValue: rejects a non-string or empty path', () => {
  assert.throws(() => buildShellRegistryValue(''), /non-empty string/);
  assert.throws(() => buildShellRegistryValue(undefined), /non-empty string/);
});

test('resetBootAttemptState: starts at count 0', () => {
  assert.deepEqual(resetBootAttemptState(), { count: 0 });
});

test('nextBootAttemptState: increments count by 1 each call', () => {
  let state = resetBootAttemptState();
  state = nextBootAttemptState(state);
  assert.deepEqual(state, { count: 1 });
  state = nextBootAttemptState(state);
  assert.deepEqual(state, { count: 2 });
});

test('nextBootAttemptState: treats a missing/malformed prior state as count 0', () => {
  assert.deepEqual(nextBootAttemptState(null), { count: 1 });
  assert.deepEqual(nextBootAttemptState(undefined), { count: 1 });
  assert.deepEqual(nextBootAttemptState({}), { count: 1 });
  assert.deepEqual(nextBootAttemptState({ count: 'not a number' }), { count: 1 });
});

test('shouldSelfRevert: false while count is at or below MAX_BOOT_FAILURES', () => {
  assert.equal(MAX_BOOT_FAILURES, 3);
  assert.equal(shouldSelfRevert({ count: 0 }), false);
  assert.equal(shouldSelfRevert({ count: 3 }), false);
});

test('shouldSelfRevert: true once count exceeds MAX_BOOT_FAILURES', () => {
  assert.equal(shouldSelfRevert({ count: 4 }), true);
  assert.equal(shouldSelfRevert({ count: 10 }), true);
});

test('validateEscapeLoginResponse: accepts a successful admin/manager login with a token', () => {
  const body = JSON.stringify({ token: 'abc.def.ghi', user: { role: 'admin' } });
  assert.deepEqual(validateEscapeLoginResponse(body), { ok: true, role: 'admin' });
});

test('validateEscapeLoginResponse: accepts manager role too', () => {
  const body = JSON.stringify({ token: 'abc.def.ghi', user: { role: 'manager' } });
  assert.deepEqual(validateEscapeLoginResponse(body), { ok: true, role: 'manager' });
});

test('validateEscapeLoginResponse: rejects a non-admin/manager role even with a valid token', () => {
  const body = JSON.stringify({ token: 'abc.def.ghi', user: { role: 'officer' } });
  const result = validateEscapeLoginResponse(body);
  assert.equal(result.ok, false);
  assert.match(result.error, /admin or manager/);
});

test('validateEscapeLoginResponse: rejects a requires2FA response with a clear reason', () => {
  const body = JSON.stringify({ requires2FA: true, tempToken: 'x' });
  const result = validateEscapeLoginResponse(body);
  assert.equal(result.ok, false);
  assert.match(result.error, /2FA/);
});

test('validateEscapeLoginResponse: rejects an error response (wrong password, locked, etc)', () => {
  const body = JSON.stringify({ error: 'Invalid username or password', code: 'INVALID_USERNAME_OR_PASSWORD' });
  const result = validateEscapeLoginResponse(body);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Invalid username or password');
});

test('validateEscapeLoginResponse: rejects malformed JSON without throwing', () => {
  const result = validateEscapeLoginResponse('not json');
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid response/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test desktop/__tests__/kioskShell.test.js`
Expected: FAIL — `Cannot find module '../kioskShell'`

- [ ] **Step 3: Write the implementation**

```js
// desktop/kioskShell.js
// ============================================================
// RMPG Flex — Kiosk Shell Mode pure helpers
// No Electron dependency — unit-testable in isolation, matching
// the windowManager.js / deviceInfo.js / fileOps.js convention.
// ============================================================

'use strict';

/**
 * Builds the string value written to the Winlogon\Shell registry key.
 * Windows resolves an unquoted path with spaces incorrectly (it tries each
 * space-delimited prefix as a separate executable), so the value is always
 * wrapped in double quotes.
 */
function buildShellRegistryValue(exePath) {
  if (typeof exePath !== 'string' || exePath.length === 0) {
    throw new Error('exePath must be a non-empty string');
  }
  return `"${exePath}"`;
}

/**
 * How many consecutive failed kiosk-mode boots are tolerated before the next
 * boot self-reverts the shell registry key back to explorer.exe rather than
 * trying again. This is the primary guard against bricking a machine with a
 * black screen and no shell.
 */
const MAX_BOOT_FAILURES = 3;

/**
 * Returns a fresh boot-attempt state, used the first time kiosk mode is
 * enabled (before any boot has been attempted).
 */
function resetBootAttemptState() {
  return { count: 0 };
}

/**
 * Increments the boot-attempt counter. Treats any missing/malformed prior
 * state as a fresh start (count 0) rather than throwing — a corrupted or
 * absent config value must never crash startup in kiosk mode, since that
 * would itself become the very failure loop this counter exists to catch.
 */
function nextBootAttemptState(prevState) {
  const prevCount = prevState && typeof prevState.count === 'number' ? prevState.count : 0;
  return { count: prevCount + 1 };
}

/**
 * True once the boot-attempt count has exceeded MAX_BOOT_FAILURES. Checked
 * BEFORE attempting to load the app on each kiosk-mode boot — see main.js's
 * startup sequence in Task 3.
 */
function shouldSelfRevert(state) {
  const count = state && typeof state.count === 'number' ? state.count : 0;
  return count > MAX_BOOT_FAILURES;
}

/**
 * Validates the escape hatch's live /api/auth/login response body before
 * main.js acts on it. Returns { ok: true, role } only for a successful,
 * non-2FA login by an admin or manager. Every other shape — network error,
 * malformed JSON, wrong credentials, a non-admin role, or an account that
 * requires 2FA (which this main-process-only flow cannot complete — see
 * Global Constraints) — returns { ok: false, error } with a caller-facing
 * reason, never throws.
 */
function validateEscapeLoginResponse(rawJson) {
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, error: 'invalid response from server' };
  }
  if (parsed && parsed.requires2FA) {
    return { ok: false, error: 'This account requires 2FA, which the kiosk escape hatch cannot complete. Use the in-app "Disable Kiosk Mode" button once logged in, or contact IT for a registry-level revert.' };
  }
  if (parsed && typeof parsed.error === 'string') {
    return { ok: false, error: parsed.error };
  }
  if (!parsed || typeof parsed.token !== 'string' || !parsed.token) {
    return { ok: false, error: 'invalid response from server' };
  }
  const role = parsed.user && parsed.user.role;
  if (role !== 'admin' && role !== 'manager') {
    return { ok: false, error: 'This account is not an admin or manager' };
  }
  return { ok: true, role };
}

module.exports = {
  buildShellRegistryValue,
  MAX_BOOT_FAILURES,
  resetBootAttemptState,
  nextBootAttemptState,
  shouldSelfRevert,
  validateEscapeLoginResponse,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test desktop/__tests__/kioskShell.test.js`
Expected: PASS — 13 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
git add desktop/kioskShell.js desktop/__tests__/kioskShell.test.js
git commit -m "feat(desktop): add pure kiosk-shell helper functions"
```

---

### Task 2: Escape-hatch credential shape validator (ipcGuard.js)

**Files:**
- Modify: `desktop/security/ipcGuard.js`
- Test: `desktop/security/__tests__/ipcGuard.test.js`

**Interfaces:**
- Consumes: nothing new (pure function).
- Produces: `validateKioskEscapeCredentials(username, password)`, consumed by Task 3's
  escape-hatch handler.

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/ipcGuard.test.js`:

```js
const { validateKioskEscapeCredentials } = require('../ipcGuard');

test('validateKioskEscapeCredentials: accepts non-empty username and password', () => {
  assert.deepEqual(validateKioskEscapeCredentials('czamora', 'hunter2'), { ok: true });
});

test('validateKioskEscapeCredentials: rejects empty/missing username or password', () => {
  assert.equal(validateKioskEscapeCredentials('', 'hunter2').ok, false);
  assert.equal(validateKioskEscapeCredentials('czamora', '').ok, false);
  assert.equal(validateKioskEscapeCredentials(undefined, 'hunter2').ok, false);
  assert.equal(validateKioskEscapeCredentials('czamora', undefined).ok, false);
});

test('validateKioskEscapeCredentials: rejects non-string input', () => {
  assert.equal(validateKioskEscapeCredentials(123, 'hunter2').ok, false);
  assert.equal(validateKioskEscapeCredentials('czamora', {}).ok, false);
});

test('validateKioskEscapeCredentials: rejects an over-length password (basic sanity cap)', () => {
  assert.equal(validateKioskEscapeCredentials('czamora', 'x'.repeat(1025)).ok, false);
});
```

(Check the top of `desktop/security/__tests__/ipcGuard.test.js` first — it already
imports `test`/`assert` from `node:test`/`node:assert/strict` per the existing file
convention; add this import line alongside the other destructured imports from
`../ipcGuard` if one already exists, rather than duplicating the `require`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test desktop/security/__tests__/ipcGuard.test.js`
Expected: FAIL — `validateKioskEscapeCredentials is not a function`

- [ ] **Step 3: Add the implementation**

Add to `desktop/security/ipcGuard.js`, near the other pure validators
(`validatePinInput`, `validateUserIdInput`):

```js
/**
 * Shape-validates the kiosk escape hatch's username/password before main.js
 * sends them anywhere. Mirrors validatePinInput's convention: non-throwing,
 * { ok, error } return shape. A generous 1024-char cap is a basic sanity
 * bound, not a real password-policy check — the live /api/auth/login call
 * is the actual authority on whether the credentials are correct.
 */
function validateKioskEscapeCredentials(username, password) {
  if (typeof username !== 'string' || username.length === 0) {
    return { ok: false, error: 'username must be a non-empty string' };
  }
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, error: 'password must be a non-empty string' };
  }
  if (password.length > 1024) {
    return { ok: false, error: 'password exceeds maximum length' };
  }
  return { ok: true };
}
```

Add `validateKioskEscapeCredentials` to the `module.exports` block at the bottom of the
file, alongside the other validators.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test desktop/security/__tests__/ipcGuard.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/security/ipcGuard.js desktop/security/__tests__/ipcGuard.test.js
git commit -m "feat(desktop): add kiosk escape-hatch credential validator"
```

---

### Task 3: Wire kiosk IPC handlers into main.js **[WINDOWS-UNVERIFIED]**

**Files:**
- Modify: `desktop/main.js`

**Interfaces:**
- Consumes: `buildShellRegistryValue`, `MAX_BOOT_FAILURES`, `resetBootAttemptState`,
  `nextBootAttemptState`, `shouldSelfRevert`, `validateEscapeLoginResponse` (Task 1);
  `validateKioskEscapeCredentials` (Task 2); existing `guardedHandle`, `globalShortcut`,
  `getConfig`/`setConfig`, `logSecurityAuditEvent`, `withRequestTimeout`,
  `DEFAULT_IPC_REQUEST_TIMEOUT_MS`, `net`.
- Produces: IPC channels `device:set-kiosk-shell`, `device:kiosk-shell-state` — consumed
  by Task 4 (`preload.js`).

This task has no isolated automated test of its own (it's Electron-API wiring that can't
run under `node --test`) — correctness here is covered by Task 1/2's unit tests for the
logic it calls, and MUST be manually verified on a real Windows machine per the
**[WINDOWS-UNVERIFIED]** marker before shipping. Steps below are implementation-only.

- [ ] **Step 1: Import the new helpers**

At the top of `desktop/main.js`, alongside the existing `windowManager.js` import:

```js
const {
  buildShellRegistryValue,
  MAX_BOOT_FAILURES,
  resetBootAttemptState,
  nextBootAttemptState,
  shouldSelfRevert,
  validateEscapeLoginResponse,
} = require('./kioskShell');
```

And add `validateKioskEscapeCredentials` to the existing destructured `require('./security/ipcGuard')` line at the top of the file (the one starting `const { createIpcGuards, sanitizeReconToolArgs, ... }`).

- [ ] **Step 2: Add the API base URL constant for the escape-hatch's live login call**

Near the existing `REMOTE_SERVER_URL`/`TRUSTED_HOST` constants (top of file):

```js
// API server used ONLY by the kiosk escape hatch's live login check — this
// intentionally does NOT reuse REMOTE_SERVER_URL (the app-shell host); the
// escape hatch calls the API directly since the renderer/app-shell may be
// unresponsive when this is needed.
const KIOSK_ESCAPE_API_BASE = DEV_MODE
  ? 'http://localhost:8787'
  : 'https://api.rmpgutah.us';
```

- [ ] **Step 3: Add the enable/disable IPC handler**

Add near the existing `device:set-auto-launch` handler (~line 1455):

```js
// ─── Kiosk Shell Mode (Windows only) ─────────────────────────
// Replaces explorer.exe as the Windows login shell so this machine boots
// directly into the RMPG Flex desktop. See docs/superpowers/specs/
// 2026-07-21-desktop-kiosk-shell-mode-design.md for the full design.
guardedHandle('device:set-kiosk-shell', async (event, enabled) => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Kiosk mode is only available on Windows' };
  }
  const roleCheck = requireOfflineAuthForSensitiveIpc(getConfig('current_user_role'));
  // requireOfflineAuthForSensitiveIpc only accepts 'admin' today; Kiosk Mode
  // is also available to 'manager' per the design spec's admin/manager gate
  // (matches DesktopPage.tsx's isAdmin check), so extend the check inline
  // rather than widen the shared helper's meaning for its other callers.
  const role = getConfig('current_user_role');
  if (!roleCheck.ok && role !== 'manager') {
    logSecurityAuditEvent('device:set-kiosk-shell', 'denied', { role });
    return { ok: false, error: 'This action requires an admin or manager session' };
  }
  try {
    const shellValue = enabled
      ? buildShellRegistryValue(process.execPath)
      : '"explorer.exe"';
    // The main process does not run elevated; the actual registry write
    // happens in a UAC-elevated helper. `runElevatedRegistryWrite` spawns
    // `reg.exe` via PowerShell's Start-Process -Verb RunAs so Windows shows
    // the native UAC consent prompt — see Step 4 below for the helper.
    const result = await runElevatedRegistryWrite(shellValue);
    if (!result.ok) {
      logSecurityAuditEvent('device:set-kiosk-shell', 'error', { enabled, error: result.error });
      return result;
    }
    if (enabled) {
      setConfig('kiosk_boot_attempts', resetBootAttemptState());
    }
    logSecurityAuditEvent('device:set-kiosk-shell', 'success', { enabled });
    return { ok: true };
  } catch (err) {
    logSecurityAuditEvent('device:set-kiosk-shell', 'error', { enabled, error: err.message });
    return { ok: false, error: err.message };
  }
});

guardedHandle('device:kiosk-shell-state', () => {
  if (process.platform !== 'win32') return { supported: false, enabled: false };
  return { supported: true, enabled: getConfig('kiosk_shell_enabled') === true };
});
```

- [ ] **Step 4: Add the elevated registry-write helper**

Add just above the handlers from Step 3:

```js
/**
 * Runs `reg.exe add ... Shell ...` through an elevated (UAC-prompted)
 * PowerShell process via Start-Process -Verb RunAs. Returns { ok: true } on
 * a zero exit code, { ok: false, error } otherwise — including if the user
 * cancels the UAC prompt (Start-Process throws in that case).
 * [WINDOWS-UNVERIFIED] — the reg.exe/Start-Process invocation below has not
 * been run on real Windows; verify manually before shipping.
 */
function runElevatedRegistryWrite(shellValue) {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const regKeyPath = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon';
    // Escape the shell value's own double quotes for embedding inside the
    // PowerShell -ArgumentList string.
    const escapedValue = shellValue.replace(/"/g, '\\"');
    const psCommand = `Start-Process reg.exe -ArgumentList 'add "${regKeyPath}" /v Shell /t REG_SZ /d "${escapedValue}" /f' -Verb RunAs -Wait`;
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', psCommand], { windowsHide: false });
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: stderr || `reg.exe exited with code ${code}` });
    });
  });
}
```

- [ ] **Step 5: Kiosk-mode boot detection and BrowserWindow branch**

Add near the top of the `createMainWindow` function (before the existing
`restoreWindowBounds` call at ~line 803):

```js
// ─── Kiosk boot detection + self-revert safety net ───────────
const isKioskShell = process.platform === 'win32' && getConfig('kiosk_shell_enabled') === true;
let kioskBootState = null;
if (isKioskShell) {
  kioskBootState = nextBootAttemptState(getConfig('kiosk_boot_attempts'));
  setConfig('kiosk_boot_attempts', kioskBootState);
  if (shouldSelfRevert(kioskBootState)) {
    console.error(`[KIOSK] ${MAX_BOOT_FAILURES} consecutive failed boots — self-reverting shell to explorer.exe`);
    await runElevatedRegistryWrite('"explorer.exe"');
    setConfig('kiosk_shell_enabled', false);
    setConfig('kiosk_boot_attempts', resetBootAttemptState());
    dialog.showErrorBox(
      'RMPG Flex Kiosk Mode Disabled',
      `Kiosk Mode failed to start ${MAX_BOOT_FAILURES} times in a row and has been automatically disabled. Windows will use its normal desktop from now on.`
    );
    // Fall through to the normal (non-kiosk) window below — do not exit,
    // so the operator still gets a usable app window this run.
  }
}
```

Then change the `mainWindow = new BrowserWindow({...})` call (~line 805) to branch on
`isKioskShell && !shouldSelfRevert(kioskBootState)`:

```js
const useKioskChrome = isKioskShell && !shouldSelfRevert(kioskBootState);
mainWindow = new BrowserWindow({
  ...(useKioskChrome
    ? { kiosk: true, frame: false, fullscreen: true, autoHideMenuBar: true }
    : {
        width: 1440,
        height: 900,
        ...(restoredBounds ? { x: restoredBounds.x, y: restoredBounds.y, width: restoredBounds.width, height: restoredBounds.height } : {}),
        minWidth: 1024,
        minHeight: 700,
      }),
  title: APP_TITLE,
  backgroundColor: '#000000',
  show: false,
  webPreferences: hardenWebPreferencesDefaults({
    preload: resolveTrustedPreloadPath(path.join(__dirname, 'preload.js'), path.join(__dirname, 'preload.js')),
    backgroundThrottling: false,
  }),
  titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
  trafficLightPosition: { x: 12, y: 12 },
});
if (useKioskChrome) Menu.setApplicationMenu(null);
```

Later in the same function, where `ready-to-show` is handled (search for `mainWindow.once('ready-to-show'`), add a reset of the boot counter on success:

```js
if (useKioskChrome) setConfig('kiosk_boot_attempts', resetBootAttemptState());
```

- [ ] **Step 6: Escape-hatch global shortcut + password prompt window**

Add after `mainWindow` is created and shown (find the existing block that calls
`globalShortcut.register` for other shortcuts, or add a new one near the end of
`createMainWindow`):

```js
if (useKioskChrome) {
  globalShortcut.register('Ctrl+Alt+Shift+F12', () => {
    openKioskEscapeWindow();
  });
}
```

Add the escape window function near `runElevatedRegistryWrite`:

```js
let kioskEscapeWindow = null;
const kioskEscapeRateLimiter = createRateLimiter(5, 60_000); // 5 attempts/minute

function openKioskEscapeWindow() {
  if (kioskEscapeWindow) { kioskEscapeWindow.focus(); return; }
  kioskEscapeWindow = new BrowserWindow({
    width: 420,
    height: 260,
    frame: true,
    alwaysOnTop: true,
    resizable: false,
    title: 'RMPG Flex — Exit Kiosk Mode',
    webPreferences: hardenWebPreferencesDefaults({
      preload: resolveTrustedPreloadPath(path.join(__dirname, 'kioskEscapePreload.js'), path.join(__dirname, 'kioskEscapePreload.js')),
    }),
  });
  kioskEscapeWindow.setMenu(null);
  kioskEscapeWindow.loadFile(path.join(__dirname, 'kioskEscape.html'));
  kioskEscapeWindow.on('closed', () => { kioskEscapeWindow = null; });
}

guardedHandle('kiosk:attempt-escape', async (event, username, password) => {
  const rateCheck = kioskEscapeRateLimiter.checkRateLimit('kiosk:attempt-escape');
  if (!rateCheck.ok) {
    logSecurityAuditEvent('kiosk:attempt-escape', 'denied', { reason: 'rate_limited' });
    return rateCheck;
  }
  const shapeCheck = validateKioskEscapeCredentials(username, password);
  if (!shapeCheck.ok) return shapeCheck;

  try {
    const result = await withRequestTimeout(
      new Promise((resolve, reject) => {
        const request = net.request({ method: 'POST', url: `${KIOSK_ESCAPE_API_BASE}/api/auth/login` });
        request.setHeader('Content-Type', 'application/json');
        let body = '';
        request.on('response', (response) => {
          response.on('data', (chunk) => { body += chunk.toString(); });
          response.on('end', () => resolve(body));
        });
        request.on('error', reject);
        request.write(JSON.stringify({ username, password }));
        request.end();
      }),
      DEFAULT_IPC_REQUEST_TIMEOUT_MS,
      setTimeout
    );
    const validation = validateEscapeLoginResponse(result);
    logSecurityAuditEvent('kiosk:attempt-escape', validation.ok ? 'success' : 'denied', { username });
    if (!validation.ok) return validation;

    await runElevatedRegistryWrite('"explorer.exe"');
    setConfig('kiosk_shell_enabled', false);
    setConfig('kiosk_boot_attempts', resetBootAttemptState());
    kioskEscapeWindow?.close();
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'Kiosk Mode Disabled',
      message: 'Kiosk Mode has been disabled. Restart the computer to return to the normal Windows desktop.',
    });
    return { ok: true };
  } catch (err) {
    logSecurityAuditEvent('kiosk:attempt-escape', 'error', { error: err.message });
    return { ok: false, error: 'Could not reach the server — check network connectivity and try again.' };
  }
});
```

- [ ] **Step 7: Create the escape-hatch prompt UI (plain HTML, not the React app)**

Create `desktop/kioskEscape.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, sans-serif; background: #0c1a2b; color: #eef2f7; padding: 20px; }
    h2 { font-size: 15px; margin: 0 0 12px; }
    input { width: 100%; padding: 8px; margin-bottom: 10px; box-sizing: border-box; background: #16283d; border: 1px solid #3a4d63; color: #eef2f7; border-radius: 2px; }
    button { padding: 8px 16px; background: #b7c2cf; color: #0c1a2b; border: none; border-radius: 2px; cursor: pointer; font-weight: 600; }
    #error { color: #f87171; font-size: 12px; min-height: 16px; margin-bottom: 8px; }
  </style>
</head>
<body>
  <h2>Enter an admin or manager password to exit Kiosk Mode</h2>
  <input id="username" placeholder="Username" autocomplete="username" />
  <input id="password" type="password" placeholder="Password" autocomplete="current-password" />
  <div id="error"></div>
  <button id="submit">Exit Kiosk Mode</button>
  <script>
    document.getElementById('submit').addEventListener('click', async () => {
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      const errorEl = document.getElementById('error');
      errorEl.textContent = '';
      const result = await window.kioskEscape.attempt(username, password);
      if (!result.ok) errorEl.textContent = result.error;
    });
  </script>
</body>
</html>
```

Create `desktop/kioskEscapePreload.js`:

```js
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kioskEscape', {
  attempt: (username, password) => ipcRenderer.invoke('kiosk:attempt-escape', username, password),
});
```

- [ ] **Step 8: Commit**

```bash
git add desktop/main.js desktop/kioskEscape.html desktop/kioskEscapePreload.js
git commit -m "feat(desktop): wire kiosk shell IPC, boot branch, and escape hatch into main.js"
```

---

### Task 4: Expose kiosk IPC in preload.js

**Files:**
- Modify: `desktop/preload.js`

**Interfaces:**
- Consumes: `device:set-kiosk-shell`, `device:kiosk-shell-state` IPC channels (Task 3).
- Produces: `window.electron.setKioskShell(enabled)`, `window.electron.getKioskShellState()` — consumed by Task 5 (React panel).

- [ ] **Step 1: Add the two methods**

In `desktop/preload.js`, alongside the existing `setAutoLaunch`/`getAutoLaunchState` lines:

```js
  setKioskShell: (enabled) => ipcRenderer.invoke('device:set-kiosk-shell', enabled),
  getKioskShellState: () => ipcRenderer.invoke('device:kiosk-shell-state'),
```

- [ ] **Step 2: Manual smoke check**

Run: `cd desktop && npm start -- --dev` (macOS dev machine — this only confirms the app
still boots and `window.electron.getKioskShellState` is callable and returns
`{ supported: false, enabled: false }` on non-Windows; it does NOT exercise any
Windows-specific behavior). Open DevTools console in the running app and run
`window.electron.getKioskShellState()`.
Expected: resolves to `{ supported: false, enabled: false }`.

- [ ] **Step 3: Commit**

```bash
git add desktop/preload.js
git commit -m "feat(desktop): expose kiosk shell IPC methods to renderer"
```

---

### Task 5: `DesktopKioskSettings.tsx` panel

**Files:**
- Create: `client/src/components/desktop/DesktopKioskSettings.tsx`
- Test: `client/src/components/desktop/__tests__/DesktopKioskSettings.test.tsx`

**Interfaces:**
- Consumes: `window.electron?.getKioskShellState`, `window.electron?.setKioskShell` (Task
  4); `useAuth()` for `user.role` (existing hook, same as `DesktopPage.tsx`'s `isAdmin`
  check).
- Produces: `<DesktopKioskSettings onClose={() => void} />` component — consumed by Task
  6 (`DesktopSettingsApp.tsx`).

- [ ] **Step 1: Write the failing test**

Check `client/src/pages/DesktopPage.test.tsx` first for the existing
`window.electron` mocking convention used in this codebase, then follow it. Create:

```tsx
// client/src/components/desktop/__tests__/DesktopKioskSettings.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DesktopKioskSettings from '../DesktopKioskSettings';

describe('DesktopKioskSettings', () => {
  beforeEach(() => {
    (window as any).electron = {
      getKioskShellState: vi.fn().mockResolvedValue({ supported: true, enabled: false }),
      setKioskShell: vi.fn().mockResolvedValue({ ok: true }),
    };
  });

  it('shows unsupported message when window.electron.getKioskShellState reports supported:false', async () => {
    (window as any).electron.getKioskShellState = vi.fn().mockResolvedValue({ supported: false, enabled: false });
    render(<DesktopKioskSettings onClose={() => {}} />);
    expect(await screen.findByText(/only available on windows/i)).toBeInTheDocument();
  });

  it('shows an Enable button and current Off state when supported and disabled', async () => {
    render(<DesktopKioskSettings onClose={() => {}} />);
    expect(await screen.findByText(/off/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enable kiosk mode/i })).toBeInTheDocument();
  });

  it('requires confirmation before calling setKioskShell', async () => {
    render(<DesktopKioskSettings onClose={() => {}} />);
    const enableBtn = await screen.findByRole('button', { name: /enable kiosk mode/i });
    fireEvent.click(enableBtn);
    expect((window as any).electron.setKioskShell).not.toHaveBeenCalled();
    const confirmBtn = await screen.findByRole('button', { name: /yes, i understand/i });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect((window as any).electron.setKioskShell).toHaveBeenCalledWith(true));
  });

  it('shows an inline error when setKioskShell fails', async () => {
    (window as any).electron.setKioskShell = vi.fn().mockResolvedValue({ ok: false, error: 'UAC prompt was cancelled' });
    render(<DesktopKioskSettings onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /enable kiosk mode/i }));
    fireEvent.click(await screen.findByRole('button', { name: /yes, i understand/i }));
    expect(await screen.findByText(/uac prompt was cancelled/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/components/desktop/__tests__/DesktopKioskSettings.test.tsx`
Expected: FAIL — cannot find module `../DesktopKioskSettings`

- [ ] **Step 3: Write the implementation**

```tsx
// client/src/components/desktop/DesktopKioskSettings.tsx
import React, { useState, useEffect, useCallback } from 'react';

interface KioskState {
  supported: boolean;
  enabled: boolean;
}

export default function DesktopKioskSettings({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<KioskState | null>(null);
  const [confirming, setConfirming] = useState<'enable' | 'disable' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const result = await window.electron?.getKioskShellState?.();
    setState(result ?? { supported: false, enabled: false });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (!state) return null;

  if (!state.supported) {
    return (
      <div className="p-4 text-sm text-brand-300">
        Kiosk Mode is only available on Windows.
      </div>
    );
  }

  const applyToggle = async (enable: boolean) => {
    setBusy(true);
    setError(null);
    const result = await window.electron?.setKioskShell?.(enable);
    setBusy(false);
    setConfirming(null);
    if (!result?.ok) {
      setError(result?.error ?? 'Failed to change Kiosk Mode');
      return;
    }
    await refresh();
  };

  return (
    <div className="p-4 space-y-4 text-sm">
      <div>
        Kiosk Mode: <span className="font-semibold">{state.enabled ? 'On' : 'Off'}</span>
        {state.enabled && (
          <p className="text-brand-300 mt-1">
            This machine boots directly into RMPG Flex. Press Ctrl+Alt+Shift+F12 and enter an
            admin or manager password to exit.
          </p>
        )}
      </div>

      {error && <div className="text-sev-critical">{error}</div>}

      {confirming ? (
        <div className="space-y-2 border border-rmpg-700 p-3">
          <p>
            {confirming === 'enable'
              ? 'This machine will restart and boot directly into RMPG Flex — Windows Explorer will no longer load normally. Press Ctrl+Alt+Shift+F12 and enter an admin/manager password to exit.'
              : 'This machine will restart into the normal Windows desktop.'}
          </p>
          <div className="flex gap-2">
            <button
              className="px-3 py-1 bg-brand-400 text-surface-base"
              disabled={busy}
              onClick={() => applyToggle(confirming === 'enable')}
            >
              Yes, I understand
            </button>
            <button className="px-3 py-1" disabled={busy} onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="px-3 py-1 bg-brand-400 text-surface-base"
          onClick={() => setConfirming(state.enabled ? 'disable' : 'enable')}
        >
          {state.enabled ? 'Disable Kiosk Mode' : 'Enable Kiosk Mode'}
        </button>
      )}
    </div>
  );
}
```

Note: this task assumes `window.electron` already has a TypeScript ambient type
declaration somewhere in `client/src/` (check `client/src/*.d.ts` or similar for the
existing `Window['electron']` shape, given `openSecondaryWindow`/`setDockBadge`/etc. are
already called elsewhere in the client). Add `setKioskShell`/`getKioskShellState` to that
existing declaration rather than re-declaring the whole interface — locate it with `grep
-rn "interface.*Window\|declare global" client/src/` before writing this step's code for
real, and adjust the exact location inline.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/components/desktop/__tests__/DesktopKioskSettings.test.tsx`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add client/src/components/desktop/DesktopKioskSettings.tsx client/src/components/desktop/__tests__/DesktopKioskSettings.test.tsx
git commit -m "feat(desktop): add DesktopKioskSettings admin panel"
```

---

### Task 6: Wire the panel into `DesktopSettingsApp.tsx`

**Files:**
- Modify: `client/src/components/desktop/DesktopSettingsApp.tsx`
- Modify: `client/src/data/settingsSearchIndex.ts`
- Test: existing `client/src/components/desktop/__tests__/DesktopSettingsApp.test.tsx` if
  present (check with `find client/src -iname "*DesktopSettingsApp*test*"` before writing
  — if absent, add assertions to the nearest existing settings-app test file per repo
  convention rather than creating a new one for this single addition).

**Interfaces:**
- Consumes: `DesktopKioskSettings` (Task 5); existing `CATEGORIES` array and category
  rendering switch in `DesktopSettingsApp.tsx`; `isAdmin` prop/derivation (confirm exact
  prop name by reading how `DesktopSettingsApp` receives role info from `DesktopPage.tsx`
  — it may need a new `isAdmin: boolean` prop threaded through if it doesn't already
  receive one).

- [ ] **Step 1: Read how `DesktopPage.tsx` renders `DesktopSettingsApp`**

Run: `grep -n "DesktopSettingsApp" client/src/pages/DesktopPage.tsx`

Confirm whether `isAdmin` (already computed in `DesktopPageInner`, per the earlier
codebase read: `const isAdmin = user?.role === 'admin' || user?.role === 'manager';`) is
already passed as a prop. If not, add `isAdmin={isAdmin}` to the `<DesktopSettingsApp
.../>` call site and add `isAdmin: boolean` to `DesktopSettingsAppProps` in
`DesktopSettingsApp.tsx`.

- [ ] **Step 2: Add the category entry**

In `DesktopSettingsApp.tsx`, extend `CATEGORIES`:

```tsx
const CATEGORIES = [
  { id: 'personalization', label: 'Personalization', icon: Sliders },
  { id: 'desktop-icons', label: 'Desktop & Icons', icon: LayoutGrid },
  { id: 'window-management', label: 'Window Management', icon: AppWindow },
  { id: 'taskbar', label: 'Taskbar', icon: PanelBottom },
  { id: 'layout-templates', label: 'Layout & Templates', icon: FolderKanban },
  { id: 'kiosk-mode', label: 'Kiosk Mode', icon: Monitor },
] as const;
```

(Add `Monitor` to the existing `lucide-react` import line at the top of the file.)

Filter it out of the rendered list for non-admins — find where `CATEGORIES` is mapped to
sidebar buttons and wrap with:

```tsx
const visibleCategories = CATEGORIES.filter(c => c.id !== 'kiosk-mode' || isAdmin);
```

Use `visibleCategories` instead of `CATEGORIES` at that render site.

- [ ] **Step 3: Render the panel**

Find the switch/conditional that renders each category's content body (mirrors how
`'taskbar'` or `'layout-templates'` render their own sections) and add:

```tsx
{activeCategory === 'kiosk-mode' && <DesktopKioskSettings onClose={onClose} />}
```

Add `import DesktopKioskSettings from './DesktopKioskSettings';` at the top.

- [ ] **Step 4: Add search index entries**

In `client/src/data/settingsSearchIndex.ts`, following the existing entry shape for
other categories, add entries for `'kiosk-mode'` (e.g. `{ category: 'kiosk-mode', label:
'Kiosk Mode', keywords: ['kiosk', 'windows shell', 'explorer', 'boot', 'lockdown'] }` —
match the exact field names already used by neighboring entries in that file).

- [ ] **Step 5: Manual verification (client typecheck + existing test suite)**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

Run: `cd client && npx vitest run`
Expected: all existing tests still pass, plus the new `DesktopKioskSettings.test.tsx`
from Task 5.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/desktop/DesktopSettingsApp.tsx client/src/data/settingsSearchIndex.ts
git commit -m "feat(desktop): surface Kiosk Mode in Desktop Settings for admins"
```

---

### Task 7: Full verification pass **[WINDOWS-UNVERIFIED for Windows-specific behavior]**

**Files:** none (verification only)

- [ ] **Step 1: Run the full Worker/client/desktop test suites**

```bash
npm run typecheck
cd client && npx tsc --noEmit && npx vitest run
cd ../desktop && node --test '__tests__/**/*.js' 'security/__tests__/**/*.js'
```

Expected: all pass, including the new `kioskShell.test.js`, the extended
`ipcGuard.test.js`, and `DesktopKioskSettings.test.tsx`.

- [ ] **Step 2: Document the Windows-only manual verification checklist**

This step produces no code — it's the handoff to whoever runs the first real-machine
test, per the spec's Rollout section. Confirm, on an actual Windows test laptop (never a
production patrol/dispatch machine first):
1. Enabling Kiosk Mode from Settings triggers a UAC prompt and, after acceptance,
   the registry key is set (`reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell`).
2. After reboot, the machine loads directly into the RMPG Flex desktop full-screen, no
   Explorer taskbar visible.
3. Ctrl+Alt+Shift+F12 opens the password prompt; a wrong password shows an inline error
   and does not revert anything; a correct admin/manager password reverts the registry
   key and the machine returns to normal Windows on the next restart.
4. Deliberately breaking the app (e.g. temporarily pointing `REMOTE_SERVER_URL` at an
   unreachable host) across 4+ consecutive boots triggers the self-revert safety net
   instead of looping forever.
5. Disabling Kiosk Mode from within a booted kiosk session (via the Settings panel, once
   logged in) works without needing the hotkey.

- [ ] **Step 3: Final commit (if any fixes were needed during verification)**

```bash
git add -A
git commit -m "fix(desktop): address findings from kiosk shell mode verification pass"
```
