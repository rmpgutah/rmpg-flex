# FZ-55 Windows Hardware Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the FZ-55's Windows-native hardware (dual hot-swap batteries, dock
connector, WWAN modem, barcode-reader xPAK, TPM 2.0) into the Electron desktop app so
`sys:battery` and friends actually work on the production Windows deployment target
instead of only on the macOS dev machine.

**Architecture:** One new pure-logic module `desktop/hardwareFz55.js` (parsing/shaping
functions, OS-touching dependency injected as a parameter — no live OS access inside pure
functions), following the exact convention of `desktop/systemInfo.js` /
`desktop/deviceInfo.js`. Each function is wired into `main.js` via `guardedHandle(...)`,
exposed through `preload.js`, and callable from `client/src` as `window.electron.*`.
Windows data comes from `child_process.execFile('powershell.exe', [...])` running
`Get-CimInstance`/`Get-PnpDevice`/`Get-Tpm` and parsing `ConvertTo-Json` output — no new
native/node-gyp dependency.

**Tech Stack:** Node.js (Electron main process), `node:child_process`, PowerShell CIM
cmdlets (Windows-only, no additional npm dependency), `node --test` for unit tests.

## Global Constraints

- Every new Windows-only code path MUST degrade to `null` (or the feature's documented
  empty shape) on any non-`win32` platform — mirroring the existing `sys:battery` handler's
  `darwin`-only branch, just inverted. Never throw across the IPC boundary.
- Every `child_process.execFile` call MUST set a timeout (3000ms, matching the existing
  `pmset` call in `main.js`) and wrap in try/catch, logging via `console.error` on failure.
- Pure parsing/shaping functions live in `desktop/hardwareFz55.js` and take their raw
  input (a JSON string, a keystroke array) as a parameter — never call `child_process`,
  `fs`, or any Electron API directly. This is what makes them unit-testable with
  `node --test` and no Windows machine.
- New files must be added to `package.json`'s `build.files` array or electron-builder
  will silently omit them from packaged builds.
- Fingerprint and smartcard xPAK modules are explicitly OUT OF SCOPE — do not add code
  for them in this plan.
- Spec: `docs/superpowers/specs/2026-07-29-fz55-hardware-integration-design.md`

---

## Task 1: `hardwareFz55.js` module skeleton + Windows battery parser

**Files:**
- Create: `desktop/hardwareFz55.js`
- Create: `desktop/__tests__/hardwareFz55.test.js`

**Interfaces:**
- Produces: `parseWindowsBatteryOutput(rawJsonString: string): { batteries: Array<{percent: number, charging: boolean}>, overallPercent: number, charging: boolean } | null`

- [ ] **Step 1: Write the failing tests**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseWindowsBatteryOutput } = require('../hardwareFz55');

test('parseWindowsBatteryOutput: single battery, discharging', () => {
  const raw = JSON.stringify({ DeviceID: 'Battery0', EstimatedChargeRemaining: 76, BatteryStatus: 1 });
  assert.deepEqual(parseWindowsBatteryOutput(raw), {
    batteries: [{ percent: 76, charging: false }],
    overallPercent: 76,
    charging: false,
  });
});

test('parseWindowsBatteryOutput: single battery, charging (AC)', () => {
  const raw = JSON.stringify({ DeviceID: 'Battery0', EstimatedChargeRemaining: 40, BatteryStatus: 2 });
  assert.deepEqual(parseWindowsBatteryOutput(raw), {
    batteries: [{ percent: 40, charging: true }],
    overallPercent: 40,
    charging: true,
  });
});

test('parseWindowsBatteryOutput: dual hot-swap bays, both discharging', () => {
  const raw = JSON.stringify([
    { DeviceID: 'Battery0', EstimatedChargeRemaining: 80, BatteryStatus: 1 },
    { DeviceID: 'Battery1', EstimatedChargeRemaining: 60, BatteryStatus: 1 },
  ]);
  assert.deepEqual(parseWindowsBatteryOutput(raw), {
    batteries: [
      { percent: 80, charging: false },
      { percent: 60, charging: false },
    ],
    overallPercent: 70,
    charging: false,
  });
});

test('parseWindowsBatteryOutput: dual bays, one charging counts overall as charging', () => {
  const raw = JSON.stringify([
    { DeviceID: 'Battery0', EstimatedChargeRemaining: 50, BatteryStatus: 2 },
    { DeviceID: 'Battery1', EstimatedChargeRemaining: 90, BatteryStatus: 1 },
  ]);
  const result = parseWindowsBatteryOutput(raw);
  assert.equal(result.overallPercent, 70);
  assert.equal(result.charging, true);
});

test('parseWindowsBatteryOutput: empty array (desktop, no battery) returns null', () => {
  assert.equal(parseWindowsBatteryOutput(JSON.stringify([])), null);
});

test('parseWindowsBatteryOutput: malformed JSON returns null', () => {
  assert.equal(parseWindowsBatteryOutput('not json'), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd desktop && node --test __tests__/hardwareFz55.test.js`
Expected: FAIL — `Cannot find module '../hardwareFz55'`

- [ ] **Step 3: Write the module**

```js
// ============================================================
// RMPG Flex — FZ-55 Windows-native hardware
// Parsing/shaping for Panasonic Toughbook FZ-55 hardware queried
// via PowerShell CIM cmdlets. Every function takes its raw input
// (a JSON string, a keystroke array) as a parameter — no live OS
// access here — mirroring desktop/systemInfo.js's/deviceInfo.js's
// pattern, for zero-runtime-dependency unit testing.
// ============================================================

'use strict';

/**
 * Parses `Get-CimInstance -ClassName Win32_Battery | ... | ConvertTo-Json`
 * output. Win32_Battery returns one instance per installed battery — the
 * FZ-55's dual hot-swap bays surface as a JSON array of 0, 1, or 2 entries
 * (a single instance serializes as a bare object, not a 1-element array).
 * BatteryStatus 2 = on AC/charging, everything else treated as discharging
 * (WMI's enum has several discharge-adjacent values; only 2 means charging).
 */
function parseWindowsBatteryOutput(rawJsonString) {
  let parsed;
  try {
    parsed = JSON.parse(rawJsonString);
  } catch {
    return null;
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  if (entries.length === 0) return null;

  const batteries = entries.map((entry) => ({
    percent: Number(entry.EstimatedChargeRemaining),
    charging: entry.BatteryStatus === 2,
  }));

  const overallPercent = Math.round(
    batteries.reduce((sum, b) => sum + b.percent, 0) / batteries.length
  );
  const charging = batteries.some((b) => b.charging);

  return { batteries, overallPercent, charging };
}

module.exports = {
  parseWindowsBatteryOutput,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd desktop && node --test __tests__/hardwareFz55.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add desktop/hardwareFz55.js desktop/__tests__/hardwareFz55.test.js
git commit -m "feat(desktop): add Windows battery parser for FZ-55 dual hot-swap bays"
```

---

## Task 2: Wire Windows battery into `main.js` + `preload.js`

**Files:**
- Modify: `desktop/main.js:1370-1381` (the existing `sys:battery` handler)
- Modify: `desktop/preload.js` (no signature change — `getBatteryStatus()` already exists;
  this task changes what the IPC channel returns on Windows, not the renderer-facing API)

**Interfaces:**
- Consumes: `parseWindowsBatteryOutput` from `desktop/hardwareFz55.js` (Task 1)
- Produces: `sys:battery` IPC channel now returns the dual-bay shape on Windows in addition
  to the existing macOS shape (both are `{ batteries, overallPercent, charging }` or
  `{ percent, charging }`-shaped — see note below)

Note on shape compatibility: `parsePmsetBatteryOutput` (existing, macOS) returns
`{ percent, charging }`. `parseWindowsBatteryOutput` (Task 1) returns
`{ batteries, overallPercent, charging }`. These are two different shapes returned by the
same IPC channel depending on platform — any renderer code reading `sys:battery`'s result
must handle both `.percent` (mac) and `.overallPercent` (Windows) if it needs to support
both dev (Mac) and prod (Windows). This task does not touch renderer code; it only makes
the Windows branch return real data instead of `null`.

- [ ] **Step 1: Update the import line**

In `desktop/main.js`, find the line requiring `systemInfo.js` (near the top, alongside the
other module requires) and add the new require immediately after it:

```js
const { parseWindowsBatteryOutput } = require('./hardwareFz55');
```

- [ ] **Step 2: Replace the `sys:battery` handler**

Find this existing block in `desktop/main.js` (around line 1370):

```js
guardedHandle('sys:battery', async () => {
  if (process.platform !== 'darwin') return null;
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('pmset', ['-g', 'batt'], { timeout: 3000 });
    return parsePmsetBatteryOutput(stdout);
  } catch (err) {
    console.error('[SYS:BATTERY] pmset failed:', err.message);
    return null;
  }
});
```

Replace it with:

```js
guardedHandle('sys:battery', async () => {
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('pmset', ['-g', 'batt'], { timeout: 3000 });
      return parsePmsetBatteryOutput(stdout);
    } catch (err) {
      console.error('[SYS:BATTERY] pmset failed:', err.message);
      return null;
    }
  }

  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-Command', 'Get-CimInstance -ClassName Win32_Battery | Select-Object DeviceID, EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json'],
        { timeout: 3000 }
      );
      return parseWindowsBatteryOutput(stdout);
    } catch (err) {
      console.error('[SYS:BATTERY] Get-CimInstance Win32_Battery failed:', err.message);
      return null;
    }
  }

  return null;
});
```

- [ ] **Step 3: Add `hardwareFz55.js` to the packaged build's files list**

In `desktop/package.json`, find the `"build.files"` array (contains `"systemInfo.js"`,
`"deviceInfo.js"`, etc.) and add `"hardwareFz55.js"` to it, alongside the other bare
module filenames.

- [ ] **Step 4: Run the full desktop test suite to confirm nothing broke**

Run: `cd desktop && node --test '__tests__/**/*.js' 'security/__tests__/**/*.js'`
Expected: PASS, all existing tests + the 6 new ones from Task 1 still passing

- [ ] **Step 5: Commit**

```bash
git add desktop/main.js desktop/package.json
git commit -m "feat(desktop): return real battery status on Windows instead of null"
```

---

## Task 3: Dock state detection

**Files:**
- Modify: `desktop/hardwareFz55.js` (add `parseWindowsDockOutput`)
- Modify: `desktop/__tests__/hardwareFz55.test.js` (add tests)
- Modify: `desktop/main.js` (add `device:dock-state` handler)
- Modify: `desktop/preload.js` (add `getDockState()`)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `parseWindowsDockOutput(rawJsonString: string): { docked: boolean }`; IPC
  channel `device:dock-state`; `window.electron.getDockState(): Promise<{docked: boolean} | null>`

- [ ] **Step 1: Write the failing tests**

Add to `desktop/__tests__/hardwareFz55.test.js`:

```js
const { parseWindowsDockOutput } = require('../hardwareFz55');

test('parseWindowsDockOutput: docked when a DockUpDown device is OK', () => {
  const raw = JSON.stringify({ Status: 'OK' });
  assert.deepEqual(parseWindowsDockOutput(raw), { docked: true });
});

test('parseWindowsDockOutput: docked when multiple DockUpDown devices, one OK', () => {
  const raw = JSON.stringify([{ Status: 'Error' }, { Status: 'OK' }]);
  assert.deepEqual(parseWindowsDockOutput(raw), { docked: true });
});

test('parseWindowsDockOutput: not docked when no devices returned', () => {
  assert.deepEqual(parseWindowsDockOutput(JSON.stringify([])), { docked: false });
});

test('parseWindowsDockOutput: not docked when devices exist but none OK', () => {
  const raw = JSON.stringify([{ Status: 'Error' }]);
  assert.deepEqual(parseWindowsDockOutput(raw), { docked: false });
});

test('parseWindowsDockOutput: not docked on malformed JSON', () => {
  assert.deepEqual(parseWindowsDockOutput('garbage'), { docked: false });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd desktop && node --test __tests__/hardwareFz55.test.js`
Expected: FAIL — `parseWindowsDockOutput` is not a function

- [ ] **Step 3: Implement the parser**

In `desktop/hardwareFz55.js`, add:

```js
/**
 * Parses `Get-PnpDevice -Class DockUpDown | Select-Object Status | ConvertTo-Json`
 * output. The 24-pin docking connector fires an ACPI DockUpDown PnP event;
 * `docked: true` when at least one such device reports Status 'OK'.
 */
function parseWindowsDockOutput(rawJsonString) {
  let parsed;
  try {
    parsed = JSON.parse(rawJsonString);
  } catch {
    return { docked: false };
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return { docked: entries.some((entry) => entry && entry.Status === 'OK') };
}
```

Add `parseWindowsDockOutput` to the `module.exports` object.

- [ ] **Step 4: Run to verify tests pass**

Run: `cd desktop && node --test __tests__/hardwareFz55.test.js`
Expected: PASS (11 tests total)

- [ ] **Step 5: Wire the IPC handler in `main.js`**

Update the require line from Task 2 to also pull in the new function:

```js
const { parseWindowsBatteryOutput, parseWindowsDockOutput } = require('./hardwareFz55');
```

Add a new handler near the other `sys:*`/`device:*` handlers:

```js
guardedHandle('device:dock-state', async () => {
  if (process.platform !== 'win32') return { docked: false };
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', "Get-PnpDevice -Class DockUpDown | Select-Object Status | ConvertTo-Json"],
      { timeout: 3000 }
    );
    return parseWindowsDockOutput(stdout);
  } catch (err) {
    console.error('[DEVICE:DOCK-STATE] Get-PnpDevice DockUpDown failed:', err.message);
    return { docked: false };
  }
});
```

- [ ] **Step 6: Expose it in `preload.js`**

In the `─── Device & Hardware ───` section of `desktop/preload.js` (next to
`checkGpsHardwarePresent`), add:

```js
getDockState: () => ipcRenderer.invoke('device:dock-state'),
```

- [ ] **Step 7: Run the full desktop test suite**

Run: `cd desktop && node --test '__tests__/**/*.js' 'security/__tests__/**/*.js'`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add desktop/hardwareFz55.js desktop/__tests__/hardwareFz55.test.js desktop/main.js desktop/preload.js
git commit -m "feat(desktop): detect FZ-55 dock connector state via DockUpDown PnP class"
```

---

## Task 4: WWAN modem status

**Files:**
- Modify: `desktop/hardwareFz55.js` (add `parseWindowsWwanOutput`)
- Modify: `desktop/__tests__/hardwareFz55.test.js` (add tests)
- Modify: `desktop/main.js` (add `device:wwan-status` handler)
- Modify: `desktop/preload.js` (add `getWwanStatus()`)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `parseWindowsWwanOutput(rawJsonString: string): { present: boolean, connected: boolean }`;
  IPC channel `device:wwan-status`; `window.electron.getWwanStatus(): Promise<{present, connected} | null>`

- [ ] **Step 1: Write the failing tests**

Add to `desktop/__tests__/hardwareFz55.test.js`:

```js
const { parseWindowsWwanOutput } = require('../hardwareFz55');

test('parseWindowsWwanOutput: present and connected', () => {
  const raw = JSON.stringify({ Name: 'Sierra Wireless EM7511', InterfaceDescription: 'Sierra Wireless EM7511', Status: 'Up' });
  assert.deepEqual(parseWindowsWwanOutput(raw), { present: true, connected: true });
});

test('parseWindowsWwanOutput: present but not connected', () => {
  const raw = JSON.stringify({ Name: 'Sierra Wireless EM7511', InterfaceDescription: 'Sierra Wireless EM7511', Status: 'Disconnected' });
  assert.deepEqual(parseWindowsWwanOutput(raw), { present: true, connected: false });
});

test('parseWindowsWwanOutput: no WWAN adapter installed', () => {
  assert.deepEqual(parseWindowsWwanOutput(JSON.stringify([])), { present: false, connected: false });
});

test('parseWindowsWwanOutput: malformed JSON treated as not present', () => {
  assert.deepEqual(parseWindowsWwanOutput('garbage'), { present: false, connected: false });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd desktop && node --test __tests__/hardwareFz55.test.js`
Expected: FAIL — `parseWindowsWwanOutput` is not a function

- [ ] **Step 3: Implement the parser**

In `desktop/hardwareFz55.js`, add:

```js
/**
 * Parses `Get-NetAdapter | Where-Object {$_.InterfaceDescription -match
 * 'Sierra|EM74|EM75|EM91'} | Select-Object Name, InterfaceDescription,
 * Status | ConvertTo-Json` output. The PowerShell filter already narrows
 * to WWAN adapters (Sierra EM7455/EM7511/EM7421/EM7595, mk3 5G EM9190), so
 * an empty result means no WWAN module installed, and any entry present
 * means the module is there; Status 'Up' means an active connection.
 */
function parseWindowsWwanOutput(rawJsonString) {
  let parsed;
  try {
    parsed = JSON.parse(rawJsonString);
  } catch {
    return { present: false, connected: false };
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  if (entries.length === 0) return { present: false, connected: false };
  return { present: true, connected: entries.some((entry) => entry && entry.Status === 'Up') };
}
```

Add `parseWindowsWwanOutput` to `module.exports`.

- [ ] **Step 4: Run to verify tests pass**

Run: `cd desktop && node --test __tests__/hardwareFz55.test.js`
Expected: PASS (15 tests total)

- [ ] **Step 5: Wire the IPC handler in `main.js`**

Update the require line:

```js
const { parseWindowsBatteryOutput, parseWindowsDockOutput, parseWindowsWwanOutput } = require('./hardwareFz55');
```

Add the handler:

```js
guardedHandle('device:wwan-status', async () => {
  if (process.platform !== 'win32') return { present: false, connected: false };
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', "Get-NetAdapter | Where-Object {$_.InterfaceDescription -match 'Sierra|EM74|EM75|EM91'} | Select-Object Name, InterfaceDescription, Status | ConvertTo-Json"],
      { timeout: 3000 }
    );
    return parseWindowsWwanOutput(stdout);
  } catch (err) {
    console.error('[DEVICE:WWAN-STATUS] Get-NetAdapter failed:', err.message);
    return { present: false, connected: false };
  }
});
```

- [ ] **Step 6: Expose it in `preload.js`**

```js
getWwanStatus: () => ipcRenderer.invoke('device:wwan-status'),
```

- [ ] **Step 7: Run the full desktop test suite**

Run: `cd desktop && node --test '__tests__/**/*.js' 'security/__tests__/**/*.js'`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add desktop/hardwareFz55.js desktop/__tests__/hardwareFz55.test.js desktop/main.js desktop/preload.js
git commit -m "feat(desktop): surface FZ-55 WWAN modem presence and connection status"
```

---

## Task 5: TPM / Secured-core posture

**Files:**
- Modify: `desktop/hardwareFz55.js` (add `parseWindowsTpmOutput`)
- Modify: `desktop/__tests__/hardwareFz55.test.js` (add tests)
- Modify: `desktop/main.js` (add `sys:tpm-status` handler)
- Modify: `desktop/preload.js` (add `getTpmStatus()`)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `parseWindowsTpmOutput(rawJsonString: string): { present: boolean, ready: boolean, enabled: boolean }`;
  IPC channel `sys:tpm-status`; `window.electron.getTpmStatus(): Promise<{present, ready, enabled} | null>`

- [ ] **Step 1: Write the failing tests**

Add to `desktop/__tests__/hardwareFz55.test.js`:

```js
const { parseWindowsTpmOutput } = require('../hardwareFz55');

test('parseWindowsTpmOutput: present, ready, and enabled', () => {
  const raw = JSON.stringify({ TpmPresent: true, TpmReady: true, TpmEnabled: true });
  assert.deepEqual(parseWindowsTpmOutput(raw), { present: true, ready: true, enabled: true });
});

test('parseWindowsTpmOutput: present but not ready', () => {
  const raw = JSON.stringify({ TpmPresent: true, TpmReady: false, TpmEnabled: true });
  assert.deepEqual(parseWindowsTpmOutput(raw), { present: true, ready: false, enabled: true });
});

test('parseWindowsTpmOutput: not present', () => {
  const raw = JSON.stringify({ TpmPresent: false, TpmReady: false, TpmEnabled: false });
  assert.deepEqual(parseWindowsTpmOutput(raw), { present: false, ready: false, enabled: false });
});

test('parseWindowsTpmOutput: malformed JSON returns null', () => {
  assert.equal(parseWindowsTpmOutput('garbage'), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd desktop && node --test __tests__/hardwareFz55.test.js`
Expected: FAIL — `parseWindowsTpmOutput` is not a function

- [ ] **Step 3: Implement the parser**

In `desktop/hardwareFz55.js`, add:

```js
/**
 * Parses `Get-Tpm | Select-Object TpmPresent, TpmReady, TpmEnabled |
 * ConvertTo-Json` output. Read-only posture reporting for the FZ-55's
 * Secured-core PC hardware root of trust — consumed by desktop/security/
 * as one more signal, never used to block app function.
 */
function parseWindowsTpmOutput(rawJsonString) {
  let parsed;
  try {
    parsed = JSON.parse(rawJsonString);
  } catch {
    return null;
  }
  return {
    present: Boolean(parsed.TpmPresent),
    ready: Boolean(parsed.TpmReady),
    enabled: Boolean(parsed.TpmEnabled),
  };
}
```

Add `parseWindowsTpmOutput` to `module.exports`.

- [ ] **Step 4: Run to verify tests pass**

Run: `cd desktop && node --test __tests__/hardwareFz55.test.js`
Expected: PASS (19 tests total)

- [ ] **Step 5: Wire the IPC handler in `main.js`**

Update the require line:

```js
const { parseWindowsBatteryOutput, parseWindowsDockOutput, parseWindowsWwanOutput, parseWindowsTpmOutput } = require('./hardwareFz55');
```

Add the handler near `sys:battery`:

```js
guardedHandle('sys:tpm-status', async () => {
  if (process.platform !== 'win32') return null;
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', 'Get-Tpm | Select-Object TpmPresent, TpmReady, TpmEnabled | ConvertTo-Json'],
      { timeout: 3000 }
    );
    return parseWindowsTpmOutput(stdout);
  } catch (err) {
    console.error('[SYS:TPM-STATUS] Get-Tpm failed:', err.message);
    return null;
  }
});
```

- [ ] **Step 6: Expose it in `preload.js`**

```js
getTpmStatus: () => ipcRenderer.invoke('sys:tpm-status'),
```

- [ ] **Step 7: Run the full desktop test suite**

Run: `cd desktop && node --test '__tests__/**/*.js' 'security/__tests__/**/*.js'`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add desktop/hardwareFz55.js desktop/__tests__/hardwareFz55.test.js desktop/main.js desktop/preload.js
git commit -m "feat(desktop): report TPM/Secured-core posture for FZ-55 (read-only)"
```

---

## Task 6: Barcode scanner keystroke-burst classifier (pure logic)

**Files:**
- Modify: `desktop/hardwareFz55.js` (add `classifyKeystrokeBurst`)
- Modify: `desktop/__tests__/hardwareFz55.test.js` (add tests)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `classifyKeystrokeBurst(records: Array<{char: string, timestampMs: number}>): { isScan: boolean, payload: string }`

This task is pure-logic only — no `main.js`/`preload.js` wiring yet (that's Task 7, since
it needs a live `BrowserWindow` listener rather than an IPC request/response call).

- [ ] **Step 1: Write the failing tests**

Add to `desktop/__tests__/hardwareFz55.test.js`:

```js
const { classifyKeystrokeBurst } = require('../hardwareFz55');

function burst(chars, gapMs) {
  return chars.split('').map((char, i) => ({ char, timestampMs: i * gapMs }));
}

test('classifyKeystrokeBurst: fast burst ending in Enter is a scan', () => {
  const records = burst('ABC123', 10).concat([{ char: 'Enter', timestampMs: 60 }]);
  assert.deepEqual(classifyKeystrokeBurst(records), { isScan: true, payload: 'ABC123' });
});

test('classifyKeystrokeBurst: slow human typing is not a scan', () => {
  const records = burst('ABC123', 200).concat([{ char: 'Enter', timestampMs: 1200 }]);
  assert.deepEqual(classifyKeystrokeBurst(records), { isScan: false, payload: '' });
});

test('classifyKeystrokeBurst: fast burst not ending in Enter is not a scan', () => {
  const records = burst('ABC123', 10);
  assert.deepEqual(classifyKeystrokeBurst(records), { isScan: false, payload: '' });
});

test('classifyKeystrokeBurst: fast but under the 3-char minimum is not a scan', () => {
  const records = burst('AB', 10).concat([{ char: 'Enter', timestampMs: 20 }]);
  assert.deepEqual(classifyKeystrokeBurst(records), { isScan: false, payload: '' });
});

test('classifyKeystrokeBurst: one slow gap in an otherwise-fast burst is not a scan', () => {
  const records = [
    { char: 'A', timestampMs: 0 },
    { char: 'B', timestampMs: 10 },
    { char: 'C', timestampMs: 300 },
    { char: 'D', timestampMs: 310 },
    { char: 'Enter', timestampMs: 320 },
  ];
  assert.deepEqual(classifyKeystrokeBurst(records), { isScan: false, payload: '' });
});

test('classifyKeystrokeBurst: empty input is not a scan', () => {
  assert.deepEqual(classifyKeystrokeBurst([]), { isScan: false, payload: '' });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd desktop && node --test __tests__/hardwareFz55.test.js`
Expected: FAIL — `classifyKeystrokeBurst` is not a function

- [ ] **Step 3: Implement the classifier**

In `desktop/hardwareFz55.js`, add:

```js
const BARCODE_MAX_GAP_MS = 30;
const BARCODE_MIN_LENGTH = 3;

/**
 * Classifies a buffered run of keydown records as a barcode-scanner
 * keyboard-wedge burst (fast, ends in Enter, at least BARCODE_MIN_LENGTH
 * characters) vs. ordinary human typing. The FZ-55's barcode xPAK
 * (FZ-VBR551M) emits characters far faster than any human can type, so a
 * consistent sub-30ms inter-key gap is the distinguishing signal.
 */
function classifyKeystrokeBurst(records) {
  if (!records || records.length < BARCODE_MIN_LENGTH + 1) {
    return { isScan: false, payload: '' };
  }
  const last = records[records.length - 1];
  if (last.char !== 'Enter') {
    return { isScan: false, payload: '' };
  }
  const payloadRecords = records.slice(0, -1);
  if (payloadRecords.length < BARCODE_MIN_LENGTH) {
    return { isScan: false, payload: '' };
  }
  for (let i = 1; i < records.length; i++) {
    const gap = records[i].timestampMs - records[i - 1].timestampMs;
    if (gap > BARCODE_MAX_GAP_MS) {
      return { isScan: false, payload: '' };
    }
  }
  return { isScan: true, payload: payloadRecords.map((r) => r.char).join('') };
}
```

Add `classifyKeystrokeBurst` to `module.exports`.

- [ ] **Step 4: Run to verify tests pass**

Run: `cd desktop && node --test __tests__/hardwareFz55.test.js`
Expected: PASS (25 tests total)

- [ ] **Step 5: Commit**

```bash
git add desktop/hardwareFz55.js desktop/__tests__/hardwareFz55.test.js
git commit -m "feat(desktop): add barcode-scanner keystroke-burst classifier"
```

---

## Task 7: Wire barcode capture into `main.js` + `preload.js`

**Files:**
- Modify: `desktop/main.js` (add `before-input-event` listener on `mainWindow`)
- Modify: `desktop/preload.js` (add `onBarcodeScanned(callback)`)

**Interfaces:**
- Consumes: `classifyKeystrokeBurst` from `desktop/hardwareFz55.js` (Task 6)
- Produces: `hardware:barcode-scanned` event, pushed from main to renderer;
  `window.electron.onBarcodeScanned(callback): () => void` (unsubscribe function,
  matching `onInternalGpsUpdate`'s existing pattern)

- [ ] **Step 1: Update the require line in `main.js`**

```js
const { parseWindowsBatteryOutput, parseWindowsDockOutput, parseWindowsWwanOutput, parseWindowsTpmOutput, classifyKeystrokeBurst } = require('./hardwareFz55');
```

- [ ] **Step 2: Add the keydown buffer and listener**

In `desktop/main.js`, find where `mainWindow = new BrowserWindow({...})` is assigned
(around line 933) and locate the block immediately after the window is created and its
`webContents` is available (look for where other `mainWindow.webContents.on(...)`
listeners are already attached, to keep this near them). Add:

```js
// ─── Barcode scanner (FZ-VBR551M xPAK) ──────────────────────
// The barcode module is a USB HID keyboard-wedge — it "types" the scanned
// payload followed by Enter far faster than any human. Buffer keydowns per
// window and classify the burst on every Enter; a 200ms trailing gap with
// no Enter resets the buffer so a human pause doesn't get misread later.
let barcodeBuffer = [];
let barcodeBufferResetTimer = null;

function resetBarcodeBuffer() {
  barcodeBuffer = [];
  if (barcodeBufferResetTimer) {
    clearTimeout(barcodeBufferResetTimer);
    barcodeBufferResetTimer = null;
  }
}

mainWindow.webContents.on('before-input-event', (event, input) => {
  if (input.type !== 'keyDown') return;

  barcodeBuffer.push({ char: input.key, timestampMs: Date.now() });
  if (barcodeBufferResetTimer) clearTimeout(barcodeBufferResetTimer);
  barcodeBufferResetTimer = setTimeout(resetBarcodeBuffer, 200);

  if (input.key === 'Enter') {
    const result = classifyKeystrokeBurst(barcodeBuffer);
    resetBarcodeBuffer();
    if (result.isScan) {
      mainWindow.webContents.send('hardware:barcode-scanned', result.payload);
    }
  }
});
```

- [ ] **Step 3: Expose the subscription in `preload.js`**

In the `─── Device & Hardware ───` section, next to `onInternalGpsUpdate`, add:

```js
onBarcodeScanned: (callback) => {
  const handler = (_e, payload) => callback(payload);
  ipcRenderer.on('hardware:barcode-scanned', handler);
  return () => ipcRenderer.removeListener('hardware:barcode-scanned', handler);
},
```

- [ ] **Step 4: Run the full desktop test suite**

Run: `cd desktop && node --test '__tests__/**/*.js' 'security/__tests__/**/*.js'`
Expected: PASS (no regressions — this task adds only Electron event wiring, which the
existing test suite doesn't attempt to exercise since it requires a live `BrowserWindow`)

- [ ] **Step 5: Commit**

```bash
git add desktop/main.js desktop/preload.js
git commit -m "feat(desktop): capture FZ-55 barcode scanner input as hardware:barcode-scanned events"
```

---

## Task 8: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full desktop test suite one more time**

Run: `cd desktop && node --test '__tests__/**/*.js' 'security/__tests__/**/*.js'`
Expected: PASS, 0 failures

- [ ] **Step 2: Confirm `hardwareFz55.js` is in the packaged build**

Run: `grep -n "hardwareFz55.js" desktop/package.json`
Expected: one match, inside the `build.files` array

- [ ] **Step 3: Confirm every new IPC channel has both a `main.js` handler and a `preload.js` exposure**

Run: `grep -n "device:dock-state\|device:wwan-status\|sys:tpm-status\|hardware:barcode-scanned" desktop/main.js desktop/preload.js`
Expected: each channel name appears in both files

- [ ] **Step 4: Run root-level checks per CLAUDE.md guidance (worker typecheck unaffected, but confirm no accidental cross-contamination)**

Run: `npm run typecheck`
Expected: PASS (this change touches only `desktop/`, which has no shared build with `/src/`,
but this confirms nothing was accidentally edited outside `desktop/`)

- [ ] **Step 5: Commit any final cleanup (only if Step 1-4 required a fix)**

If all steps pass with no changes needed, this task requires no commit — it's a
verification gate, not a code change.
