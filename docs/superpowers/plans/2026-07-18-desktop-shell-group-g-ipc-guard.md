# Desktop Shell — Group G (IPC Sender/Input Validation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `desktop/security/ipcGuard.js` — the foundational IPC sender-origin and input-validation layer for the Electron shell — and retrofit it onto every existing `ipcMain` handler in `desktop/main.js`, per PR 1 of the 10-PR sequence in [`docs/superpowers/specs/2026-07-18-desktop-shell-functions-and-hardening-design.md`](../specs/2026-07-18-desktop-shell-functions-and-hardening-design.md) (Group G).

**Architecture:** A new `desktop/security/ipcGuard.js` module exports pure, Electron-independent validator functions plus two thin wrapper factories (`guardedHandle`/`guardedOn`) that main.js uses in place of raw `ipcMain.handle`/`ipcMain.on`. Every existing registration in `main.js` is mechanically converted to use the wrappers, so sender-origin validation becomes structural (impossible to add a new handler without it) rather than a convention to remember.

**Tech Stack:** Plain Node.js (CommonJS, matches existing `desktop/*.js` files), Electron's `ipcMain`/`event.senderFrame`, Node's built-in `node:test` + `node:assert/strict` test runner (no new devDependency — `desktop/package.json` has no existing test tooling).

## Global Constraints

- Match existing `desktop/*.js` file conventions: CommonJS (`require`/`module.exports`), no TypeScript, header comment block matching the style in `desktop/pinManager.js`/`desktop/connectivityMonitor.js`.
- `desktop/security/ipcGuard.js` functions that don't touch Electron APIs directly must be unit-testable with zero Electron runtime (construct fake `event`/`ipcMain` objects) — this repo has no Electron test harness today, and adding one is out of scope.
- Every new file added under `desktop/security/` must be added to `desktop/package.json`'s `build.files` array or `electron-builder` will silently omit it from packaged builds (documented gotcha from the spec's Sequencing Note).
- Never change existing handler *behavior* for a legitimately-trusted call — only reject calls that fail the new sender-origin check. A same-origin renderer call that worked before this PR must still work identically after it.
- Commit after each task (matches this repo's PR-flow preference — see CLAUDE.md deploy conventions).

---

### Task 1: `validateIpcSenderOrigin` — core sender-origin validator

**Files:**
- Create: `desktop/security/ipcGuard.js`
- Test: `desktop/security/__tests__/ipcGuard.test.js`

**Interfaces:**
- Produces: `validateIpcSenderOrigin(event, expectedHost)` — throws `Error` with message starting `IPC_UNTRUSTED_SENDER:` if `event.senderFrame` is missing/unparseable or its host doesn't match `expectedHost`; returns `true` otherwise. Later tasks in this plan and future groups' plans call this directly or via `guardedHandle`/`guardedOn` (Task 2).

- [ ] **Step 1: Write the failing test**

Create `desktop/security/__tests__/ipcGuard.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateIpcSenderOrigin } = require('../ipcGuard');

test('validateIpcSenderOrigin: accepts a matching host', () => {
  const event = { senderFrame: { url: 'https://rmpgutah.us/dispatch' } };
  assert.equal(validateIpcSenderOrigin(event, 'rmpgutah.us'), true);
});

test('validateIpcSenderOrigin: accepts a matching host with a port (dev server)', () => {
  const event = { senderFrame: { url: 'http://localhost:5173/dispatch' } };
  assert.equal(validateIpcSenderOrigin(event, 'localhost:5173'), true);
});

test('validateIpcSenderOrigin: rejects a mismatched host', () => {
  const event = { senderFrame: { url: 'https://evil.example/phish' } };
  assert.throws(
    () => validateIpcSenderOrigin(event, 'rmpgutah.us'),
    /IPC_UNTRUSTED_SENDER/
  );
});

test('validateIpcSenderOrigin: rejects a missing senderFrame', () => {
  const event = {};
  assert.throws(
    () => validateIpcSenderOrigin(event, 'rmpgutah.us'),
    /IPC_UNTRUSTED_SENDER/
  );
});

test('validateIpcSenderOrigin: rejects an unparseable sender URL', () => {
  const event = { senderFrame: { url: 'not-a-url' } };
  assert.throws(
    () => validateIpcSenderOrigin(event, 'rmpgutah.us'),
    /IPC_UNTRUSTED_SENDER/
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test desktop/security/__tests__/ipcGuard.test.js`
Expected: FAIL — `Cannot find module '../ipcGuard'`

- [ ] **Step 3: Write the minimal implementation**

Create `desktop/security/ipcGuard.js`:

```js
// ============================================================
// RMPG Flex — IPC Guard
// Sender-origin and input validation for every ipcMain handler.
// Wraps ipcMain.handle/ipcMain.on so a new handler cannot be
// registered without going through validateIpcSenderOrigin first.
// ============================================================

'use strict';

const { URL } = require('url');

/**
 * Throws if the IPC call's sender frame doesn't match expectedHost.
 * Returns true on success (never returns false — callers branch on throw).
 */
function validateIpcSenderOrigin(event, expectedHost) {
  if (!event || !event.senderFrame || typeof event.senderFrame.url !== 'string') {
    throw new Error('IPC_UNTRUSTED_SENDER: missing senderFrame');
  }
  let host;
  try {
    host = new URL(event.senderFrame.url).host;
  } catch {
    throw new Error('IPC_UNTRUSTED_SENDER: unparseable sender URL');
  }
  if (host !== expectedHost) {
    throw new Error(`IPC_UNTRUSTED_SENDER: host "${host}" does not match expected "${expectedHost}"`);
  }
  return true;
}

module.exports = {
  validateIpcSenderOrigin,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test desktop/security/__tests__/ipcGuard.test.js`
Expected: PASS — 5 tests passing

- [ ] **Step 5: Add the `test` script and `desktop/security/` to packaging**

Edit `desktop/package.json` — add a `"test"` script under `"scripts"`:

```json
    "start": "electron . --dev",
    "test": "node --test desktop/security/__tests__",
```

(Run from the repo root as `npm --prefix desktop test`, or `cd desktop && node --test security/__tests__` directly — both work since the `test` script path is relative to `desktop/`'s own `package.json`, so it should actually read `"test": "node --test security/__tests__"` — no `desktop/` prefix needed since npm scripts already run with cwd at the package root.)

Also add `"security"` to the `build.files` array (needed so `electron-builder` packages the new directory):

```json
    "files": [
      "main.js",
      "preload.js",
      "updater.js",
      "localDb.js",
      "connectivityMonitor.js",
      "pinManager.js",
      "offlineRouter.js",
      "syncManager.js",
      "internalGps.js",
      "originalCatalog.json",
      "security"
    ],
```

- [ ] **Step 6: Run the test via the new script to confirm it works**

Run: `cd desktop && node --test security/__tests__`
Expected: PASS — 5 tests passing

- [ ] **Step 7: Commit**

```bash
git add desktop/security/ipcGuard.js desktop/security/__tests__/ipcGuard.test.js desktop/package.json
git commit -m "desktop: add validateIpcSenderOrigin IPC guard"
```

---

### Task 2: `guardedHandle`/`guardedOn` wrapper factories

**Files:**
- Modify: `desktop/security/ipcGuard.js`
- Test: `desktop/security/__tests__/ipcGuard.test.js`

**Interfaces:**
- Consumes: `validateIpcSenderOrigin(event, expectedHost)` from Task 1.
- Produces: `createIpcGuards(ipcMain, expectedHost)` returning `{ guardedHandle(channel, handler), guardedOn(channel, handler) }`. `guardedHandle` matches `ipcMain.handle`'s signature exactly (async handler, return value flows to the renderer's `invoke()` promise). `guardedOn` matches `ipcMain.on`'s signature exactly (fire-and-forget, no return value) but swallows+logs rejected sends instead of throwing, since `ipcMain.on` has no promise to reject. Task 3 (main.js retrofit) and every future group's plan call `createIpcGuards` once at startup and use the two returned functions everywhere `ipcMain.handle`/`ipcMain.on` was used before.

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/ipcGuard.test.js`:

```js
const { createIpcGuards } = require('../ipcGuard');

function makeFakeIpcMain() {
  const handlers = new Map();
  const onHandlers = new Map();
  return {
    handle(channel, fn) { handlers.set(channel, fn); },
    on(channel, fn) { onHandlers.set(channel, fn); },
    _invoke(channel, event, ...args) { return handlers.get(channel)(event, ...args); },
    _emit(channel, event, ...args) { return onHandlers.get(channel)(event, ...args); },
  };
}

test('guardedHandle: calls through to the handler for a trusted sender', async () => {
  const fakeIpcMain = makeFakeIpcMain();
  const { guardedHandle } = createIpcGuards(fakeIpcMain, 'rmpgutah.us');
  guardedHandle('test:echo', async (_event, value) => ({ echoed: value }));
  const event = { senderFrame: { url: 'https://rmpgutah.us/dispatch' } };
  const result = await fakeIpcMain._invoke('test:echo', event, 42);
  assert.deepEqual(result, { echoed: 42 });
});

test('guardedHandle: rejects for an untrusted sender without calling the handler', async () => {
  const fakeIpcMain = makeFakeIpcMain();
  let called = false;
  const { guardedHandle } = createIpcGuards(fakeIpcMain, 'rmpgutah.us');
  guardedHandle('test:echo', async () => { called = true; return 'should not run'; });
  const event = { senderFrame: { url: 'https://evil.example/phish' } };
  await assert.rejects(
    () => fakeIpcMain._invoke('test:echo', event, 42),
    /IPC_UNTRUSTED_SENDER/
  );
  assert.equal(called, false);
});

test('guardedOn: calls through to the handler for a trusted sender', () => {
  const fakeIpcMain = makeFakeIpcMain();
  let received = null;
  const { guardedOn } = createIpcGuards(fakeIpcMain, 'rmpgutah.us');
  guardedOn('test:fire', (_event, value) => { received = value; });
  const event = { senderFrame: { url: 'https://rmpgutah.us/dispatch' } };
  fakeIpcMain._emit('test:fire', event, 'payload');
  assert.equal(received, 'payload');
});

test('guardedOn: swallows the call for an untrusted sender without throwing', () => {
  const fakeIpcMain = makeFakeIpcMain();
  let called = false;
  const { guardedOn } = createIpcGuards(fakeIpcMain, 'rmpgutah.us');
  guardedOn('test:fire', () => { called = true; });
  const event = { senderFrame: { url: 'https://evil.example/phish' } };
  assert.doesNotThrow(() => fakeIpcMain._emit('test:fire', event, 'payload'));
  assert.equal(called, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test security/__tests__`
Expected: FAIL — `createIpcGuards is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/ipcGuard.js`, above `module.exports`:

```js
/**
 * Wraps an ipcMain instance so every handle()/on() registration made
 * through the returned guardedHandle/guardedOn validates the sender's
 * frame origin before the real handler runs.
 */
function createIpcGuards(ipcMain, expectedHost) {
  function guardedHandle(channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
      validateIpcSenderOrigin(event, expectedHost);
      return handler(event, ...args);
    });
  }

  function guardedOn(channel, handler) {
    ipcMain.on(channel, (event, ...args) => {
      try {
        validateIpcSenderOrigin(event, expectedHost);
      } catch (err) {
        console.error(`[ipcGuard] rejected "${channel}":`, err.message);
        return;
      }
      handler(event, ...args);
    });
  }

  return { guardedHandle, guardedOn };
}
```

Update `module.exports`:

```js
module.exports = {
  validateIpcSenderOrigin,
  createIpcGuards,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test security/__tests__`
Expected: PASS — 9 tests passing

- [ ] **Step 5: Commit**

```bash
git add desktop/security/ipcGuard.js desktop/security/__tests__/ipcGuard.test.js
git commit -m "desktop: add guardedHandle/guardedOn IPC wrapper factories"
```

---

### Task 3: Retrofit `desktop/main.js` to use `guardedHandle`/`guardedOn`

**Files:**
- Modify: `desktop/main.js:9` (imports), `desktop/main.js:822-827` (reuse host derivation), all 34 `ipcMain.handle(`/`ipcMain.on(` call sites listed below.

**Interfaces:**
- Consumes: `createIpcGuards` from Task 2.
- Produces: a module-scope `TRUSTED_HOST` constant and `guardedHandle`/`guardedOn` bindings that every later group's plan (Groups A-F, H-J) must use instead of raw `ipcMain.handle`/`ipcMain.on` for any new handler they add.

- [ ] **Step 1: Hoist host derivation to module scope**

`main.js` currently derives `serverHost` from `REMOTE_SERVER_URL` inline inside `createMainWindow()` (used only for `setWindowOpenHandler`). Move this to module scope, right after the `REMOTE_SERVER_URL` definition (around line 53-60), so both the window-open handler and the new IPC guard use one canonical value:

```js
// ─── Trusted host (shared by window-open filtering and IPC sender validation) ───
let TRUSTED_HOST;
try {
  TRUSTED_HOST = new URL(REMOTE_SERVER_URL).host;
} catch {
  TRUSTED_HOST = 'rmpgutah.us';
}
```

Then in `createMainWindow()`, replace the existing inline block:

```js
  // Extract the server's hostname for link filtering
  let serverHost;
  try {
    serverHost = new URL(REMOTE_SERVER_URL).host;
  } catch {
    serverHost = 'rmpgutah.us';
  }
```

with:

```js
  // Server hostname for link filtering — derived once at module scope (TRUSTED_HOST)
  const serverHost = TRUSTED_HOST;
```

(Keeps the local `serverHost` name used later in that function's `setWindowOpenHandler` body unchanged, so no other line in `createMainWindow` needs editing.)

- [ ] **Step 2: Import the guard module and create the guarded functions**

Near the top of `main.js`, after the existing `require('./updater')` line (around line 11), add:

```js
const { createIpcGuards } = require('./security/ipcGuard');
```

After the `TRUSTED_HOST` block from Step 1, add:

```js
const { guardedHandle, guardedOn } = createIpcGuards(ipcMain, TRUSTED_HOST);
```

- [ ] **Step 3: Convert all 34 existing registrations**

Every top-level `ipcMain.handle(` and `ipcMain.on(` call in `main.js` becomes `guardedHandle(`/`guardedOn(` — the channel name and handler body are unchanged. Two full worked examples (the pattern is identical for the rest):

Before (line 852):
```js
ipcMain.on('window:minimize', () => mainWindow?.minimize());
```
After:
```js
guardedOn('window:minimize', () => mainWindow?.minimize());
```

Before (line 2530):
```js
ipcMain.handle('offline:enter-pin', (_event, { pin }) => {
  try {
    if (!pinManager) return { success: false, error: 'PIN system not initialized' };
    return pinManager.validatePin(pin);
  } catch (err) {
    console.error('[OFFLINE:PIN] Error:', err.message);
    return { success: false, error: err.message };
  }
});
```
After:
```js
guardedHandle('offline:enter-pin', (_event, { pin }) => {
  try {
    if (!pinManager) return { success: false, error: 'PIN system not initialized' };
    return pinManager.validatePin(pin);
  } catch (err) {
    console.error('[OFFLINE:PIN] Error:', err.message);
    return { success: false, error: err.message };
  }
});
```

Apply the same substitution — `ipcMain.handle(` → `guardedHandle(`, `ipcMain.on(` → `guardedOn(`, nothing else changes — to every remaining top-level registration. Run this from the repo root to do it mechanically, then hand-check the diff:

```bash
cd desktop
sed -i '' \
  -e 's/^ipcMain\.handle(/guardedHandle(/' \
  -e 's/^ipcMain\.on(/guardedOn(/' \
  main.js
```

(macOS/BSD `sed` — the `-i ''` empty-string argument is required on macOS; on Linux, drop it: `sed -i -e ... main.js`.)

- [ ] **Step 2: Verify no raw registrations remain**

Run: `grep -n "^ipcMain\.\(handle\|on\)(" desktop/main.js`
Expected: no output (empty) — every registration now goes through `guardedHandle`/`guardedOn`.

Run: `grep -c "^guardedHandle(\|^guardedOn(" desktop/main.js`
Expected: `34` (matches the pre-change count of top-level `ipcMain.handle`/`ipcMain.on` registrations).

- [ ] **Step 3: Sanity-check the file still parses**

Run: `node --check desktop/main.js`
Expected: no output (exit code 0) — confirms the sed pass didn't break syntax.

- [ ] **Step 4: Manual smoke test (dev-run)**

Run: `cd desktop && npm start`
Expected: app launches, reaches the normal login/dashboard screen exactly as before this change (window controls, offline banner, etc. all still function) — confirms the guarded wrappers don't reject same-origin renderer calls in the real app, not just the unit-test mocks.

- [ ] **Step 5: Commit**

```bash
git add desktop/main.js
git commit -m "desktop: retrofit all ipcMain handlers through guardedHandle/guardedOn"
```

---

### Task 4: `sanitizeReconToolArgs` — validate recon tool spawn arguments

**Files:**
- Modify: `desktop/security/ipcGuard.js`
- Modify: `desktop/main.js` (`recon:tool-spawn` handler, `recon:tool-terminal` handler)
- Test: `desktop/security/__tests__/ipcGuard.test.js`

**Interfaces:**
- Produces: `sanitizeReconToolArgs(toolId, args, catalog)` — returns `{ ok: true }` or `{ ok: false, error }`. Does not throw (matches this shell's existing `{ok, error?}` convention for recon handlers).
- Consumes (from `main.js`, already defined): the existing `RECON_TOOLS` catalog object (keyed by `toolId`).

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/ipcGuard.test.js`:

```js
const { sanitizeReconToolArgs } = require('../ipcGuard');

const FAKE_CATALOG = {
  nmap: { title: 'Nmap' },
  wireshark: { title: 'Wireshark' },
};

test('sanitizeReconToolArgs: accepts a known tool with simple scalar args', () => {
  const result = sanitizeReconToolArgs('nmap', { target: '10.0.0.1', ports: '22,80' }, FAKE_CATALOG);
  assert.deepEqual(result, { ok: true });
});

test('sanitizeReconToolArgs: rejects an unknown toolId', () => {
  const result = sanitizeReconToolArgs('not-a-real-tool', {}, FAKE_CATALOG);
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown tool/);
});

test('sanitizeReconToolArgs: rejects a non-object args value', () => {
  const result = sanitizeReconToolArgs('nmap', 'not-an-object', FAKE_CATALOG);
  assert.equal(result.ok, false);
  assert.match(result.error, /must be an object/);
});

test('sanitizeReconToolArgs: rejects a nested object value inside args', () => {
  const result = sanitizeReconToolArgs('nmap', { target: { nested: true } }, FAKE_CATALOG);
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid value type/);
});

test('sanitizeReconToolArgs: rejects args exceeding the size cap', () => {
  const result = sanitizeReconToolArgs('nmap', { target: 'x'.repeat(5000) }, FAKE_CATALOG);
  assert.equal(result.ok, false);
  assert.match(result.error, /too large/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test security/__tests__`
Expected: FAIL — `sanitizeReconToolArgs is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/ipcGuard.js`, above `module.exports`:

```js
const MAX_RECON_ARGS_BYTES = 4096;

/**
 * Validates a recon-tool spawn request before it reaches child_process.spawn.
 * toolId must be a known key in catalog; args must be a flat object of
 * string/number/boolean values under a total size cap.
 */
function sanitizeReconToolArgs(toolId, args, catalog) {
  if (!catalog || !Object.prototype.hasOwnProperty.call(catalog, toolId)) {
    return { ok: false, error: `Unknown tool: ${toolId}` };
  }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, error: 'args must be an object' };
  }
  for (const [key, value] of Object.entries(args)) {
    const t = typeof value;
    if (t !== 'string' && t !== 'number' && t !== 'boolean') {
      return { ok: false, error: `invalid value type for "${key}"` };
    }
  }
  const serializedSize = Buffer.byteLength(JSON.stringify(args), 'utf8');
  if (serializedSize > MAX_RECON_ARGS_BYTES) {
    return { ok: false, error: `args too large (${serializedSize} bytes, max ${MAX_RECON_ARGS_BYTES})` };
  }
  return { ok: true };
}
```

Update `module.exports` to add `sanitizeReconToolArgs`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test security/__tests__`
Expected: PASS — 14 tests passing

- [ ] **Step 5: Wire into `main.js`'s `recon:tool-spawn` handler**

Add the import (extend the existing Task 3 import line):

```js
const { createIpcGuards, sanitizeReconToolArgs } = require('./security/ipcGuard');
```

In `main.js`, find the `guardedHandle('recon:tool-spawn', ...)` handler body (converted in Task 3) and add a validation call as its first statement:

```js
guardedHandle('recon:tool-spawn', async (event, { toolId, args = {} } = {}) => {
  const argsCheck = sanitizeReconToolArgs(toolId, args, RECON_TOOLS);
  if (!argsCheck.ok) return { ok: false, error: argsCheck.error };
  const { spawn } = require('child_process');
  // ...unchanged rest of the existing handler body...
```

Apply the identical two-line addition (`const argsCheck = sanitizeReconToolArgs(...)`, `if (!argsCheck.ok) return { ok: false, error: argsCheck.error };`, adapted to that handler's own return shape) as the first statement inside `guardedHandle('recon:tool-terminal', ...)` as well, since it takes the same `{ toolId, args }` shape.

- [ ] **Step 6: Manual smoke test**

Run: `cd desktop && npm start`, open the Wireless Pilot / Recon panel, run a known tool (e.g. Nmap) with normal arguments.
Expected: tool runs exactly as before. Then, using the renderer devtools console (dev mode only), call `window.electron.reconToolSpawn('nmap', { x: { nested: true } })` directly.
Expected: resolves to `{ ok: false, error: 'invalid value type for "x"' }` instead of reaching `child_process.spawn`.

- [ ] **Step 7: Commit**

```bash
git add desktop/security/ipcGuard.js desktop/security/__tests__/ipcGuard.test.js desktop/main.js
git commit -m "desktop: validate recon tool-spawn args via sanitizeReconToolArgs"
```

---

### Task 5: `validatePinInput` — validate PIN shape before `pinManager` sees it

**Files:**
- Modify: `desktop/security/ipcGuard.js`
- Modify: `desktop/main.js` (`offline:enter-pin` handler)
- Test: `desktop/security/__tests__/ipcGuard.test.js`

**Interfaces:**
- Produces: `validatePinInput(pin)` — returns `{ ok: true }` or `{ ok: false, error }`. Six-digit numeric string only (matches `pinManager.js`'s `PIN_LENGTH = 6` constant).

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/ipcGuard.test.js`:

```js
const { validatePinInput } = require('../ipcGuard');

test('validatePinInput: accepts a 6-digit numeric string', () => {
  assert.deepEqual(validatePinInput('123456'), { ok: true });
});

test('validatePinInput: rejects a non-string', () => {
  const result = validatePinInput(123456);
  assert.equal(result.ok, false);
});

test('validatePinInput: rejects the wrong length', () => {
  const result = validatePinInput('12345');
  assert.equal(result.ok, false);
});

test('validatePinInput: rejects non-digit characters', () => {
  const result = validatePinInput('12345a');
  assert.equal(result.ok, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test security/__tests__`
Expected: FAIL — `validatePinInput is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/ipcGuard.js`, above `module.exports`:

```js
const PIN_SHAPE = /^\d{6}$/;

/** Defense-in-depth shape check — the renderer UI already constrains this. */
function validatePinInput(pin) {
  if (typeof pin !== 'string' || !PIN_SHAPE.test(pin)) {
    return { ok: false, error: 'PIN must be a 6-digit numeric string' };
  }
  return { ok: true };
}
```

Update `module.exports` to add `validatePinInput`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test security/__tests__`
Expected: PASS — 18 tests passing

- [ ] **Step 5: Wire into `main.js`'s `offline:enter-pin` handler**

Extend the import line:

```js
const { createIpcGuards, sanitizeReconToolArgs, validatePinInput } = require('./security/ipcGuard');
```

Update the handler:

```js
guardedHandle('offline:enter-pin', (_event, { pin }) => {
  const pinCheck = validatePinInput(pin);
  if (!pinCheck.ok) return { success: false, error: pinCheck.error };
  try {
    if (!pinManager) return { success: false, error: 'PIN system not initialized' };
    return pinManager.validatePin(pin);
  } catch (err) {
    console.error('[OFFLINE:PIN] Error:', err.message);
    return { success: false, error: err.message };
  }
});
```

- [ ] **Step 6: Manual smoke test**

Run: `cd desktop && npm start`, enter a valid PIN in the offline-unlock UI.
Expected: unlock flow works exactly as before.

- [ ] **Step 7: Commit**

```bash
git add desktop/security/ipcGuard.js desktop/security/__tests__/ipcGuard.test.js desktop/main.js
git commit -m "desktop: validate PIN shape before pinManager.validatePin"
```

---

### Task 6: `validateUserIdInput` — validate userId shape for offline handlers

**Files:**
- Modify: `desktop/security/ipcGuard.js`
- Modify: `desktop/main.js` (`offline:generate-pin`, `offline:get-cached-user` handlers)
- Test: `desktop/security/__tests__/ipcGuard.test.js`

**Interfaces:**
- Produces: `validateUserIdInput(userId)` — returns `{ ok: true }` or `{ ok: false, error }`. Accepts a positive integer or a numeric string (matches how `userId` arrives from the renderer today — `pinManager.generatePinForUser` does `String(s.user_id) === String(userId)`, so both shapes are legitimate).

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/ipcGuard.test.js`:

```js
const { validateUserIdInput } = require('../ipcGuard');

test('validateUserIdInput: accepts a positive integer', () => {
  assert.deepEqual(validateUserIdInput(42), { ok: true });
});

test('validateUserIdInput: accepts a numeric string', () => {
  assert.deepEqual(validateUserIdInput('42'), { ok: true });
});

test('validateUserIdInput: rejects zero or negative', () => {
  assert.equal(validateUserIdInput(0).ok, false);
  assert.equal(validateUserIdInput(-1).ok, false);
});

test('validateUserIdInput: rejects a non-numeric string', () => {
  assert.equal(validateUserIdInput('DROP TABLE users').ok, false);
});

test('validateUserIdInput: rejects null/undefined', () => {
  assert.equal(validateUserIdInput(null).ok, false);
  assert.equal(validateUserIdInput(undefined).ok, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test security/__tests__`
Expected: FAIL — `validateUserIdInput is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/ipcGuard.js`, above `module.exports`:

```js
function validateUserIdInput(userId) {
  if (userId === null || userId === undefined) {
    return { ok: false, error: 'userId is required' };
  }
  const asNumber = Number(userId);
  if (!Number.isInteger(asNumber) || asNumber <= 0) {
    return { ok: false, error: 'userId must be a positive integer' };
  }
  return { ok: true };
}
```

Update `module.exports` to add `validateUserIdInput`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test security/__tests__`
Expected: PASS — 23 tests passing

- [ ] **Step 5: Wire into `main.js`'s `offline:generate-pin` handler**

Extend the import line to add `validateUserIdInput`, then:

```js
guardedHandle('offline:generate-pin', (_event, { userId }) => {
  const userIdCheck = validateUserIdInput(userId);
  if (!userIdCheck.ok) return { error: userIdCheck.error };
  try {
    if (!pinManager) return { error: 'PIN system not initialized' };
    return pinManager.generatePinForUser(userId);
  } catch (err) {
    console.error('[OFFLINE:GENERATE-PIN] Error:', err.message);
    return { error: err.message };
  }
});
```

`offline:get-cached-user` takes a `username` string, not a `userId` — it is intentionally **not** wired to `validateUserIdInput`. (It gets its own guard, `validateFilePathInput`-style username shape check, in a future Group C/H task — out of scope here per the spec's function-to-validator mapping.)

- [ ] **Step 6: Manual smoke test**

Run: `cd desktop && npm start`, as an admin generate an offline PIN for a real employee.
Expected: PIN generation works exactly as before.

- [ ] **Step 7: Commit**

```bash
git add desktop/security/ipcGuard.js desktop/security/__tests__/ipcGuard.test.js desktop/main.js
git commit -m "desktop: validate userId shape before generatePinForUser"
```

---

### Task 7: `validateFilePathInput` — forward-looking path validator (no wiring yet)

**Files:**
- Modify: `desktop/security/ipcGuard.js`
- Test: `desktop/security/__tests__/ipcGuard.test.js`

**Interfaces:**
- Produces: `validateFilePathInput(candidatePath, allowedRoots)` — returns `{ ok: true, resolved }` or `{ ok: false, error }`. Resolves `candidatePath` to an absolute path via `path.resolve` and checks it falls under one of `allowedRoots` (also resolved). No current handler consumes this yet — Group B's `fs:*` handlers (a later plan) are the first consumers, per the spec's Group C sequencing note. This task ships the validator, tested standalone, so Group B's plan can wire it in without also having to design and test it from scratch.

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/ipcGuard.test.js`:

```js
const path = require('node:path');
const { validateFilePathInput } = require('../ipcGuard');

test('validateFilePathInput: accepts a path under an allowed root', () => {
  const root = path.resolve('/tmp/rmpg-exports');
  const result = validateFilePathInput(path.join(root, 'backup.sqlite'), [root]);
  assert.equal(result.ok, true);
  assert.equal(result.resolved, path.join(root, 'backup.sqlite'));
});

test('validateFilePathInput: rejects a path outside every allowed root', () => {
  const root = path.resolve('/tmp/rmpg-exports');
  const result = validateFilePathInput('/etc/passwd', [root]);
  assert.equal(result.ok, false);
});

test('validateFilePathInput: rejects a traversal attempt that escapes the root', () => {
  const root = path.resolve('/tmp/rmpg-exports');
  const result = validateFilePathInput(path.join(root, '..', '..', 'etc', 'passwd'), [root]);
  assert.equal(result.ok, false);
});

test('validateFilePathInput: rejects a non-string path', () => {
  const root = path.resolve('/tmp/rmpg-exports');
  const result = validateFilePathInput(null, [root]);
  assert.equal(result.ok, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test security/__tests__`
Expected: FAIL — `validateFilePathInput is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/ipcGuard.js` — add `const path = require('path');` near the top alongside the existing `const { URL } = require('url');`, then add above `module.exports`:

```js
/**
 * Resolves candidatePath and confirms it falls under one of allowedRoots.
 * Used by any future handler that writes/reads a renderer-chosen file path
 * (exports, backups) so a crafted path can't escape the intended directory.
 */
function validateFilePathInput(candidatePath, allowedRoots) {
  if (typeof candidatePath !== 'string' || candidatePath.length === 0) {
    return { ok: false, error: 'path must be a non-empty string' };
  }
  const resolved = path.resolve(candidatePath);
  const isUnderAnyRoot = allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
  });
  if (!isUnderAnyRoot) {
    return { ok: false, error: `path "${resolved}" is outside all allowed directories` };
  }
  return { ok: true, resolved };
}
```

Update `module.exports` to add `validateFilePathInput`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test security/__tests__`
Expected: PASS — 27 tests passing

- [ ] **Step 5: Commit**

```bash
git add desktop/security/ipcGuard.js desktop/security/__tests__/ipcGuard.test.js
git commit -m "desktop: add validateFilePathInput (unwired, for Group B fs:* handlers)"
```

---

### Task 8: `validateSyncQueueIdInput` — forward-looking sync queue id validator (no wiring yet)

**Files:**
- Modify: `desktop/security/ipcGuard.js`
- Test: `desktop/security/__tests__/ipcGuard.test.js`

**Interfaces:**
- Produces: `validateSyncQueueIdInput(id)` — returns `{ ok: true }` or `{ ok: false, error }`. Positive-integer shape check only (existence-in-the-actual-queue is checked by the future `retryFailedSyncItem` handler itself, which has DB access this pure function doesn't). First consumer is Group C's `sync:retry-item` handler (a later plan).

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/ipcGuard.test.js`:

```js
const { validateSyncQueueIdInput } = require('../ipcGuard');

test('validateSyncQueueIdInput: accepts a positive integer', () => {
  assert.deepEqual(validateSyncQueueIdInput(7), { ok: true });
});

test('validateSyncQueueIdInput: rejects zero, negative, or non-integer', () => {
  assert.equal(validateSyncQueueIdInput(0).ok, false);
  assert.equal(validateSyncQueueIdInput(-3).ok, false);
  assert.equal(validateSyncQueueIdInput(1.5).ok, false);
});

test('validateSyncQueueIdInput: rejects a non-numeric value', () => {
  assert.equal(validateSyncQueueIdInput('all').ok, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test security/__tests__`
Expected: FAIL — `validateSyncQueueIdInput is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/ipcGuard.js`, above `module.exports`:

```js
function validateSyncQueueIdInput(id) {
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    return { ok: false, error: 'id must be a positive integer' };
  }
  return { ok: true };
}
```

Update `module.exports` to add `validateSyncQueueIdInput`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test security/__tests__`
Expected: PASS — 30 tests passing

- [ ] **Step 5: Commit**

```bash
git add desktop/security/ipcGuard.js desktop/security/__tests__/ipcGuard.test.js
git commit -m "desktop: add validateSyncQueueIdInput (unwired, for Group C sync:retry-item)"
```

---

### Task 9: `validateGlobalShortcutAccelerator` — forward-looking accelerator validator (no wiring yet)

**Files:**
- Modify: `desktop/security/ipcGuard.js`
- Test: `desktop/security/__tests__/ipcGuard.test.js`

**Interfaces:**
- Produces: `validateGlobalShortcutAccelerator(accelerator)` — returns `{ ok: true }` or `{ ok: false, error }`. Validates against Electron's documented `Accelerator` string grammar (modifier keys joined by `+`, ending in one allowed key token) rather than accepting an arbitrary string into `globalShortcut.register`. First consumer is Group D's `device:register-shortcut` handler (a later plan).

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/ipcGuard.test.js`:

```js
const { validateGlobalShortcutAccelerator } = require('../ipcGuard');

test('validateGlobalShortcutAccelerator: accepts a valid modifier+key combo', () => {
  assert.deepEqual(validateGlobalShortcutAccelerator('CommandOrControl+Shift+P'), { ok: true });
});

test('validateGlobalShortcutAccelerator: accepts a valid function key combo', () => {
  assert.deepEqual(validateGlobalShortcutAccelerator('Alt+F9'), { ok: true });
});

test('validateGlobalShortcutAccelerator: rejects an unknown token', () => {
  const result = validateGlobalShortcutAccelerator('CommandOrControl+Banana');
  assert.equal(result.ok, false);
});

test('validateGlobalShortcutAccelerator: rejects a non-string', () => {
  assert.equal(validateGlobalShortcutAccelerator(null).ok, false);
});

test('validateGlobalShortcutAccelerator: rejects an empty string', () => {
  assert.equal(validateGlobalShortcutAccelerator('').ok, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test security/__tests__`
Expected: FAIL — `validateGlobalShortcutAccelerator is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/ipcGuard.js`, above `module.exports`:

```js
const ACCELERATOR_MODIFIERS = new Set([
  'CommandOrControl', 'CmdOrCtrl', 'Command', 'Cmd', 'Control', 'Ctrl',
  'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta',
]);
const ACCELERATOR_KEYS = new Set([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  'Plus', 'Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Return', 'Enter',
  'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Esc',
]);

/**
 * Validates an Electron globalShortcut Accelerator string: zero or more
 * known modifiers joined by "+", ending in exactly one known key token.
 */
function validateGlobalShortcutAccelerator(accelerator) {
  if (typeof accelerator !== 'string' || accelerator.length === 0) {
    return { ok: false, error: 'accelerator must be a non-empty string' };
  }
  const parts = accelerator.split('+');
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  if (!ACCELERATOR_KEYS.has(key)) {
    return { ok: false, error: `unknown key token "${key}"` };
  }
  for (const mod of modifiers) {
    if (!ACCELERATOR_MODIFIERS.has(mod)) {
      return { ok: false, error: `unknown modifier token "${mod}"` };
    }
  }
  return { ok: true };
}
```

Update `module.exports` to add `validateGlobalShortcutAccelerator`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test security/__tests__`
Expected: PASS — 35 tests passing

- [ ] **Step 5: Commit**

```bash
git add desktop/security/ipcGuard.js desktop/security/__tests__/ipcGuard.test.js
git commit -m "desktop: add validateGlobalShortcutAccelerator (unwired, for Group D device:register-shortcut)"
```

---

### Task 10: `rateLimitIpcHandler` — per-channel call-rate limiter

**Files:**
- Modify: `desktop/security/ipcGuard.js`
- Modify: `desktop/main.js` (`recon:tool-spawn`, `recon:catalog-run`, `offline:trigger-sync` handlers)
- Test: `desktop/security/__tests__/ipcGuard.test.js`

**Interfaces:**
- Produces: `createRateLimiter(maxCallsPerWindow, windowMs)` returning a `checkRateLimit(channel)` function — returns `{ ok: true }` or `{ ok: false, error }`. Stateful (tracks call counts in a closure-scoped `Map`), so it's a factory rather than a bare function — each call site that needs its own budget creates its own limiter instance via `createRateLimiter`.

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/ipcGuard.test.js`:

```js
const { createRateLimiter } = require('../ipcGuard');

test('createRateLimiter: allows calls under the limit', () => {
  const { checkRateLimit } = createRateLimiter(3, 60_000);
  assert.equal(checkRateLimit('recon:tool-spawn').ok, true);
  assert.equal(checkRateLimit('recon:tool-spawn').ok, true);
  assert.equal(checkRateLimit('recon:tool-spawn').ok, true);
});

test('createRateLimiter: rejects the call that exceeds the limit', () => {
  const { checkRateLimit } = createRateLimiter(2, 60_000);
  assert.equal(checkRateLimit('recon:tool-spawn').ok, true);
  assert.equal(checkRateLimit('recon:tool-spawn').ok, true);
  const third = checkRateLimit('recon:tool-spawn');
  assert.equal(third.ok, false);
  assert.match(third.error, /rate limit/);
});

test('createRateLimiter: tracks separate channels independently', () => {
  const { checkRateLimit } = createRateLimiter(1, 60_000);
  assert.equal(checkRateLimit('channel-a').ok, true);
  assert.equal(checkRateLimit('channel-b').ok, true);
  assert.equal(checkRateLimit('channel-a').ok, false);
});

test('createRateLimiter: resets after the window elapses', async () => {
  const { checkRateLimit } = createRateLimiter(1, 50);
  assert.equal(checkRateLimit('channel-a').ok, true);
  assert.equal(checkRateLimit('channel-a').ok, false);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(checkRateLimit('channel-a').ok, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test security/__tests__`
Expected: FAIL — `createRateLimiter is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/ipcGuard.js`, above `module.exports`:

```js
/**
 * Sliding-window call-count limiter, keyed by channel name. Each call to
 * the returned checkRateLimit records a timestamp and rejects once
 * maxCallsPerWindow timestamps fall inside the trailing windowMs.
 */
function createRateLimiter(maxCallsPerWindow, windowMs) {
  const callLog = new Map(); // channel -> array of timestamps

  function checkRateLimit(channel) {
    const now = Date.now();
    const timestamps = (callLog.get(channel) || []).filter((t) => now - t < windowMs);
    if (timestamps.length >= maxCallsPerWindow) {
      callLog.set(channel, timestamps);
      return { ok: false, error: `rate limit exceeded for "${channel}" (${maxCallsPerWindow} per ${windowMs}ms)` };
    }
    timestamps.push(now);
    callLog.set(channel, timestamps);
    return { ok: true };
  }

  return { checkRateLimit };
}
```

Update `module.exports` to add `createRateLimiter`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test security/__tests__`
Expected: PASS — 39 tests passing

- [ ] **Step 5: Wire into `main.js`**

Extend the import line to add `createRateLimiter`. Near the `TRUSTED_HOST`/`guardedHandle` setup block, add one shared limiter for the dangerous channels:

```js
const { checkRateLimit } = createRateLimiter(10, 60_000); // 10 calls/min per channel
```

In the `recon:tool-spawn` handler (already carrying the Task 4 `sanitizeReconToolArgs` check), add the rate check first:

```js
guardedHandle('recon:tool-spawn', async (event, { toolId, args = {} } = {}) => {
  const rateCheck = checkRateLimit('recon:tool-spawn');
  if (!rateCheck.ok) return { ok: false, error: rateCheck.error };
  const argsCheck = sanitizeReconToolArgs(toolId, args, RECON_TOOLS);
  if (!argsCheck.ok) return { ok: false, error: argsCheck.error };
  // ...unchanged rest...
```

Apply the same `checkRateLimit('recon:catalog-run')` as the first statement in `guardedHandle('recon:catalog-run', ...)`, and `checkRateLimit('offline:trigger-sync')` as the first statement in `guardedHandle('offline:trigger-sync', ...)`, each returning that handler's own `{ok: false, error}`-shaped early return (`offline:trigger-sync` returns `{ success: false, error }`, not `{ ok: false, error }` — match its existing shape).

- [ ] **Step 6: Manual smoke test**

Run: `cd desktop && npm start`, trigger `offline:trigger-sync` (e.g. via the sync-status UI's manual sync button) 11 times within a minute.
Expected: the 11th call returns the rate-limit error instead of running.

- [ ] **Step 7: Commit**

```bash
git add desktop/security/ipcGuard.js desktop/security/__tests__/ipcGuard.test.js desktop/main.js
git commit -m "desktop: rate-limit recon-spawn/catalog-run/trigger-sync channels"
```

---

### Task 11: `requireOfflineAuthForSensitiveIpc` — gate admin-only PIN generation

**Files:**
- Modify: `desktop/security/ipcGuard.js`
- Modify: `desktop/main.js` (`offline:generate-pin` handler)
- Test: `desktop/security/__tests__/ipcGuard.test.js`

**Interfaces:**
- Produces: `requireOfflineAuthForSensitiveIpc(cachedRole)` — returns `{ ok: true }` or `{ ok: false, error }`. Takes the already-cached role string (`main.js` already reads this via `getConfig('current_user_role')` inside the existing `offline:state` handler) rather than re-deriving auth state itself, since `ipcGuard.js` has no DB access of its own by design (keeps it dependency-free and unit-testable).

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/ipcGuard.test.js`:

```js
const { requireOfflineAuthForSensitiveIpc } = require('../ipcGuard');

test('requireOfflineAuthForSensitiveIpc: allows an admin role', () => {
  assert.deepEqual(requireOfflineAuthForSensitiveIpc('admin'), { ok: true });
});

test('requireOfflineAuthForSensitiveIpc: rejects a non-admin role', () => {
  const result = requireOfflineAuthForSensitiveIpc('officer');
  assert.equal(result.ok, false);
});

test('requireOfflineAuthForSensitiveIpc: rejects a missing/null role', () => {
  assert.equal(requireOfflineAuthForSensitiveIpc(null).ok, false);
  assert.equal(requireOfflineAuthForSensitiveIpc(undefined).ok, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test security/__tests__`
Expected: FAIL — `requireOfflineAuthForSensitiveIpc is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/ipcGuard.js`, above `module.exports`:

```js
/** Gate for IPC actions (e.g. admin PIN generation) that must not be
 * callable by a non-admin renderer session, even a same-origin one. */
function requireOfflineAuthForSensitiveIpc(cachedRole) {
  if (cachedRole !== 'admin') {
    return { ok: false, error: 'This action requires an admin session' };
  }
  return { ok: true };
}
```

Update `module.exports` to add `requireOfflineAuthForSensitiveIpc`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test security/__tests__`
Expected: PASS — 42 tests passing

- [ ] **Step 5: Wire into `main.js`'s `offline:generate-pin` handler**

Extend the import line to add `requireOfflineAuthForSensitiveIpc`, then:

```js
guardedHandle('offline:generate-pin', (_event, { userId }) => {
  const roleCheck = requireOfflineAuthForSensitiveIpc(getConfig('current_user_role'));
  if (!roleCheck.ok) return { error: roleCheck.error };
  const userIdCheck = validateUserIdInput(userId);
  if (!userIdCheck.ok) return { error: userIdCheck.error };
  try {
    if (!pinManager) return { error: 'PIN system not initialized' };
    return pinManager.generatePinForUser(userId);
  } catch (err) {
    console.error('[OFFLINE:GENERATE-PIN] Error:', err.message);
    return { error: err.message };
  }
});
```

- [ ] **Step 6: Manual smoke test**

Run: `cd desktop && npm start`. Log in as an admin, generate a PIN for an employee — expect success (unchanged from before). Then, using the renderer devtools console (dev mode only) while logged in as a non-admin role, call `window.electron.generatePin(1)` directly.
Expected: resolves to `{ error: 'This action requires an admin session' }` instead of generating a PIN.

- [ ] **Step 7: Commit**

```bash
git add desktop/security/ipcGuard.js desktop/security/__tests__/ipcGuard.test.js desktop/main.js
git commit -m "desktop: require admin role for offline:generate-pin"
```

---

### Task 12: `auditIpcHandlerRegistry` — dev-mode self-check

**Files:**
- Modify: `desktop/security/ipcGuard.js`
- Modify: `desktop/main.js` (call it once at startup, dev mode only)
- Test: `desktop/security/__tests__/ipcGuard.test.js`

**Interfaces:**
- Produces: `auditIpcHandlerRegistry(rawIpcMainHandleCalls, rawIpcMainOnCalls)` — returns `{ ok: true }` or `{ ok: false, violations: string[] }`. Rather than trying to introspect Electron's live `ipcMain` internals (not exposed), this task takes the pragmatic approach the spec's Guardrails section calls for: a **static source check** that greps `main.js` for any remaining raw `ipcMain.handle(`/`ipcMain.on(` call — i.e. it's the same check Task 3 Step 2 ran manually, now turned into a reusable, testable function callable from a startup dev-mode check or a CI step.

- [ ] **Step 1: Write the failing test**

Append to `desktop/security/__tests__/ipcGuard.test.js`:

```js
const { auditIpcHandlerRegistry } = require('../ipcGuard');

test('auditIpcHandlerRegistry: passes when source has no raw ipcMain registrations', () => {
  const source = `
    guardedHandle('app:version', () => app.getVersion());
    guardedOn('window:minimize', () => mainWindow?.minimize());
  `;
  assert.deepEqual(auditIpcHandlerRegistry(source), { ok: true });
});

test('auditIpcHandlerRegistry: flags a raw ipcMain.handle call', () => {
  const source = `ipcMain.handle('new:channel', () => {});`;
  const result = auditIpcHandlerRegistry(source);
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.match(result.violations[0], /new:channel/);
});

test('auditIpcHandlerRegistry: flags a raw ipcMain.on call', () => {
  const source = `ipcMain.on('new:channel', () => {});`;
  const result = auditIpcHandlerRegistry(source);
  assert.equal(result.ok, false);
  assert.match(result.violations[0], /new:channel/);
});

test('auditIpcHandlerRegistry: flags multiple violations', () => {
  const source = `
    ipcMain.handle('a', () => {});
    guardedHandle('b', () => {});
    ipcMain.on('c', () => {});
  `;
  const result = auditIpcHandlerRegistry(source);
  assert.equal(result.violations.length, 2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test security/__tests__`
Expected: FAIL — `auditIpcHandlerRegistry is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/security/ipcGuard.js`, above `module.exports`:

```js
const RAW_IPC_REGISTRATION = /^\s*ipcMain\.(handle|on)\(\s*['"]([^'"]+)['"]/gm;

/**
 * Statically scans main.js source text for any ipcMain.handle/on call that
 * bypasses guardedHandle/guardedOn. Returns the offending channel names so
 * a regression (a new handler added without going through the guard) is
 * caught immediately instead of silently reintroducing an unvalidated
 * channel.
 */
function auditIpcHandlerRegistry(mainJsSource) {
  const violations = [];
  let match;
  RAW_IPC_REGISTRATION.lastIndex = 0;
  while ((match = RAW_IPC_REGISTRATION.exec(mainJsSource)) !== null) {
    violations.push(`raw ipcMain.${match[1]}('${match[2]}') bypasses guardedHandle/guardedOn`);
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
```

Update `module.exports` to add `auditIpcHandlerRegistry`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test security/__tests__`
Expected: PASS — 46 tests passing

- [ ] **Step 5: Wire into `main.js` as a dev-mode startup check**

Extend the import line to add `auditIpcHandlerRegistry`. Near the top of `main.js`, add `const fs = require('fs');` if not already present at module scope (check first — `main.js` already does `const fs = require('fs');` inside individual handlers via lazy require, but not at module scope; add one at module scope for this check only if a module-scope `fs` isn't already there). In the app's startup sequence (inside the existing `app.whenReady()` block, before `createMainWindow()` is called), add:

```js
  if (DEV_MODE) {
    const mainJsSource = fs.readFileSync(__filename, 'utf8');
    const auditResult = auditIpcHandlerRegistry(mainJsSource);
    if (!auditResult.ok) {
      console.error('[SECURITY] Unguarded IPC handlers detected:', auditResult.violations);
    }
  }
```

(`DEV_MODE` already exists as a module-scope constant in `main.js`, used earlier for `REMOTE_SERVER_URL` selection — reuse it rather than adding a new flag.)

- [ ] **Step 6: Manual smoke test**

Run: `cd desktop && npm start --dev` (or however `DEV_MODE` is triggered — check the existing `DEV_MODE` derivation near `REMOTE_SERVER_URL`).
Expected: no `[SECURITY] Unguarded IPC handlers detected` log line appears (confirms Task 3's retrofit left zero raw registrations). Then temporarily add a throwaway `ipcMain.handle('test:temp', () => {})` line, restart, confirm the warning appears, then remove the throwaway line.

- [ ] **Step 7: Commit**

```bash
git add desktop/security/ipcGuard.js desktop/security/__tests__/ipcGuard.test.js desktop/main.js
git commit -m "desktop: add auditIpcHandlerRegistry dev-mode startup self-check"
```

---

### Task 13: Final verification pass

**Files:** none changed — verification only.

- [ ] **Step 1: Run the full desktop test suite**

Run: `cd desktop && node --test security/__tests__`
Expected: PASS — 46 tests passing, 0 failing.

- [ ] **Step 2: Confirm zero raw `ipcMain` registrations remain**

Run: `grep -n "^ipcMain\.\(handle\|on\)(" desktop/main.js`
Expected: no output.

- [ ] **Step 3: Confirm `main.js` still parses cleanly**

Run: `node --check desktop/main.js`
Expected: exit code 0, no output.

- [ ] **Step 4: Full manual dev-run smoke test**

Run: `cd desktop && npm start`. Walk through: window minimize/maximize/close, app version display, PDF print-to-preview, offline PIN entry and admin PIN generation, a Recon tool spawn, and a manual sync trigger.
Expected: every one of these behaves identically to before this plan — the guard layer is invisible to a legitimate, same-origin renderer call.

- [ ] **Step 5: Update the spec's sequencing note**

Edit `docs/superpowers/specs/2026-07-18-desktop-shell-functions-and-hardening-design.md`'s Sequencing Note — no content change needed, just confirm Group G is complete before starting the Group F plan (next in sequence).

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "desktop: complete Group G (IPC sender/input validation) — 46 tests passing"
```
