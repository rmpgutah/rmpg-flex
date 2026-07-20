# Desktop Shell — Group F (Process & Session Hardening) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `desktop/security/sessionHardening.js` — Electron process/session-level hardening for the RMPG Flex desktop shell (CSP, permission scoping, navigation guard, shared hardened `webPreferences`, restricted window creation, TLS host-pinning + audit, remote-module/insecure-flag lockdown, auto-updater transport lock, production DevTools restriction, preload-path restriction) — per Group F of the 10-group sequence in [`docs/superpowers/specs/2026-07-18-desktop-shell-functions-and-hardening-design.md`](../specs/2026-07-18-desktop-shell-functions-and-hardening-design.md).

**Architecture:** A single new module, `desktop/security/sessionHardening.js`, exporting 10 functions. Functions that need no Electron runtime (CSP policy string, permission-decision logic, navigation-decision logic, webPreferences object, window-open decision, preload-path check) are pure and unit-tested with `node:test`, mirroring Group G's `ipcGuard.js` pattern. Functions that must call a live Electron session/webContents API (`configureContentSecurityPolicy`, `installNavigationGuard`, `pinCertificateOrValidateTls`) are split into a pure decision function (tested) plus a thin Electron-calling wrapper (wired into `main.js`, not unit-tested — no Electron test harness exists in this repo, same constraint Group G operated under).

**Tech Stack:** Plain Node.js (CommonJS), Electron `session`/`webContents`/`BrowserWindow` APIs, `node:test` + `node:assert/strict`.

## Global Constraints

- Match existing `desktop/*.js` and `desktop/security/*.js` conventions: CommonJS, no TypeScript, header comment block matching `desktop/security/ipcGuard.js`'s style.
- Pure logic must be unit-testable with zero Electron runtime, exactly like Group G.
- Every new file added under `desktop/security/` must be added to `desktop/package.json`'s `build.files` array — already contains `"security"` (a directory entry) from Group G, so no change needed there, but verify this assumption at Task 1.
- This branch (`claude/desktop-hardening-group-f-session-hardening`) is based on the tip of the Group G branch (`claude/desktop-hardening-functions-bfbb4a`, PR #2851, not yet merged to `main`) — it already has `TRUSTED_HOST`, `guardedHandle`/`guardedOn`, and `desktop/security/ipcGuard.js` in place. Do not re-derive or duplicate any of that.
- **Scope decisions made during planning, not deferred silently:**
  - `configureContentSecurityPolicy()` ships in **Report-Only mode** (`Content-Security-Policy-Report-Only` header, not `Content-Security-Policy`). A blind CSP written without the ability to load the real app in a browser and observe violations risks silently breaking Mapbox tiles, the WebSocket dispatch connection, or fonts in production — a `Report-Only` header logs violations to the console without blocking anything, and is the standard safe rollout path for a first CSP. Flipping to enforcing mode is explicit follow-up work once a human has run the app and confirmed zero real violations in the console.
  - `pinCertificateOrValidateTls()` implements a **pinned-hostname allowlist with audit logging**, not SPKI public-key-hash pinning. Real hash pinning needs an ops-provided pinned public key hash and a rotation runbook (a wrong hash bricks all HTTPS connectivity to the app the moment the cert or its issuing chain rotates) — neither exists yet. This function logs a warning whenever a connection to a pinned host (`TRUSTED_HOST`, `api.rmpgutah.us`) completes with `verificationResult !== 'net::OK'`, giving visibility into anomalies (e.g. an unexpected corporate MITM proxy), while every actual accept/reject decision is still deferred to Chromium's own verification (`callback(-3)`, confirmed via Electron's `ses.setCertificateVerifyProc` docs — `-3` means "use Chromium's own verification result", `0` means "accept unconditionally", `-2` means "reject unconditionally"). This never weakens Electron's default TLS behavior; it only adds observability for the two hosts that matter.
- Commit after each task.

---

### Task 1: Verify build.files, module header, `configureContentSecurityPolicy` (pure policy + wiring)

**Files:**
- Create: `desktop/security/sessionHardening.js`
- Test: `desktop/security/__tests__/sessionHardening.test.js`
- Modify: `desktop/main.js` (wire the CSP header into the main window's session)

**Interfaces:**
- Produces: `buildCspHeaderValue()` — pure function, returns the exact CSP policy string (no Electron dependency, fully unit-testable). `installContentSecurityPolicy(session)` — thin wrapper calling `session.webRequest.onHeadersReceived` with the policy from `buildCspHeaderValue()`, applied as `Content-Security-Policy-Report-Only`. Later tasks in this group export additional functions from the same file/exports object.

- [ ] **Step 1: Confirm `build.files` already covers `security/`**

Run: `grep -n '"security"' desktop/package.json`
Expected: one match inside the `files` array (added by Group G) — confirms no change needed here.

- [ ] **Step 2: Write the failing test**

Create `desktop/security/__tests__/sessionHardening.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCspHeaderValue } = require('../sessionHardening');

test('buildCspHeaderValue: returns a policy scoped to self plus known integrations', () => {
  const policy = buildCspHeaderValue();
  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /connect-src[^;]*wss:\/\/api\.rmpgutah\.us/);
  assert.match(policy, /connect-src[^;]*https:\/\/api\.rmpgutah\.us/);
  assert.match(policy, /img-src[^;]*\*\.mapbox\.com/);
  assert.match(policy, /script-src[^;]*\*\.mapbox\.com/);
});

test('buildCspHeaderValue: does not include a wildcard default-src', () => {
  const policy = buildCspHeaderValue();
  assert.doesNotMatch(policy, /default-src[^;]*\*/);
});

test('buildCspHeaderValue: every directive is terminated with a semicolon', () => {
  const policy = buildCspHeaderValue();
  const directives = policy.split(';').map((d) => d.trim()).filter(Boolean);
  assert.ok(directives.length >= 6, 'expected at least 6 CSP directives');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: FAIL — `Cannot find module '../sessionHardening'`

- [ ] **Step 4: Write the minimal implementation**

Create `desktop/security/sessionHardening.js`:

```js
// ============================================================
// RMPG Flex — Session Hardening
// Electron process/session-level hardening: CSP, permission
// scoping, navigation guard, hardened webPreferences defaults,
// window-open restriction, TLS pinned-host audit, remote-module
// lockdown, auto-updater transport lock, production DevTools
// restriction, preload-path restriction.
// ============================================================

'use strict';

/**
 * The desktop shell's Content-Security-Policy, shipped in Report-Only
 * mode (see plan Global Constraints) until a human confirms zero real
 * violations against the live app. Scoped to the app's own origin plus
 * the known third-party integration this shell embeds: Mapbox GL JS.
 */
function buildCspHeaderValue() {
  const directives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.mapbox.com",
    "style-src 'self' 'unsafe-inline' https://*.mapbox.com https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://*.mapbox.com https://*.rmpgutah.us",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://*.rmpgutah.us https://api.rmpgutah.us wss://api.rmpgutah.us https://*.mapbox.com https://events.mapbox.com",
    "worker-src 'self' blob:",
    "frame-src 'self'",
  ];
  return directives.join('; ') + ';';
}

/**
 * Applies buildCspHeaderValue() as a Report-Only header on every response
 * the given session's webRequest sees. Report-Only never blocks a
 * request — it only makes the renderer log violations to its console.
 */
function installContentSecurityPolicy(session) {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy-Report-Only': [buildCspHeaderValue()],
      },
    });
  });
}

module.exports = {
  buildCspHeaderValue,
  installContentSecurityPolicy,
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: PASS — 3 tests passing

- [ ] **Step 6: Wire into `main.js`**

Find the `const { createIpcGuards, ... } = require('./security/ipcGuard');` import line near the top of `main.js` (added by Group G). Immediately after it, add:

```js
const { installContentSecurityPolicy } = require('./security/sessionHardening');
```

In `createMainWindow()`, immediately after the existing block that sets `setPermissionRequestHandler`/`setPermissionCheckHandler` on `mainWindow.webContents.session` (search for `setPermissionCheckHandler` to find the exact spot), add:

```js
  installContentSecurityPolicy(mainWindow.webContents.session);
```

- [ ] **Step 7: Sanity-check the file still parses**

Run: `node --check desktop/main.js`
Expected: no output, exit code 0

- [ ] **Step 8: Commit**

```bash
git add desktop/security/sessionHardening.js desktop/security/__tests__/sessionHardening.test.js desktop/main.js
git commit -m "desktop: add CSP (Report-Only) via installContentSecurityPolicy"
```

---

### Task 2: `scopePermissionHandlers` — restrict geo/notifications/media to TRUSTED_HOST

**Files:**
- Modify: `desktop/security/sessionHardening.js`
- Modify: `desktop/main.js` (replace the existing blanket permission handlers)
- Test: `desktop/security/__tests__/sessionHardening.test.js`

**Interfaces:**
- Produces: `isPermissionAllowed(requestingHost, expectedHost, permission)` — pure function, returns boolean. `true` only if `requestingHost === expectedHost` AND `permission` is one of `['geolocation', 'notifications', 'media']` (the same allowlist the existing code already used — this task adds the origin check, not a permission-type change).

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/sessionHardening.test.js`:

```js
const { isPermissionAllowed } = require('../sessionHardening');

test('isPermissionAllowed: allows a known permission from the trusted host', () => {
  assert.equal(isPermissionAllowed('rmpgutah.us', 'rmpgutah.us', 'geolocation'), true);
  assert.equal(isPermissionAllowed('rmpgutah.us', 'rmpgutah.us', 'notifications'), true);
  assert.equal(isPermissionAllowed('rmpgutah.us', 'rmpgutah.us', 'media'), true);
});

test('isPermissionAllowed: rejects a matching permission from an untrusted host', () => {
  assert.equal(isPermissionAllowed('evil.example', 'rmpgutah.us', 'geolocation'), false);
});

test('isPermissionAllowed: rejects an unlisted permission even from the trusted host', () => {
  assert.equal(isPermissionAllowed('rmpgutah.us', 'rmpgutah.us', 'midi'), false);
  assert.equal(isPermissionAllowed('rmpgutah.us', 'rmpgutah.us', 'clipboard-read'), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: FAIL — `isPermissionAllowed is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/sessionHardening.js`, above `module.exports`:

```js
const ALLOWED_PERMISSIONS = new Set(['geolocation', 'notifications', 'media']);

/**
 * The pre-Group-F handler granted these permissions to ANY origin the
 * window ever loaded. This adds the missing origin check: only the
 * configured trusted host may receive them.
 */
function isPermissionAllowed(requestingHost, expectedHost, permission) {
  return requestingHost === expectedHost && ALLOWED_PERMISSIONS.has(permission);
}
```

Update `module.exports` to add `isPermissionAllowed`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: PASS — 6 tests passing

- [ ] **Step 5: Wire into `main.js`, replacing the existing blanket handlers**

Extend the import line to also destructure `isPermissionAllowed`. Find the existing block (added before Group F, unchanged since):

```js
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      const allowed = ['geolocation', 'notifications', 'media'];
      callback(allowed.includes(permission));
    }
  );

  // Also handle the newer permission-check API (Electron 20+)
  mainWindow.webContents.session.setPermissionCheckHandler(
    (_webContents, permission) => {
      const allowed = ['geolocation', 'notifications', 'media'];
      return allowed.includes(permission);
    }
  );
```

Replace both handler bodies to derive the requesting host from the `webContents`'s current URL and check it against `TRUSTED_HOST`:

```js
  mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      let requestingHost;
      try {
        requestingHost = new URL(webContents.getURL()).host;
      } catch {
        requestingHost = '';
      }
      callback(isPermissionAllowed(requestingHost, TRUSTED_HOST, permission));
    }
  );

  // Also handle the newer permission-check API (Electron 20+)
  mainWindow.webContents.session.setPermissionCheckHandler(
    (webContents, permission) => {
      let requestingHost;
      try {
        requestingHost = new URL(webContents.getURL()).host;
      } catch {
        requestingHost = '';
      }
      return isPermissionAllowed(requestingHost, TRUSTED_HOST, permission);
    }
  );
```

(`URL` is already available at module scope in `main.js` — it's a Node/Electron global, and `TRUSTED_HOST` is already the module-scope constant from Group G. No new import needed.)

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/main.js`
Expected: exit code 0

- [ ] **Step 7: Commit**

```bash
git add desktop/security/sessionHardening.js desktop/security/__tests__/sessionHardening.test.js desktop/main.js
git commit -m "desktop: scope geo/notifications/media permission grants to TRUSTED_HOST"
```

---

### Task 3: `shouldAllowNavigation` — navigation guard (`will-navigate`)

**Files:**
- Modify: `desktop/security/sessionHardening.js`
- Modify: `desktop/main.js`
- Test: `desktop/security/__tests__/sessionHardening.test.js`

**Interfaces:**
- Produces: `shouldAllowNavigation(targetUrl, expectedHost)` — pure function, returns `boolean`. Only `main.js`'s `will-navigate` listener calls it; `setWindowOpenHandler` (a separate, pre-existing guard for *new* windows) is untouched by this task.

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/sessionHardening.test.js`:

```js
const { shouldAllowNavigation } = require('../sessionHardening');

test('shouldAllowNavigation: allows same-host https navigation', () => {
  assert.equal(shouldAllowNavigation('https://rmpgutah.us/dispatch', 'rmpgutah.us'), true);
});

test('shouldAllowNavigation: rejects a different host', () => {
  assert.equal(shouldAllowNavigation('https://evil.example/phish', 'rmpgutah.us'), false);
});

test('shouldAllowNavigation: rejects a data: URL', () => {
  assert.equal(shouldAllowNavigation('data:text/html,<script>alert(1)</script>', 'rmpgutah.us'), false);
});

test('shouldAllowNavigation: rejects an unparseable URL', () => {
  assert.equal(shouldAllowNavigation('not a url', 'rmpgutah.us'), false);
});

test('shouldAllowNavigation: allows the local offline fallback page (data: URL is the one deliberate exception — guarded by exact prefix)', () => {
  // getOfflineHTML() in main.js builds a data:text/html,... URL for the
  // offline fallback screen. Navigation TO it happens via mainWindow.loadURL()
  // directly (not a renderer-driven navigation event), so will-navigate
  // never actually fires for it — this test documents that assumption
  // rather than special-casing data: URLs as generally allowed.
  assert.equal(shouldAllowNavigation('data:text/html;charset=utf-8,%3Chtml%3E', 'rmpgutah.us'), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: FAIL — `shouldAllowNavigation is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/sessionHardening.js`, above `module.exports`:

```js
/**
 * Decision function for the main window's 'will-navigate' guard. Only
 * same-host http(s) navigation is allowed; everything else (a different
 * host, a data:/javascript: scheme, an unparseable URL) is rejected.
 * This complements the pre-existing setWindowOpenHandler, which governs
 * NEW windows/tabs rather than navigation of the existing one.
 */
function shouldAllowNavigation(targetUrl, expectedHost) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  return parsed.host === expectedHost;
}
```

Update `module.exports` to add `shouldAllowNavigation`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: PASS — 11 tests passing

- [ ] **Step 5: Wire into `main.js`**

Extend the import line to also destructure `shouldAllowNavigation`. In `createMainWindow()`, after the existing `mainWindow.webContents.setWindowOpenHandler(...)` block (search for it to find the exact spot), add:

```js
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!shouldAllowNavigation(url, TRUSTED_HOST)) {
      console.warn('[SECURITY] Blocked navigation to untrusted URL:', url);
      event.preventDefault();
    }
  });
```

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/main.js`
Expected: exit code 0

- [ ] **Step 7: Commit**

```bash
git add desktop/security/sessionHardening.js desktop/security/__tests__/sessionHardening.test.js desktop/main.js
git commit -m "desktop: add will-navigate guard via shouldAllowNavigation"
```

---

### Task 4: `hardenWebPreferencesDefaults` — single source of truth for `webPreferences`

**Files:**
- Modify: `desktop/security/sessionHardening.js`
- Modify: `desktop/main.js` (both `createSplashWindow()` and `createMainWindow()`)
- Test: `desktop/security/__tests__/sessionHardening.test.js`

**Interfaces:**
- Produces: `hardenWebPreferencesDefaults(overrides = {})` — pure function, returns a `webPreferences`-shaped object merging a fixed hardened baseline with caller-supplied `overrides` (overrides win, so `createMainWindow` can still add its own `preload`/`backgroundThrottling`). Later groups (Group E's `openSecondaryWindow`) must call this too rather than hand-rolling `webPreferences` — noted here for the record, not wired by this task since that function doesn't exist yet.

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/sessionHardening.test.js`:

```js
const { hardenWebPreferencesDefaults } = require('../sessionHardening');

test('hardenWebPreferencesDefaults: returns the hardened baseline with no overrides', () => {
  const prefs = hardenWebPreferencesDefaults();
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.webSecurity, true);
  assert.equal(prefs.webviewTag, false);
  assert.equal(prefs.experimentalFeatures, false);
  assert.equal(prefs.allowRunningInsecureContent, false);
  assert.equal(prefs.enableWebSQL, false);
});

test('hardenWebPreferencesDefaults: caller overrides win over the baseline', () => {
  const prefs = hardenWebPreferencesDefaults({ preload: '/path/to/preload.js', backgroundThrottling: false });
  assert.equal(prefs.preload, '/path/to/preload.js');
  assert.equal(prefs.backgroundThrottling, false);
  // baseline values not overridden are still present
  assert.equal(prefs.contextIsolation, true);
});

test('hardenWebPreferencesDefaults: an override cannot silently re-enable a security-critical flag by accident-proofing (documents intent, not enforced)', () => {
  // If a caller explicitly passes contextIsolation: false, that IS honored —
  // this function centralizes defaults, it does not forbid an override.
  // This test documents that behavior so it is a deliberate, visible choice
  // rather than a surprise.
  const prefs = hardenWebPreferencesDefaults({ contextIsolation: false });
  assert.equal(prefs.contextIsolation, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: FAIL — `hardenWebPreferencesDefaults is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/sessionHardening.js`, above `module.exports`:

```js
/**
 * Single source of truth for webPreferences security defaults. Every
 * BrowserWindow this shell creates should build its webPreferences via
 * this function rather than hand-rolling the flag list, so a future
 * window (e.g. a Group E secondary window) can't accidentally ship with
 * a weaker configuration than the main window.
 */
function hardenWebPreferencesDefaults(overrides = {}) {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    webviewTag: false,
    experimentalFeatures: false,
    allowRunningInsecureContent: false,
    enableWebSQL: false,
    ...overrides,
  };
}
```

Update `module.exports` to add `hardenWebPreferencesDefaults`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: PASS — 14 tests passing

- [ ] **Step 5: Wire into `main.js`'s two `BrowserWindow` constructors**

Extend the import line to also destructure `hardenWebPreferencesDefaults`.

In `createSplashWindow()`, replace:
```js
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
```
with:
```js
    webPreferences: hardenWebPreferencesDefaults(),
```

In `createMainWindow()`, replace:
```js
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // Keep the renderer running at full rate when the window is minimized,
      // occluded, or otherwise not focused. Chromium throttles background
      // windows by default — setInterval clamped to ~1/min, rAF paused — which
      // slowed the nav trip engine's 15s route-upload + 30s auto-end checks to
      // a crawl whenever the officer switched away from the CAD. The GPS NMEA
      // reader lives in the main process (never throttled), but the detection +
      // upload logic runs here in the renderer, so it must not be throttled for
      // navigation to keep calculating + recording movement off-screen.
      backgroundThrottling: false,
    },
```
with:
```js
    webPreferences: hardenWebPreferencesDefaults({
      preload: path.join(__dirname, 'preload.js'),
      // Keep the renderer running at full rate when the window is minimized,
      // occluded, or otherwise not focused. Chromium throttles background
      // windows by default — setInterval clamped to ~1/min, rAF paused — which
      // slowed the nav trip engine's 15s route-upload + 30s auto-end checks to
      // a crawl whenever the officer switched away from the CAD. The GPS NMEA
      // reader lives in the main process (never throttled), but the detection +
      // upload logic runs here in the renderer, so it must not be throttled for
      // navigation to keep calculating + recording movement off-screen.
      backgroundThrottling: false,
    }),
```
(`webSecurity: true` and `contextIsolation`/`nodeIntegration` are now supplied by the baseline — do not repeat them.)

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/main.js`
Expected: exit code 0

- [ ] **Step 7: Commit**

```bash
git add desktop/security/sessionHardening.js desktop/security/__tests__/sessionHardening.test.js desktop/main.js
git commit -m "desktop: centralize webPreferences via hardenWebPreferencesDefaults"
```

---

### Task 5: `shouldAllowNewWindow` — harden `setWindowOpenHandler`

**Files:**
- Modify: `desktop/security/sessionHardening.js`
- Modify: `desktop/main.js`
- Test: `desktop/security/__tests__/sessionHardening.test.js`

**Interfaces:**
- Produces: `shouldAllowNewWindow(targetUrl, expectedHost)` — pure function, returns `{ action: 'allow' | 'deny' | 'external' }`. `'allow'` = same-host, let Electron open it as a new in-app window; `'external'` = a different but legitimate http(s) host, hand off to `shell.openExternal` (matches the pre-existing behavior); `'deny'` = any non-http(s) scheme (`javascript:`, `data:`, `file:`, etc.) or an unparseable URL.

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/sessionHardening.test.js`:

```js
const { shouldAllowNewWindow } = require('../sessionHardening');

test('shouldAllowNewWindow: allows same-host http(s)', () => {
  assert.deepEqual(shouldAllowNewWindow('https://rmpgutah.us/print', 'rmpgutah.us'), { action: 'allow' });
});

test('shouldAllowNewWindow: routes a different http(s) host external', () => {
  assert.deepEqual(shouldAllowNewWindow('https://maps.google.com/?q=1', 'rmpgutah.us'), { action: 'external' });
});

test('shouldAllowNewWindow: denies a javascript: URL', () => {
  assert.deepEqual(shouldAllowNewWindow('javascript:alert(1)', 'rmpgutah.us'), { action: 'deny' });
});

test('shouldAllowNewWindow: denies a data: URL', () => {
  assert.deepEqual(shouldAllowNewWindow('data:text/html,x', 'rmpgutah.us'), { action: 'deny' });
});

test('shouldAllowNewWindow: denies an unparseable URL', () => {
  assert.deepEqual(shouldAllowNewWindow('not a url', 'rmpgutah.us'), { action: 'deny' });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: FAIL — `shouldAllowNewWindow is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/sessionHardening.js`, above `module.exports`:

```js
/**
 * Decision function for setWindowOpenHandler. Replaces the pre-existing
 * inline check (which implicitly allowed anything that merely CONTAINED
 * serverHost as a substring, and implicitly allowed non-http(s) schemes
 * by falling through to { action: 'allow' }) with an explicit allow-list:
 * only http(s) URLs are ever considered; same-host opens in-app, a
 * different host opens externally, anything else is denied outright.
 */
function shouldAllowNewWindow(targetUrl, expectedHost) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { action: 'deny' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { action: 'deny' };
  }
  return parsed.host === expectedHost ? { action: 'allow' } : { action: 'external' };
}
```

Update `module.exports` to add `shouldAllowNewWindow`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: PASS — 19 tests passing

- [ ] **Step 5: Wire into `main.js`, replacing the existing handler**

Extend the import line to also destructure `shouldAllowNewWindow`. Replace the existing block:

```js
  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http') && !url.includes(serverHost)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
```

with:

```js
  // Open external links in default browser; deny anything that isn't http(s)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const decision = shouldAllowNewWindow(url, serverHost);
    if (decision.action === 'external') {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return decision.action === 'allow' ? { action: 'allow' } : { action: 'deny' };
  });
```

(`serverHost` here is the existing local `const serverHost = TRUSTED_HOST;` binding from `createMainWindow()`, unchanged — reuse it, don't introduce a second name.)

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/main.js`
Expected: exit code 0

- [ ] **Step 7: Commit**

```bash
git add desktop/security/sessionHardening.js desktop/security/__tests__/sessionHardening.test.js desktop/main.js
git commit -m "desktop: harden setWindowOpenHandler via shouldAllowNewWindow"
```

---

### Task 6: `disableRemoteModuleAndInsecureDefaults` — explicit Electron security flag assertions

**Files:**
- Modify: `desktop/security/sessionHardening.js`
- Modify: `desktop/main.js`
- Test: `desktop/security/__tests__/sessionHardening.test.js`

**Interfaces:**
- Produces: `assertSecureElectronDefaults(app)` — takes the Electron `app` module, returns `{ ok: true }` or `{ ok: false, violations: string[] }`. Checks `app.commandLine` for any dev-only flag that would weaken security if present in a packaged build (`disable-web-security`, `allow-file-access-from-files`, `no-sandbox` is intentionally NOT flagged here since Electron may legitimately run without OS-level sandboxing depending on platform packaging — only flags that directly disable a security *check* are covered). Non-Electron-runtime part (the flag list, the decision logic) is pure and tested via a fake `app.commandLine`-shaped object; the wiring is a one-line call in `main.js`.

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/sessionHardening.test.js`:

```js
const { assertSecureElectronDefaults } = require('../sessionHardening');

function fakeApp(enabledSwitches) {
  return {
    commandLine: {
      hasSwitch: (name) => enabledSwitches.includes(name),
    },
  };
}

test('assertSecureElectronDefaults: ok when no insecure switches are set', () => {
  assert.deepEqual(assertSecureElectronDefaults(fakeApp([])), { ok: true });
});

test('assertSecureElectronDefaults: flags disable-web-security', () => {
  const result = assertSecureElectronDefaults(fakeApp(['disable-web-security']));
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes('disable-web-security'));
});

test('assertSecureElectronDefaults: flags multiple insecure switches at once', () => {
  const result = assertSecureElectronDefaults(fakeApp(['disable-web-security', 'allow-file-access-from-files']));
  assert.equal(result.violations.length, 2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: FAIL — `assertSecureElectronDefaults is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/sessionHardening.js`, above `module.exports`:

```js
const INSECURE_COMMAND_LINE_SWITCHES = [
  'disable-web-security',
  'allow-file-access-from-files',
  'allow-running-insecure-content',
  'ignore-certificate-errors',
];

/**
 * Startup assertion: none of the known security-weakening Chromium
 * command-line switches should ever be active. These are normally only
 * set for local debugging (e.g. --disable-web-security to bypass CORS
 * while pointed at a dev server) and must never ship in a packaged build.
 */
function assertSecureElectronDefaults(app) {
  const violations = INSECURE_COMMAND_LINE_SWITCHES.filter((flag) => app.commandLine.hasSwitch(flag));
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
```

Update `module.exports` to add `assertSecureElectronDefaults`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: PASS — 22 tests passing

- [ ] **Step 5: Wire into `main.js`**

Extend the import line to also destructure `assertSecureElectronDefaults`. In the `app.whenReady()` block, alongside the existing `DEV_MODE` self-audit block from Group G's Task 12 (search for `[SECURITY] Unguarded IPC handlers detected`), add a sibling check right after it:

```js
  const secureDefaultsResult = assertSecureElectronDefaults(app);
  if (!secureDefaultsResult.ok) {
    console.error('[SECURITY] Insecure Electron command-line switches active:', secureDefaultsResult.violations);
  }
```

(Not gated behind `DEV_MODE` — this check is cheap and should run in every build, since a packaged build with one of these flags active is exactly the failure mode it exists to catch.)

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/main.js`
Expected: exit code 0

- [ ] **Step 7: Commit**

```bash
git add desktop/security/sessionHardening.js desktop/security/__tests__/sessionHardening.test.js desktop/main.js
git commit -m "desktop: assert no insecure Electron command-line switches at startup"
```

---

### Task 7: `restrictDevToolsInProduction` — gate the "Toggle DevTools" menu item

**Files:**
- Modify: `desktop/security/sessionHardening.js`
- Modify: `desktop/main.js`
- Test: `desktop/security/__tests__/sessionHardening.test.js`

**Interfaces:**
- Produces: `shouldExposeDevToolsMenuItem(isPackaged)` — pure function, returns `boolean` (`true` only when `isPackaged` is `false`, i.e. a dev run). Confirmed gap: `createMenu()`'s "Toggle DevTools" item (`desktop/main.js`, `View` submenu) is currently added unconditionally, with no `app.isPackaged` check anywhere in the file.

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/sessionHardening.test.js`:

```js
const { shouldExposeDevToolsMenuItem } = require('../sessionHardening');

test('shouldExposeDevToolsMenuItem: true when not packaged (dev run)', () => {
  assert.equal(shouldExposeDevToolsMenuItem(false), true);
});

test('shouldExposeDevToolsMenuItem: false when packaged (production build)', () => {
  assert.equal(shouldExposeDevToolsMenuItem(true), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: FAIL — `shouldExposeDevToolsMenuItem is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/sessionHardening.js`, above `module.exports`:

```js
/**
 * The application menu's "Toggle DevTools" item exposes the renderer's
 * DevTools console, which can call every window.electron.* preload API
 * directly — fine for development, an unnecessary attack surface in a
 * packaged production build handed to an officer.
 */
function shouldExposeDevToolsMenuItem(isPackaged) {
  return !isPackaged;
}
```

Update `module.exports` to add `shouldExposeDevToolsMenuItem`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: PASS — 24 tests passing

- [ ] **Step 5: Wire into `main.js`'s `createMenu()`**

Extend the import line to also destructure `shouldExposeDevToolsMenuItem`. Find the `View` submenu block in `createMenu()`:

```js
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
```

Replace with a conditionally-included DevTools item:

```js
    {
      label: 'View',
      submenu: [
        ...(shouldExposeDevToolsMenuItem(app.isPackaged) ? [
          {
            label: 'Toggle DevTools',
            accelerator: 'CmdOrCtrl+Shift+I',
            click: () => mainWindow?.webContents.toggleDevTools(),
          },
          { type: 'separator' },
        ] : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
```

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/main.js`
Expected: exit code 0

- [ ] **Step 7: Commit**

```bash
git add desktop/security/sessionHardening.js desktop/security/__tests__/sessionHardening.test.js desktop/main.js
git commit -m "desktop: hide Toggle DevTools menu item in packaged builds"
```

---

### Task 8: `lockDownAutoUpdaterTransport` — assert the update feed is always https

**Files:**
- Modify: `desktop/security/sessionHardening.js`
- Modify: `desktop/updater.js`
- Test: `desktop/security/__tests__/sessionHardening.test.js`

**Interfaces:**
- Produces: `isSecureUpdateFeedUrl(url)` — pure function, returns `boolean` (`true` only for an `https:` URL). Wired as a startup assertion inside `AppUpdater.init()`, immediately after `autoUpdater.setFeedURL(...)` — if the configured feed URL is ever changed to something insecure, this throws loudly rather than silently letting the app auto-install updates fetched over an insecure channel.

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/sessionHardening.test.js`:

```js
const { isSecureUpdateFeedUrl } = require('../sessionHardening');

test('isSecureUpdateFeedUrl: true for an https URL', () => {
  assert.equal(isSecureUpdateFeedUrl('https://api.rmpgutah.us/updates/'), true);
});

test('isSecureUpdateFeedUrl: false for an http URL', () => {
  assert.equal(isSecureUpdateFeedUrl('http://api.rmpgutah.us/updates/'), false);
});

test('isSecureUpdateFeedUrl: false for an unparseable value', () => {
  assert.equal(isSecureUpdateFeedUrl('not a url'), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: FAIL — `isSecureUpdateFeedUrl is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/sessionHardening.js`, above `module.exports`:

```js
/**
 * The auto-updater downloads and silently installs whatever it finds at
 * this URL (electron-updater's 'generic' provider). It must always be
 * https — this is a startup assertion against that URL ever regressing
 * to plain http, not a runtime network check.
 */
function isSecureUpdateFeedUrl(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}
```

Update `module.exports` to add `isSecureUpdateFeedUrl`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: PASS — 27 tests passing

- [ ] **Step 5: Wire into `desktop/updater.js`**

At the top of `desktop/updater.js`, add the import:

```js
const { isSecureUpdateFeedUrl } = require('./security/sessionHardening');
```

In `AppUpdater.init(serverUrl, guardedOn)`, immediately after the existing `autoUpdater.setFeedURL({...})` call, add:

```js
    const feedUrl = 'https://api.rmpgutah.us/updates/';
    if (!isSecureUpdateFeedUrl(feedUrl)) {
      throw new Error('[UPDATER] Refusing to start: update feed URL is not https');
    }
```

(This duplicates the literal URL already inlined in `setFeedURL`'s config object — that's intentional: the assertion checks the actual value being configured, not a re-derived one, so a future edit to the feed URL can't silently skip the check by only updating one of the two spots... actually, to avoid two literals drifting apart, instead extract the URL to a local constant first and use it in both places:)

Replace:
```js
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: 'https://api.rmpgutah.us/updates/',
    });
```
with:
```js
    const feedUrl = 'https://api.rmpgutah.us/updates/';
    if (!isSecureUpdateFeedUrl(feedUrl)) {
      throw new Error('[UPDATER] Refusing to start: update feed URL is not https');
    }
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: feedUrl,
    });
```
(and do NOT add the separate duplicated block described above — this single replacement is the whole change.)

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/updater.js`
Expected: exit code 0

- [ ] **Step 7: Commit**

```bash
git add desktop/security/sessionHardening.js desktop/security/__tests__/sessionHardening.test.js desktop/updater.js
git commit -m "desktop: assert auto-updater feed URL is https via isSecureUpdateFeedUrl"
```

---

### Task 9: `pinCertificateOrValidateTls` — pinned-host TLS audit logging

**Files:**
- Modify: `desktop/security/sessionHardening.js`
- Modify: `desktop/main.js`
- Test: `desktop/security/__tests__/sessionHardening.test.js`

**Interfaces:**
- Produces: `shouldAuditCertificateVerification(hostname, pinnedHosts)` — pure function, returns `boolean` (`true` if `hostname` is in `pinnedHosts`). `createCertificateVerifyProc(pinnedHosts, logFn)` — returns a function matching Electron's `ses.setCertificateVerifyProc(proc)` signature: `(request, callback) => void`. Per this plan's Global Constraints scope decision, the returned proc ALWAYS calls `callback(-3)` (defer to Chromium's own verification result) — it only conditionally calls `logFn(...)` first when the hostname is pinned and `request.verificationResult !== 'net::OK'`. It never overrides Chromium's accept/reject decision.

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/sessionHardening.test.js`:

```js
const { shouldAuditCertificateVerification, createCertificateVerifyProc } = require('../sessionHardening');

test('shouldAuditCertificateVerification: true for a pinned host', () => {
  assert.equal(shouldAuditCertificateVerification('api.rmpgutah.us', ['api.rmpgutah.us', 'rmpgutah.us']), true);
});

test('shouldAuditCertificateVerification: false for a non-pinned host', () => {
  assert.equal(shouldAuditCertificateVerification('example.com', ['api.rmpgutah.us', 'rmpgutah.us']), false);
});

test('createCertificateVerifyProc: always defers to Chromium (-3), never overrides', () => {
  const logs = [];
  const proc = createCertificateVerifyProc(['api.rmpgutah.us'], (msg) => logs.push(msg));
  let calledWith;
  proc({ hostname: 'api.rmpgutah.us', verificationResult: 'net::OK' }, (v) => { calledWith = v; });
  assert.equal(calledWith, -3);
  assert.equal(logs.length, 0, 'should not log when verification succeeded');
});

test('createCertificateVerifyProc: logs an audit warning for a pinned host with a failed verification result, but still defers to Chromium', () => {
  const logs = [];
  const proc = createCertificateVerifyProc(['api.rmpgutah.us'], (msg) => logs.push(msg));
  let calledWith;
  proc({ hostname: 'api.rmpgutah.us', verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID' }, (v) => { calledWith = v; });
  assert.equal(calledWith, -3);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /api\.rmpgutah\.us/);
  assert.match(logs[0], /ERR_CERT_AUTHORITY_INVALID/);
});

test('createCertificateVerifyProc: never logs for a non-pinned host, even on failure', () => {
  const logs = [];
  const proc = createCertificateVerifyProc(['api.rmpgutah.us'], (msg) => logs.push(msg));
  let calledWith;
  proc({ hostname: 'some-other-host.example', verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID' }, (v) => { calledWith = v; });
  assert.equal(calledWith, -3);
  assert.equal(logs.length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: FAIL — `shouldAuditCertificateVerification is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/sessionHardening.js`, above `module.exports`:

```js
function shouldAuditCertificateVerification(hostname, pinnedHosts) {
  return pinnedHosts.includes(hostname);
}

/**
 * Returns an Electron ses.setCertificateVerifyProc-compatible function.
 * Per this plan's Global Constraints (no real SPKI pin value available
 * yet), this NEVER overrides Chromium's own trust decision — callback(-3)
 * unconditionally means "use Chromium's own verification result" per
 * Electron's session docs. Its only job is visibility: for the hosts we
 * actually care about, log when Chromium's verification did NOT come
 * back clean, so an anomaly (e.g. an unexpected corporate TLS proxy) is
 * observable instead of silently accepted-or-rejected with no trace.
 */
function createCertificateVerifyProc(pinnedHosts, logFn) {
  return function verifyProc(request, callback) {
    const { hostname, verificationResult } = request;
    if (shouldAuditCertificateVerification(hostname, pinnedHosts) && verificationResult !== 'net::OK') {
      logFn(`[SECURITY] TLS verification for pinned host "${hostname}" did not return net::OK: ${verificationResult}`);
    }
    callback(-3);
  };
}
```

Update `module.exports` to add `shouldAuditCertificateVerification` and `createCertificateVerifyProc`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: PASS — 31 tests passing

- [ ] **Step 5: Wire into `main.js`**

Extend the import line to also destructure `createCertificateVerifyProc`. In `createMainWindow()`, after the `installContentSecurityPolicy(mainWindow.webContents.session);` line added in Task 1, add:

```js
  mainWindow.webContents.session.setCertificateVerifyProc(
    createCertificateVerifyProc([TRUSTED_HOST, 'api.rmpgutah.us'], (msg) => console.warn(msg))
  );
```

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/main.js`
Expected: exit code 0

- [ ] **Step 7: Commit**

```bash
git add desktop/security/sessionHardening.js desktop/security/__tests__/sessionHardening.test.js desktop/main.js
git commit -m "desktop: add pinned-host TLS verification audit logging"
```

---

### Task 10: `resolveTrustedPreloadPath` — restrict `BrowserWindow` preload paths

**Files:**
- Modify: `desktop/security/sessionHardening.js`
- Modify: `desktop/main.js`
- Test: `desktop/security/__tests__/sessionHardening.test.js`

**Interfaces:**
- Produces: `resolveTrustedPreloadPath(requestedPath, allowedPath)` — pure function, returns `allowedPath` if `path.resolve(requestedPath) === path.resolve(allowedPath)`, otherwise throws. This is deliberately strict (exact match, not a directory-prefix check like Group G's `validateFilePathInput`) because there is exactly one legitimate preload script (`desktop/preload.js`) and no reason for any code path to ever load a different one.

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/sessionHardening.test.js`:

```js
const path = require('node:path');
const { resolveTrustedPreloadPath } = require('../sessionHardening');

test('resolveTrustedPreloadPath: returns the path when it exactly matches the allowed one', () => {
  const allowed = path.resolve('/app/desktop/preload.js');
  assert.equal(resolveTrustedPreloadPath(allowed, allowed), allowed);
});

test('resolveTrustedPreloadPath: returns the path when it resolves to the same file via a relative form', () => {
  const allowed = path.resolve('/app/desktop/preload.js');
  const relative = path.join('/app/desktop', '.', 'preload.js');
  assert.equal(resolveTrustedPreloadPath(relative, allowed), allowed);
});

test('resolveTrustedPreloadPath: throws for any other path', () => {
  const allowed = path.resolve('/app/desktop/preload.js');
  assert.throws(() => resolveTrustedPreloadPath('/tmp/malicious-preload.js', allowed), /untrusted preload path/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: FAIL — `resolveTrustedPreloadPath is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add `const path = require('path');` near the top of `desktop/security/sessionHardening.js` (this file has no existing `path` import — add it as the first line after `'use strict';`). Then add, above `module.exports`:

```js
/**
 * The main window is the only BrowserWindow with a preload script today,
 * and it must always be exactly desktop/preload.js. A future BrowserWindow
 * (e.g. a Group E secondary window) that wants a preload script should
 * call this with its own requested path and the same fixed allowed path,
 * so a typo or a renderer-influenced path can never load an unintended
 * script with Node access.
 */
function resolveTrustedPreloadPath(requestedPath, allowedPath) {
  const resolvedRequested = path.resolve(requestedPath);
  const resolvedAllowed = path.resolve(allowedPath);
  if (resolvedRequested !== resolvedAllowed) {
    throw new Error(`untrusted preload path: "${resolvedRequested}" !== "${resolvedAllowed}"`);
  }
  return resolvedAllowed;
}
```

Update `module.exports` to add `resolveTrustedPreloadPath`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test 'security/__tests__/sessionHardening.test.js'`
Expected: PASS — 34 tests passing

- [ ] **Step 5: Wire into `main.js`**

Extend the import line to also destructure `resolveTrustedPreloadPath`. In `createMainWindow()`, inside the `hardenWebPreferencesDefaults({...})` call from Task 4, change:

```js
    webPreferences: hardenWebPreferencesDefaults({
      preload: path.join(__dirname, 'preload.js'),
```

to:

```js
    webPreferences: hardenWebPreferencesDefaults({
      preload: resolveTrustedPreloadPath(path.join(__dirname, 'preload.js'), path.join(__dirname, 'preload.js')),
```

(Both arguments are identical today — this looks redundant, and it is, for this single call site. That's intentional: it establishes the pattern now, so when Group E's `openSecondaryWindow(path, opts)` is implemented, its preload — if it has one — is required to go through the same check against the one fixed `allowedPath`, rather than trusting a caller-supplied `opts.preload` directly.)

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/main.js`
Expected: exit code 0

- [ ] **Step 7: Commit**

```bash
git add desktop/security/sessionHardening.js desktop/security/__tests__/sessionHardening.test.js desktop/main.js
git commit -m "desktop: restrict BrowserWindow preload path via resolveTrustedPreloadPath"
```

---

### Task 11: Final verification pass

**Files:** none changed — verification only.

- [ ] **Step 1: Run the full sessionHardening + ipcGuard suites**

Run: `cd desktop && node --test 'security/__tests__/**/*.js'`
Expected: PASS — 34 `sessionHardening` tests + 46 `ipcGuard` tests = 80 tests, 0 failing.

- [ ] **Step 2: Confirm both modified files still parse cleanly**

Run: `node --check desktop/main.js && node --check desktop/updater.js`
Expected: exit code 0, no output.

- [ ] **Step 3: Confirm CSP is Report-Only, not enforcing (scope guard)**

Run: `grep -n "Content-Security-Policy" desktop/security/sessionHardening.js`
Expected: only `Content-Security-Policy-Report-Only` appears — if a plain `Content-Security-Policy` header was introduced anywhere, that's a scope violation of this plan's Global Constraints and must be reverted to Report-Only before this ships.

- [ ] **Step 4: Confirm the cert-verify proc never returns anything but -3**

Run: `grep -n "callback(" desktop/security/sessionHardening.js`
Expected: the only `callback(...)` call inside `createCertificateVerifyProc` is `callback(-3)` — if `callback(0)` or `callback(-2)` appears, that's a scope violation (this task's design explicitly defers every decision to Chromium) and must be reverted.

- [ ] **Step 5: Full manual dev-run smoke test (same known limitation as Group G)**

Run: `cd desktop && npm start`
Expected: app launches, reaches the normal login/dashboard screen. If a real display server is available: open DevTools' console and confirm CSP-Report-Only violation messages (if any) are visible but nothing is blocked; confirm geolocation/notifications still prompt/work normally when the app is loaded from the real `rmpgutah.us` origin; confirm the "Toggle DevTools" menu item is present in a `--dev` run. If no display server is available in this environment (same constraint as every task in Group G), say so explicitly rather than skipping silently, and rely on Steps 1-4's static checks instead.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "desktop: complete Group F (process/session hardening) — 80 tests passing"
```
