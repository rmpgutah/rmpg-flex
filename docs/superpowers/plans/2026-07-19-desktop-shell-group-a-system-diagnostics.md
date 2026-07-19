# Desktop Shell — Group A (System & Diagnostics) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `desktop/systemInfo.js` — 10 System & Diagnostics functions for the RMPG Flex desktop shell (system info, log tailing, log-folder reveal, an encrypted diagnostics bundle export, crash-dump listing, app restart, disk-space check, network interfaces, battery status, idle time) — per Group A of the 10-group sequence in [`docs/superpowers/specs/2026-07-18-desktop-shell-functions-and-hardening-design.md`](../specs/2026-07-18-desktop-shell-functions-and-hardening-design.md).

**Architecture:** A single new module, `desktop/systemInfo.js` (a capability module, not a `desktop/security/*.js` hardening module — matches the spec's own file-placement table). Every function that touches an OS/Electron API takes that dependency as a parameter (`os`, `fs`, `app`, `powerMonitor`, a shell-exec function) so the decision/formatting logic is unit-tested with fakes, mirroring the pattern established in Groups F/G/H. This branch is stacked on Group H's branch (`claude/desktop-hardening-group-h-secrets-store`, PR #2854, unmerged) because `exportDiagnosticsBundle` (function #4) is the real, spec-named consumer of Group H's `encryptDiagnosticsBundleOnExport` — the first time an "unwired, for a future group" function from an earlier group gets its actual wiring.

**Tech Stack:** Plain Node.js (CommonJS), Node's `os`/`fs`/`child_process` built-ins, Electron's `app`/`shell`/`powerMonitor`, `node:test` + `node:assert/strict`.

## Global Constraints

- Match existing `desktop/*.js` conventions: CommonJS, no TypeScript, header comment block matching `desktop/security/ipcGuard.js`'s style.
- Every function must be unit-testable with zero real Electron/OS runtime — dependencies are always parameters, never `require('electron')`/`require('os')`/`require('fs')` called directly inside a testable function body (the thin `main.js` wiring layer is where the real `require`s happen, same split Group F used for Electron-calling functions).
- **Scope decision on `getAppLogs`/`openLogsFolder` (Function #2/#3), documented here rather than silently assumed**: this codebase has no persistent log file today — everything goes to `console.log`/`console.error`, which a packaged Electron app does not durably capture. Rather than either (a) claiming these functions work against a file that doesn't exist, or (b) globally monkey-patching `console.*` (the same class of blind, unverifiable-in-this-environment change Group H's `redactSensitiveFieldsInLogs` explicitly avoided), this plan adds one small, explicit `appendToLogFile` helper wired into ONLY the two existing global crash handlers (`process.on('unhandledRejection', ...)`/`process.on('uncaughtException', ...)` in `main.js`) — the single highest-value, already-centralized integration point. It is not wired into any other `console.*` call site in the 2870-line file.
- **Scope decision on `getBatteryStatus` (Function #9)**: Electron's main process has no built-in battery API (that's a renderer-only Web API). This plan implements it for macOS only (the confirmed dev/target platform per this repo's environment) via `pmset -g batt`, parsed by a pure, unit-tested parser against real known output format. Other platforms return `null` — an extension of the spec's own explicitly-anticipated "null on desktops" case, not a silent gap.
- **Scope decision on `getCrashReports` (Function #5)**: this codebase never calls Electron's `crashReporter.start()`, and starting a full crash-reporting subsystem (upload endpoint, opt-in UX) is out of scope for a "list crash dumps" function. This lists files in `app.getPath('crashDumps')` — Electron's standard OS-level crash-dump directory, populated by native OS crash handling independent of the JS `crashReporter` module having been started.
- Commit after each task.

---

### Task 1: `getSystemInfo` + shared `getDiskFreeBytes` helper

**Files:**
- Create: `desktop/systemInfo.js`
- Test: `desktop/__tests__/systemInfo.test.js`

**Interfaces:**
- Produces: `getDiskFreeBytes(targetPath, fsModule)` — calls `fsModule.statfsSync(targetPath)`, returns `bavail * bsize` (bytes free). `formatSystemInfo(osModule, freeBytes)` — pure formatter taking the raw `os` module (for `platform()`/`arch()`/`cpus()`/`totalmem()`/`freemem()`) plus a pre-computed `freeBytes` value, returns `{os, arch, cpuModel, totalMem, freeMem, diskFree}`. Later Task 7 (`checkDiskSpace`) reuses `getDiskFreeBytes`.

- [ ] **Step 1: Write the failing test**

Create `desktop/__tests__/systemInfo.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getDiskFreeBytes, formatSystemInfo } = require('../systemInfo');

function fakeFs(statfsResult) {
  return { statfsSync: () => statfsResult };
}

test('getDiskFreeBytes: computes bytes from bavail * bsize', () => {
  const fs = fakeFs({ bavail: 1000, bsize: 4096 });
  assert.equal(getDiskFreeBytes('/', fs), 1000 * 4096);
});

function fakeOs() {
  return {
    platform: () => 'darwin',
    arch: () => 'arm64',
    cpus: () => [{ model: 'Apple M2' }, { model: 'Apple M2' }],
    totalmem: () => 17179869184,
    freemem: () => 4294967296,
  };
}

test('formatSystemInfo: assembles the expected shape from os + a precomputed freeBytes', () => {
  const info = formatSystemInfo(fakeOs(), 214748364800);
  assert.deepEqual(info, {
    os: 'darwin',
    arch: 'arm64',
    cpuModel: 'Apple M2',
    totalMem: 17179869184,
    freeMem: 4294967296,
    diskFree: 214748364800,
  });
});

test('formatSystemInfo: cpuModel falls back to "unknown" when cpus() is empty', () => {
  const os = { ...fakeOs(), cpus: () => [] };
  const info = formatSystemInfo(os, 0);
  assert.equal(info.cpuModel, 'unknown');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test '__tests__/systemInfo.test.js'`
Expected: FAIL — `Cannot find module '../systemInfo'`

- [ ] **Step 3: Write the minimal implementation**

Create `desktop/systemInfo.js`:

```js
// ============================================================
// RMPG Flex — System & Diagnostics
// System info, log access, diagnostics bundle export, crash
// dumps, app restart, disk space, network interfaces, battery
// status, idle time. Every OS/Electron-touching function takes
// its dependency as a parameter for zero-runtime-dependency
// unit testing, mirroring desktop/security/*.js's pattern.
// ============================================================

'use strict';

/** Free disk space in bytes at targetPath, via fs.statfsSync. */
function getDiskFreeBytes(targetPath, fsModule) {
  const stats = fsModule.statfsSync(targetPath);
  return stats.bavail * stats.bsize;
}

/** Assembles the sys:info shape from Node's os module plus a precomputed diskFree value. */
function formatSystemInfo(osModule, freeBytes) {
  const cpus = osModule.cpus();
  return {
    os: osModule.platform(),
    arch: osModule.arch(),
    cpuModel: cpus.length > 0 ? cpus[0].model : 'unknown',
    totalMem: osModule.totalmem(),
    freeMem: osModule.freemem(),
    diskFree: freeBytes,
  };
}

module.exports = {
  getDiskFreeBytes,
  formatSystemInfo,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test '__tests__/systemInfo.test.js'`
Expected: PASS — 3 tests passing

- [ ] **Step 5: Wire into `main.js`**

Near the top of `main.js`, after the existing `const { ... } = require('./security/secretsStore');`-style imports (search for the last such require to find the right spot), add:

```js
const { getDiskFreeBytes, formatSystemInfo } = require('./systemInfo');
```

Add the handler near the other simple `guardedHandle` registrations (e.g. next to `app:version`):

```js
guardedHandle('sys:info', () => {
  const os = require('os');
  const fs = require('fs');
  let freeBytes;
  try {
    freeBytes = getDiskFreeBytes(app.getPath('userData'), fs);
  } catch (err) {
    console.error('[SYS:INFO] Disk space check failed:', err.message);
    freeBytes = null;
  }
  return formatSystemInfo(os, freeBytes);
});
```

Extend `desktop/preload.js`'s `contextBridge.exposeInMainWorld('electron', {...})` object to add:

```js
  // ─── System & Diagnostics ───────────────────────────
  getSystemInfo: () => ipcRenderer.invoke('sys:info'),
```

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/main.js && node --check desktop/preload.js`
Expected: exit code 0 for both

- [ ] **Step 7: Commit**

```bash
git add desktop/systemInfo.js desktop/__tests__/systemInfo.test.js desktop/main.js desktop/preload.js
git commit -m "desktop: add getSystemInfo (sys:info) with shared getDiskFreeBytes helper"
```

---

### Task 2: `getAppLogs` + the `appendToLogFile` crash-handler hook

**Files:**
- Modify: `desktop/systemInfo.js`
- Modify: `desktop/main.js` (wire `appendToLogFile` into the two existing global crash handlers; add the `sys:logs` handler)
- Modify: `desktop/preload.js`
- Test: `desktop/__tests__/systemInfo.test.js`

**Interfaces:**
- Produces: `appendToLogFile(message, logFilePath, fsModule)` — appends a single timestamped line (`fsModule.appendFileSync`). `tailLogFile(logFilePath, lines, fsModule)` — returns the last `lines` lines of the file as a string, or `''` if the file doesn't exist yet (checked via `fsModule.existsSync`).

- [ ] **Step 1: Write the failing test**

Append to `desktop/__tests__/systemInfo.test.js`:

```js
const { appendToLogFile, tailLogFile } = require('../systemInfo');

function fakeFsWithStore(initialContent) {
  let content = initialContent;
  return {
    existsSync: () => content !== undefined,
    appendFileSync: (_path, line) => { content = (content || '') + line; },
    readFileSync: () => content,
    _get: () => content,
  };
}

test('appendToLogFile: appends a timestamped line ending in a newline', () => {
  const fs = fakeFsWithStore('');
  appendToLogFile('hello world', '/logs/app.log', fs);
  const written = fs._get();
  assert.match(written, /\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] hello world\n$/);
});

test('tailLogFile: returns empty string when the file does not exist', () => {
  const fs = fakeFsWithStore(undefined);
  assert.equal(tailLogFile('/logs/app.log', 5, fs), '');
});

test('tailLogFile: returns only the last N lines', () => {
  const fs = fakeFsWithStore('line1\nline2\nline3\nline4\nline5\n');
  assert.equal(tailLogFile('/logs/app.log', 2, fs), 'line4\nline5');
});

test('tailLogFile: returns everything when fewer lines exist than requested', () => {
  const fs = fakeFsWithStore('only-line\n');
  assert.equal(tailLogFile('/logs/app.log', 500, fs), 'only-line');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test '__tests__/systemInfo.test.js'`
Expected: FAIL — `appendToLogFile is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/systemInfo.js`, above `module.exports`:

```js
/** Appends one timestamped line to the log file. Never throws on the format — a real fs error still propagates. */
function appendToLogFile(message, logFilePath, fsModule) {
  fsModule.appendFileSync(logFilePath, `[${new Date().toISOString()}] ${message}\n`);
}

/** Returns the last `lines` lines of logFilePath, or '' if it doesn't exist yet. */
function tailLogFile(logFilePath, lines, fsModule) {
  if (!fsModule.existsSync(logFilePath)) return '';
  const content = fsModule.readFileSync(logFilePath, 'utf8');
  const allLines = content.split('\n').filter((_, i, arr) => !(i === arr.length - 1 && arr[arr.length - 1] === ''));
  return allLines.slice(-lines).join('\n');
}
```

Update `module.exports` to add `appendToLogFile`, `tailLogFile`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test '__tests__/systemInfo.test.js'`
Expected: PASS — 7 tests passing

- [ ] **Step 5: Wire the log file path and the crash-handler hook into `main.js`**

Near the top of `main.js`, after the `TRUSTED_HOST` block, add a module-scope constant:

```js
const LOG_FILE_PATH = path.join(app.getPath('userData'), 'rmpg-flex.log');
```

Extend the `./systemInfo` import to add `appendToLogFile`, `tailLogFile`. Find the two existing handlers:

```js
process.on('unhandledRejection', (reason) => {
  if (isTransientNetworkError(reason)) {
    console.warn('[APP] Swallowed transient network error:', reason && reason.message);
    return;
  }
  console.error('[APP] Unhandled rejection:', reason);
  throw reason;
});

process.on('uncaughtException', (err) => {
  if (isTransientNetworkError(err)) {
    console.warn('[APP] Swallowed transient network error:', err && err.message);
    return;
  }
  console.error('[APP] Uncaught exception:', err);
  // Re-throw on next tick so Electron's default crash dialog still
  // fires for real bugs, but our log line lands first.
  setImmediate(() => { throw err; });
});
```

Add ONE `appendToLogFile` call in each non-transient branch (do not log transient/swallowed errors — they're noise, not diagnostics):

```js
process.on('unhandledRejection', (reason) => {
  if (isTransientNetworkError(reason)) {
    console.warn('[APP] Swallowed transient network error:', reason && reason.message);
    return;
  }
  console.error('[APP] Unhandled rejection:', reason);
  try {
    appendToLogFile(`Unhandled rejection: ${reason && reason.message}`, LOG_FILE_PATH, require('fs'));
  } catch { /* logging must never crash the crash handler */ }
  throw reason;
});

process.on('uncaughtException', (err) => {
  if (isTransientNetworkError(err)) {
    console.warn('[APP] Swallowed transient network error:', err && err.message);
    return;
  }
  console.error('[APP] Uncaught exception:', err);
  try {
    appendToLogFile(`Uncaught exception: ${err && err.message}`, LOG_FILE_PATH, require('fs'));
  } catch { /* logging must never crash the crash handler */ }
  // Re-throw on next tick so Electron's default crash dialog still
  // fires for real bugs, but our log line lands first.
  setImmediate(() => { throw err; });
});
```

Add the `sys:logs` handler near `sys:info`:

```js
guardedHandle('sys:logs', (_event, lines = 500) => {
  return tailLogFile(LOG_FILE_PATH, lines, require('fs'));
});
```

Extend `preload.js`:

```js
  getAppLogs: (lines) => ipcRenderer.invoke('sys:logs', lines),
```

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/main.js && node --check desktop/preload.js`
Expected: exit code 0 for both

- [ ] **Step 7: Commit**

```bash
git add desktop/systemInfo.js desktop/__tests__/systemInfo.test.js desktop/main.js desktop/preload.js
git commit -m "desktop: add getAppLogs (sys:logs), hook appendToLogFile into crash handlers"
```

---

### Task 3: `openLogsFolder`

**Files:**
- Modify: `desktop/systemInfo.js`
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`
- Test: `desktop/__tests__/systemInfo.test.js`

**Interfaces:**
- Produces: `getLogsDirectory(logFilePath, pathModule)` — pure, returns `pathModule.dirname(logFilePath)`. The actual `shell.openPath(...)` call is main.js-level wiring, untested (matches how Group F treated thin Electron-API wrappers).

- [ ] **Step 1: Write the failing test**

Append to `desktop/__tests__/systemInfo.test.js`:

```js
const path = require('node:path');
const { getLogsDirectory } = require('../systemInfo');

test('getLogsDirectory: returns the directory containing the log file', () => {
  assert.equal(getLogsDirectory('/Users/officer/Library/Application Support/RMPG Flex/rmpg-flex.log', path), '/Users/officer/Library/Application Support/RMPG Flex');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test '__tests__/systemInfo.test.js'`
Expected: FAIL — `getLogsDirectory is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/systemInfo.js`, above `module.exports`:

```js
/** Directory containing the log file — pure path math, no fs access. */
function getLogsDirectory(logFilePath, pathModule) {
  return pathModule.dirname(logFilePath);
}
```

Update `module.exports` to add `getLogsDirectory`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test '__tests__/systemInfo.test.js'`
Expected: PASS — 8 tests passing

- [ ] **Step 5: Wire into `main.js`**

Extend the `./systemInfo` import to add `getLogsDirectory`. Add:

```js
guardedHandle('sys:open-logs-folder', () => {
  shell.openPath(getLogsDirectory(LOG_FILE_PATH, path));
});
```

Extend `preload.js`:

```js
  openLogsFolder: () => ipcRenderer.invoke('sys:open-logs-folder'),
```

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/main.js && node --check desktop/preload.js`
Expected: exit code 0 for both

- [ ] **Step 7: Commit**

```bash
git add desktop/systemInfo.js desktop/__tests__/systemInfo.test.js desktop/main.js desktop/preload.js
git commit -m "desktop: add openLogsFolder (sys:open-logs-folder)"
```

---

### Task 4: `exportDiagnosticsBundle` — wires Group H's `encryptDiagnosticsBundleOnExport`

**Files:**
- Modify: `desktop/systemInfo.js`
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`
- Test: `desktop/__tests__/systemInfo.test.js`

**Interfaces:**
- Consumes: `encryptDiagnosticsBundleOnExport(plainText, safeStorage)` from `desktop/security/secretsStore.js` (Group H) — the first real wiring of a function that shipped unwired in an earlier group.
- Produces: `buildDiagnosticsBundleText(systemInfoObj, logTail)` — pure formatter, returns a single plain-text string combining both (JSON system info block + a log-tail section), ready to be redacted+encrypted.

- [ ] **Step 1: Write the failing test**

Append to `desktop/__tests__/systemInfo.test.js`:

```js
const { buildDiagnosticsBundleText } = require('../systemInfo');

test('buildDiagnosticsBundleText: combines system info and log tail into one text block', () => {
  const info = { os: 'darwin', arch: 'arm64', cpuModel: 'Apple M2', totalMem: 100, freeMem: 50, diskFree: 1000 };
  const text = buildDiagnosticsBundleText(info, 'log line 1\nlog line 2');
  assert.match(text, /=== System Info ===/);
  assert.match(text, /"os": "darwin"/);
  assert.match(text, /=== Recent Logs ===/);
  assert.match(text, /log line 1/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test '__tests__/systemInfo.test.js'`
Expected: FAIL — `buildDiagnosticsBundleText is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/systemInfo.js`, above `module.exports`:

```js
/** Plain-text diagnostics bundle body — redaction/encryption happens after this, at the call site. */
function buildDiagnosticsBundleText(systemInfoObj, logTail) {
  return [
    '=== System Info ===',
    JSON.stringify(systemInfoObj, null, 2),
    '',
    '=== Recent Logs ===',
    logTail,
  ].join('\n');
}
```

Update `module.exports` to add `buildDiagnosticsBundleText`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test '__tests__/systemInfo.test.js'`
Expected: PASS — 9 tests passing

- [ ] **Step 5: Wire into `main.js`**

Extend the `./systemInfo` import to add `buildDiagnosticsBundleText`. Add the import for Group H's function (a new import line, since it's a different module):

```js
const { encryptDiagnosticsBundleOnExport } = require('./security/secretsStore');
```

Add the handler:

```js
guardedHandle('sys:export-diagnostics', async () => {
  const os = require('os');
  const fs = require('fs');
  let freeBytes;
  try {
    freeBytes = getDiskFreeBytes(app.getPath('userData'), fs);
  } catch {
    freeBytes = null;
  }
  const info = formatSystemInfo(os, freeBytes);
  const logTail = tailLogFile(LOG_FILE_PATH, 500, fs);
  const bundleText = buildDiagnosticsBundleText(info, logTail);
  let encrypted;
  try {
    encrypted = encryptDiagnosticsBundleOnExport(bundleText, safeStorage);
  } catch (err) {
    return { ok: false, error: `Diagnostics encryption failed: ${err.message}` };
  }
  const outPath = path.join(app.getPath('temp'), `rmpg-flex-diagnostics-${Date.now()}.enc`);
  try {
    fs.writeFileSync(outPath, encrypted, 'utf8');
  } catch (err) {
    return { ok: false, error: `Failed to write diagnostics bundle: ${err.message}` };
  }
  return { ok: true, path: outPath };
});
```

Extend `preload.js`:

```js
  exportDiagnosticsBundle: () => ipcRenderer.invoke('sys:export-diagnostics'),
```

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/main.js && node --check desktop/preload.js`
Expected: exit code 0 for both

- [ ] **Step 7: Commit**

```bash
git add desktop/systemInfo.js desktop/__tests__/systemInfo.test.js desktop/main.js desktop/preload.js
git commit -m "desktop: add exportDiagnosticsBundle (sys:export-diagnostics), wires Group H's encryptDiagnosticsBundleOnExport"
```

---

### Task 5: `getCrashReports`

**Files:**
- Modify: `desktop/systemInfo.js`
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`
- Test: `desktop/__tests__/systemInfo.test.js`

**Interfaces:**
- Produces: `listCrashReports(crashDumpsDir, fsModule)` — returns `Array<{date, path}>`. Returns `[]` if the directory doesn't exist (not every platform/config has crash dumps).

- [ ] **Step 1: Write the failing test**

Append to `desktop/__tests__/systemInfo.test.js`:

```js
const { listCrashReports } = require('../systemInfo');

function fakeFsDir(exists, entries) {
  return {
    existsSync: () => exists,
    readdirSync: () => entries.map((e) => e.name),
    statSync: (p) => ({ mtime: entries.find((e) => p.endsWith(e.name)).mtime }),
  };
}

test('listCrashReports: returns [] when the crash dumps directory does not exist', () => {
  const fs = fakeFsDir(false, []);
  assert.deepEqual(listCrashReports('/crashes', fs), []);
});

test('listCrashReports: lists files with date and path', () => {
  const mtime = new Date('2026-07-01T00:00:00Z');
  const fs = fakeFsDir(true, [{ name: 'crash-1.dmp', mtime }]);
  const result = listCrashReports('/crashes', fs);
  assert.equal(result.length, 1);
  assert.equal(result[0].path, '/crashes/crash-1.dmp');
  assert.equal(result[0].date, mtime.toISOString());
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test '__tests__/systemInfo.test.js'`
Expected: FAIL — `listCrashReports is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/systemInfo.js` — add `const path = require('path');` near the top if not already present (check first; it's likely NOT present since no prior task in this file needed it as a module-scope require — `getLogsDirectory` took `pathModule` as a parameter instead), then add above `module.exports`:

```js
/** Lists crash dump files in Electron's standard crashDumps directory. */
function listCrashReports(crashDumpsDir, fsModule) {
  if (!fsModule.existsSync(crashDumpsDir)) return [];
  return fsModule.readdirSync(crashDumpsDir).map((name) => {
    const fullPath = `${crashDumpsDir}/${name}`;
    const stats = fsModule.statSync(fullPath);
    return { date: stats.mtime.toISOString(), path: fullPath };
  });
}
```

(Uses a plain `${crashDumpsDir}/${name}` join rather than `path.join` to keep this function's only dependency `fsModule` — consistent with the file's parameter-injection pattern; do NOT add a `path` require to this specific function.)

Update `module.exports` to add `listCrashReports`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test '__tests__/systemInfo.test.js'`
Expected: PASS — 11 tests passing

- [ ] **Step 5: Wire into `main.js`**

Extend the `./systemInfo` import to add `listCrashReports`. Add:

```js
guardedHandle('sys:crash-reports', () => {
  return listCrashReports(app.getPath('crashDumps'), require('fs'));
});
```

Extend `preload.js`:

```js
  getCrashReports: () => ipcRenderer.invoke('sys:crash-reports'),
```

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/main.js && node --check desktop/preload.js`
Expected: exit code 0 for both

- [ ] **Step 7: Commit**

```bash
git add desktop/systemInfo.js desktop/__tests__/systemInfo.test.js desktop/main.js desktop/preload.js
git commit -m "desktop: add getCrashReports (sys:crash-reports)"
```

---

### Task 6: `restartApp`

**Files:**
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`

**Interfaces:**
- No new pure logic — `app.relaunch()` + `app.exit()` are inherently side-effecting Electron calls with no meaningful decision logic to extract and test. This task is wiring-only, matching how Group F treated e.g. `restrictDevToolsInProduction`'s trivial boolean check versus the actual menu-manipulation wiring.

- [ ] **Step 1: Wire into `main.js`**

Add near the other simple handlers:

```js
guardedHandle('sys:restart', () => {
  app.relaunch();
  app.exit();
});
```

- [ ] **Step 2: Wire into `preload.js`**

```js
  restartApp: () => ipcRenderer.invoke('sys:restart'),
```

- [ ] **Step 3: Sanity-check**

Run: `node --check desktop/main.js && node --check desktop/preload.js`
Expected: exit code 0 for both

- [ ] **Step 4: Commit**

```bash
git add desktop/main.js desktop/preload.js
git commit -m "desktop: add restartApp (sys:restart)"
```

---

### Task 7: `checkDiskSpace` — reuses Task 1's `getDiskFreeBytes`

**Files:**
- Modify: `desktop/systemInfo.js`
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`
- Test: `desktop/__tests__/systemInfo.test.js`

**Interfaces:**
- Consumes: `getDiskFreeBytes` from Task 1.
- Produces: `evaluateDiskSpace(freeBytes, warnThresholdBytes = 524288000)` — pure, returns `{freeBytes, warn: boolean}` where `warn` is true when `freeBytes < warnThresholdBytes` (default 500MB).

- [ ] **Step 1: Write the failing test**

Append to `desktop/__tests__/systemInfo.test.js`:

```js
const { evaluateDiskSpace } = require('../systemInfo');

test('evaluateDiskSpace: warn is false comfortably above the threshold', () => {
  assert.deepEqual(evaluateDiskSpace(2_000_000_000), { freeBytes: 2_000_000_000, warn: false });
});

test('evaluateDiskSpace: warn is true below the default 500MB threshold', () => {
  assert.deepEqual(evaluateDiskSpace(100_000_000), { freeBytes: 100_000_000, warn: true });
});

test('evaluateDiskSpace: accepts a custom threshold', () => {
  assert.deepEqual(evaluateDiskSpace(1_000_000_000, 2_000_000_000), { freeBytes: 1_000_000_000, warn: true });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test '__tests__/systemInfo.test.js'`
Expected: FAIL — `evaluateDiskSpace is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/systemInfo.js`, above `module.exports`:

```js
const DEFAULT_DISK_WARN_THRESHOLD_BYTES = 500 * 1024 * 1024; // 500MB

/** Flags low disk space before a local DB write that could fail on a full disk. */
function evaluateDiskSpace(freeBytes, warnThresholdBytes = DEFAULT_DISK_WARN_THRESHOLD_BYTES) {
  return { freeBytes, warn: freeBytes < warnThresholdBytes };
}
```

Update `module.exports` to add `evaluateDiskSpace`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test '__tests__/systemInfo.test.js'`
Expected: PASS — 14 tests passing

- [ ] **Step 5: Wire into `main.js`**

Extend the `./systemInfo` import to add `evaluateDiskSpace`. Add:

```js
guardedHandle('sys:disk-space', () => {
  const freeBytes = getDiskFreeBytes(app.getPath('userData'), require('fs'));
  return evaluateDiskSpace(freeBytes);
});
```

Extend `preload.js`:

```js
  checkDiskSpace: () => ipcRenderer.invoke('sys:disk-space'),
```

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/main.js && node --check desktop/preload.js`
Expected: exit code 0 for both

- [ ] **Step 7: Commit**

```bash
git add desktop/systemInfo.js desktop/__tests__/systemInfo.test.js desktop/main.js desktop/preload.js
git commit -m "desktop: add checkDiskSpace (sys:disk-space), reuses getDiskFreeBytes"
```

---

### Task 8: `getNetworkInterfaces`

**Files:**
- Modify: `desktop/systemInfo.js`
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`
- Test: `desktop/__tests__/systemInfo.test.js`

**Interfaces:**
- Produces: `formatNetworkInterfaces(rawInterfaces)` — pure, takes the raw object `os.networkInterfaces()` returns, returns `Array<{name, address, type}>`, filtering out internal/loopback interfaces and non-IPv4 entries (`type` is `'IPv4'`/`'IPv6'` per Node's own `family` field, normalized to a string).

- [ ] **Step 1: Write the failing test**

Append to `desktop/__tests__/systemInfo.test.js`:

```js
const { formatNetworkInterfaces } = require('../systemInfo');

test('formatNetworkInterfaces: filters out internal/loopback interfaces', () => {
  const raw = {
    lo0: [{ address: '127.0.0.1', internal: true, family: 'IPv4' }],
    en0: [{ address: '192.168.1.42', internal: false, family: 'IPv4' }],
  };
  const result = formatNetworkInterfaces(raw);
  assert.deepEqual(result, [{ name: 'en0', address: '192.168.1.42', type: 'IPv4' }]);
});

test('formatNetworkInterfaces: includes multiple addresses on the same interface as separate entries', () => {
  const raw = {
    en0: [
      { address: '192.168.1.42', internal: false, family: 'IPv4' },
      { address: 'fe80::1', internal: false, family: 'IPv6' },
    ],
  };
  const result = formatNetworkInterfaces(raw);
  assert.equal(result.length, 2);
  assert.equal(result[0].type, 'IPv4');
  assert.equal(result[1].type, 'IPv6');
});

test('formatNetworkInterfaces: returns [] for an empty interfaces object', () => {
  assert.deepEqual(formatNetworkInterfaces({}), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test '__tests__/systemInfo.test.js'`
Expected: FAIL — `formatNetworkInterfaces is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/systemInfo.js`, above `module.exports`:

```js
/** Flattens os.networkInterfaces() into {name, address, type}[], dropping internal/loopback entries. */
function formatNetworkInterfaces(rawInterfaces) {
  const result = [];
  for (const [name, addresses] of Object.entries(rawInterfaces)) {
    for (const addr of addresses) {
      if (addr.internal) continue;
      result.push({ name, address: addr.address, type: addr.family });
    }
  }
  return result;
}
```

Update `module.exports` to add `formatNetworkInterfaces`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test '__tests__/systemInfo.test.js'`
Expected: PASS — 17 tests passing

- [ ] **Step 5: Wire into `main.js`**

Extend the `./systemInfo` import to add `formatNetworkInterfaces`. Add:

```js
guardedHandle('sys:network-interfaces', () => {
  return formatNetworkInterfaces(require('os').networkInterfaces());
});
```

Extend `preload.js`:

```js
  getNetworkInterfaces: () => ipcRenderer.invoke('sys:network-interfaces'),
```

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/main.js && node --check desktop/preload.js`
Expected: exit code 0 for both

- [ ] **Step 7: Commit**

```bash
git add desktop/systemInfo.js desktop/__tests__/systemInfo.test.js desktop/main.js desktop/preload.js
git commit -m "desktop: add getNetworkInterfaces (sys:network-interfaces)"
```

---

### Task 9: `getBatteryStatus` — macOS via `pmset -g batt`, null elsewhere

**Files:**
- Modify: `desktop/systemInfo.js`
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`
- Test: `desktop/__tests__/systemInfo.test.js`

**Interfaces:**
- Produces: `parsePmsetBatteryOutput(rawOutput)` — pure parser for macOS's `pmset -g batt` text output, returns `{percent, charging}` or `null` if the output doesn't match the expected shape (e.g. a desktop Mac with no battery, which prints `"Now drawing from 'AC Power'\n"` with no percentage line at all).

- [ ] **Step 1: Write the failing test**

Append to `desktop/__tests__/systemInfo.test.js`:

```js
const { parsePmsetBatteryOutput } = require('../systemInfo');

test('parsePmsetBatteryOutput: parses a discharging laptop', () => {
  const raw = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=4325561)\t87%; discharging; 3:47 remaining present: true\n";
  assert.deepEqual(parsePmsetBatteryOutput(raw), { percent: 87, charging: false });
});

test('parsePmsetBatteryOutput: parses a charging laptop', () => {
  const raw = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=4325561)\t54%; charging; 1:12 remaining present: true\n";
  assert.deepEqual(parsePmsetBatteryOutput(raw), { percent: 54, charging: true });
});

test('parsePmsetBatteryOutput: parses "charged" (fully charged, on AC) as not charging', () => {
  const raw = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=4325561)\t100%; charged; 0:00 remaining present: true\n";
  assert.deepEqual(parsePmsetBatteryOutput(raw), { percent: 100, charging: false });
});

test('parsePmsetBatteryOutput: returns null for a desktop Mac with no battery line', () => {
  const raw = "Now drawing from 'AC Power'\n";
  assert.equal(parsePmsetBatteryOutput(raw), null);
});

test('parsePmsetBatteryOutput: returns null for unrecognizable output', () => {
  assert.equal(parsePmsetBatteryOutput('garbage'), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && node --test '__tests__/systemInfo.test.js'`
Expected: FAIL — `parsePmsetBatteryOutput is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `desktop/systemInfo.js`, above `module.exports`:

```js
const PMSET_BATTERY_LINE = /(\d+)%;\s*(charging|discharging|charged);/;

/** Parses macOS `pmset -g batt` output. Returns null if no battery line is present (desktop Mac). */
function parsePmsetBatteryOutput(rawOutput) {
  const match = PMSET_BATTERY_LINE.exec(rawOutput);
  if (!match) return null;
  return { percent: Number(match[1]), charging: match[2] === 'charging' };
}
```

Update `module.exports` to add `parsePmsetBatteryOutput`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd desktop && node --test '__tests__/systemInfo.test.js'`
Expected: PASS — 22 tests passing

- [ ] **Step 5: Wire into `main.js`**

Extend the `./systemInfo` import to add `parsePmsetBatteryOutput`. Add:

```js
guardedHandle('sys:battery', () => {
  if (process.platform !== 'darwin') return null;
  try {
    const { execSync } = require('child_process');
    const output = execSync('pmset -g batt', { encoding: 'utf8', timeout: 3000 });
    return parsePmsetBatteryOutput(output);
  } catch (err) {
    console.error('[SYS:BATTERY] pmset failed:', err.message);
    return null;
  }
});
```

Extend `preload.js`:

```js
  getBatteryStatus: () => ipcRenderer.invoke('sys:battery'),
```

- [ ] **Step 6: Sanity-check**

Run: `node --check desktop/main.js && node --check desktop/preload.js`
Expected: exit code 0 for both

- [ ] **Step 7: Commit**

```bash
git add desktop/systemInfo.js desktop/__tests__/systemInfo.test.js desktop/main.js desktop/preload.js
git commit -m "desktop: add getBatteryStatus (sys:battery) — macOS via pmset, null elsewhere"
```

---

### Task 10: `getIdleTime`

**Files:**
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`

**Interfaces:**
- No new pure logic — `powerMonitor.getSystemIdleTime()` is a single synchronous Electron API call with no decision logic to extract, same category as Task 6's `restartApp`.

- [ ] **Step 1: Wire into `main.js`**

Extend the top-of-file `require('electron')` destructure to add `powerMonitor` (it currently destructures `app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage, ipcMain, net, powerSaveBlocker, safeStorage` — add `powerMonitor` to that list). Add:

```js
guardedHandle('sys:idle-time', () => {
  return powerMonitor.getSystemIdleTime();
});
```

- [ ] **Step 2: Wire into `preload.js`**

```js
  getIdleTime: () => ipcRenderer.invoke('sys:idle-time'),
```

- [ ] **Step 3: Sanity-check**

Run: `node --check desktop/main.js && node --check desktop/preload.js`
Expected: exit code 0 for both

- [ ] **Step 4: Commit**

```bash
git add desktop/main.js desktop/preload.js
git commit -m "desktop: add getIdleTime (sys:idle-time)"
```

---

### Task 11: Final verification pass

**Files:** none changed — verification only.

- [ ] **Step 1: Run the full systemInfo + security suites**

Run: `cd desktop && node --test '__tests__/**/*.js' 'security/__tests__/**/*.js'`
Expected: PASS — 22 `systemInfo` tests + 76 inherited (30 `secretsStore` + 46 `ipcGuard`) = 98 tests, 0 failing.

- [ ] **Step 2: Confirm every modified file still parses cleanly**

Run: `node --check desktop/main.js && node --check desktop/preload.js && node --check desktop/systemInfo.js`
Expected: exit code 0 for all three, no output.

- [ ] **Step 3: Confirm all 10 `sys:*` channels are registered exactly once**

Run: `grep -c "guardedHandle('sys:" desktop/main.js`
Expected: `10`.

- [ ] **Step 4: Confirm `appendToLogFile` wiring didn't touch any other console call site**

Run: `grep -c "appendToLogFile(" desktop/main.js`
Expected: `2` (the two crash-handler call sites from Task 2, nothing else) — a higher count would mean scope crept into other log call sites this plan's Global Constraints explicitly ruled out.

- [ ] **Step 5: Full manual dev-run smoke test (same known limitation as prior groups)**

Run: `cd desktop && npm start`
Expected: app launches; if a real display server is available, exercise each new `window.electron.*` method from the renderer devtools console (dev mode only) and confirm reasonable output — especially `getBatteryStatus()` on the actual test machine (should return real values on a MacBook, `null` on a Mac desktop). If no display server is available, say so explicitly and rely on Steps 1-4's static checks instead.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "desktop: complete Group A (system & diagnostics) — 98 tests passing"
```
