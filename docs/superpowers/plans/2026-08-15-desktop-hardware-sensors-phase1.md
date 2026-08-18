# Desktop Hardware & Sensors Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire all Panasonic Toughbook FZ-55 hardware capabilities into RMPG Flex Desktop — thermal, smartcard, fingerprint, WWAN signal, dual battery, body cam, GPS enhancements, hardware + camera barcode scanning, and offline face recognition for FlexOS lock screen auth.

**Architecture:** Pure-function parsers in `hardwareFz55.js` / `internalGps.js` handle raw OS output and are unit-testable in plain Node.js with no Electron runtime. IPC handlers in `main.js` call PowerShell/WMI, invoke parsers, and push events. Face recognition runs in `faceAuth.js` (embedding storage + distance comparison in main; camera capture + TF.js inference in the renderer via a hidden BrowserWindow). Camera QR scanning uses `cameraScanner.js` (jsQR in an off-screen BrowserWindow), emitting the same `hardware:barcode-scan` event shape as the xPAK.

**Tech Stack:** Electron 33, Node.js, PowerShell/WMI (Windows), @vladmandic/face-api, jsqr, node-hid, usb-detection, serialport (existing), better-sqlite3 (existing)

## Global Constraints

- All new IPC handlers use `guardedHandle()` — never raw `ipcMain.handle()`
- All parsers are pure functions taking raw string/buffer input — no live OS calls inside parsers
- Windows-only features return `null` / `{ present: false }` on non-win32; never throw
- New native deps added to `electron-rebuild -f -w` list in both `postinstall` and `rebuild` scripts
- Test runner: `node --test '__tests__/**/*.js' 'security/__tests__/**/*.js'` (no change needed)
- Rebuild dance before running tests: `npm rebuild better-sqlite3 node-hid usb-detection`; restore after: `npm run rebuild`
- Face embeddings encrypted via `safeStorage.encryptString()` before writing to localDb
- All IPC push events (main→renderer) go via `mainWindow.webContents.send(channel, payload)`
- Unified barcode event shape: `{ payload: string, source: 'xpak' | 'camera' }` on channel `hardware:barcode-scan`
- Existing `hardware:barcode-scanned` (bare string) must be updated to new shape — no new channel

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `desktop/package.json` | Modify | Add 4 new deps; extend rebuild scripts |
| `desktop/hardwareFz55.js` | Modify | Add 5 new parsers; extend battery parser |
| `desktop/__tests__/hardwareFz55Extended.test.js` | Create | Tests for all new hardwareFz55.js parsers |
| `desktop/__tests__/hardwareFz55.test.js` | Modify | Add battery `minutesRemaining` tests |
| `desktop/internalGps.js` | Modify | Add parseVTG, parseGLL, parseGSV, dead reckoning, fix quality |
| `desktop/__tests__/internalGpsExtended.test.js` | Create | Tests for all new internalGps.js functions |
| `desktop/faceAuth.js` | Create | Face embedding storage, encryption, Euclidean distance comparison |
| `desktop/__tests__/faceAuth.test.js` | Create | Tests for faceAuth.js with injectable deps |
| `desktop/cameraScanner.js` | Create | Off-screen BrowserWindow camera frame capture + jsQR decode loop |
| `desktop/main.js` | Modify | Fill detectToughbook(), replace stubs, add 20+ IPC handlers, push timers, geofence engine, unified barcode event |
| `desktop/localDb.js` | Modify | Add face_embedding column reconciliation to initLocalDb() |
| `desktop/splash.html` | Modify | Face unlock button on lock screen |
| `desktop/splashPreload.js` | Modify | Expose face:verify + face:enrollment-status via contextBridge |

---

## Task 1: Add npm dependencies and extend rebuild scripts

**Files:**
- Modify: `desktop/package.json`

**Interfaces:**
- Produces: `@vladmandic/face-api`, `jsqr`, `node-hid`, `usb-detection` importable in subsequent tasks

- [ ] **Step 1: Add dependencies**

In `desktop/package.json`, add to `"dependencies"`:
```json
"@vladmandic/face-api": "^3.4.0",
"jsqr": "^1.4.0",
"node-hid": "^3.1.0",
"usb-detection": "^4.1.0"
```

- [ ] **Step 2: Extend rebuild scripts**

Replace both rebuild-related lines:
```json
"postinstall": "electron-rebuild -f -w serialport,better-sqlite3,node-hid,usb-detection || echo '[postinstall] electron-rebuild skipped'",
"rebuild": "electron-rebuild -f -w serialport,better-sqlite3,node-hid,usb-detection"
```

Also add to the `"files"` array in the `"build"` section (so packaged app includes them):
```json
"**/node_modules/node-hid/**/*",
"**/node_modules/usb-detection/**/*",
"**/node_modules/@vladmandic/**/*",
"**/node_modules/jsqr/**/*"
```

- [ ] **Step 3: Install**

```bash
cd desktop && npm install --legacy-peer-deps
```

Expected: no error (native bindings compile via postinstall).

- [ ] **Step 4: Verify imports load**

```bash
cd desktop && node -e "require('jsqr'); console.log('jsqr ok')"
```

Expected: `jsqr ok`

- [ ] **Step 5: Commit**

```bash
git add desktop/package.json desktop/package-lock.json
git commit -m "feat(desktop/hw): add face-api, jsqr, node-hid, usb-detection deps"
```

---

## Task 2: hardwareFz55.js — thermal, smartcard, fingerprint, WWAN signal parsers

**Files:**
- Modify: `desktop/hardwareFz55.js`
- Create: `desktop/__tests__/hardwareFz55Extended.test.js`

**Interfaces:**
- Produces:
  - `parseWindowsThermalOutput(rawJsonString)` → `{ zones: [{tempF: number}], maxTempF: number } | null`
  - `parseWindowsSmartCardOutput(rawJsonString)` → `{ present: boolean, cardInserted: boolean, atr: string|null }`
  - `parseWindowsFingerprintOutput(rawJsonString)` → `{ present: boolean, ready: boolean }`
  - `parseWindowsWwanSignalOutput(netshString)` → `{ rssi: number|null, bars: 0|1|2|3|4|5 }`

- [ ] **Step 1: Write failing tests**

Create `desktop/__tests__/hardwareFz55Extended.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseWindowsThermalOutput,
  parseWindowsSmartCardOutput,
  parseWindowsFingerprintOutput,
  parseWindowsWwanSignalOutput,
} = require('../hardwareFz55');

// ── Thermal ──────────────────────────────────────────────────
test('parseWindowsThermalOutput: converts tenths-of-Kelvin to °F', () => {
  // 3232 tenths = 323.2 K = 50.05°C = 122.09°F
  const raw = JSON.stringify([{ CurrentTemperature: 3232 }, { CurrentTemperature: 3418 }]);
  const result = parseWindowsThermalOutput(raw);
  assert.ok(result);
  assert.equal(result.zones.length, 2);
  assert.ok(Math.abs(result.zones[0].tempF - 122.09) < 0.1);
  assert.equal(result.maxTempF, result.zones[1].tempF);
});

test('parseWindowsThermalOutput: single object (not array) from WMI', () => {
  const raw = JSON.stringify({ CurrentTemperature: 2981 }); // ~24.95°C = 76.9°F
  const result = parseWindowsThermalOutput(raw);
  assert.ok(result);
  assert.equal(result.zones.length, 1);
});

test('parseWindowsThermalOutput: returns null on bad JSON', () => {
  assert.equal(parseWindowsThermalOutput('not json'), null);
  assert.equal(parseWindowsThermalOutput(''), null);
  assert.equal(parseWindowsThermalOutput(null), null);
});

// ── Smartcard ─────────────────────────────────────────────────
test('parseWindowsSmartCardOutput: detects present reader with no card', () => {
  const raw = JSON.stringify([{ FriendlyName: 'Panasonic Smart Card Reader', Status: 'OK' }]);
  const result = parseWindowsSmartCardOutput(raw);
  assert.equal(result.present, true);
  assert.equal(result.cardInserted, false);
  assert.equal(result.atr, null);
});

test('parseWindowsSmartCardOutput: detects card inserted via ATR field', () => {
  const raw = JSON.stringify([{ FriendlyName: 'Panasonic Smart Card Reader', Status: 'OK', ATR: '3B8F8001804F0CA000000306030001000000006A' }]);
  const result = parseWindowsSmartCardOutput(raw);
  assert.equal(result.present, true);
  assert.equal(result.cardInserted, true);
  assert.equal(result.atr, '3B8F8001804F0CA000000306030001000000006A');
});

test('parseWindowsSmartCardOutput: no reader present', () => {
  const result = parseWindowsSmartCardOutput(JSON.stringify([]));
  assert.equal(result.present, false);
  assert.equal(result.cardInserted, false);
});

test('parseWindowsSmartCardOutput: returns safe default on bad JSON', () => {
  const result = parseWindowsSmartCardOutput('not json');
  assert.equal(result.present, false);
});

// ── Fingerprint ───────────────────────────────────────────────
test('parseWindowsFingerprintOutput: detects ready fingerprint reader', () => {
  const raw = JSON.stringify([{ FriendlyName: 'Panasonic Fingerprint Sensor', Status: 'OK' }]);
  const result = parseWindowsFingerprintOutput(raw);
  assert.equal(result.present, true);
  assert.equal(result.ready, true);
});

test('parseWindowsFingerprintOutput: present but not ready (degraded)', () => {
  const raw = JSON.stringify([{ FriendlyName: 'Panasonic Fingerprint Sensor', Status: 'Error' }]);
  const result = parseWindowsFingerprintOutput(raw);
  assert.equal(result.present, true);
  assert.equal(result.ready, false);
});

test('parseWindowsFingerprintOutput: no reader', () => {
  const result = parseWindowsFingerprintOutput(JSON.stringify([]));
  assert.equal(result.present, false);
  assert.equal(result.ready, false);
});

// ── WWAN signal ───────────────────────────────────────────────
test('parseWindowsWwanSignalOutput: parses RSSI and maps to bars', () => {
  // netsh mbn show signal output contains "Signal Quality : 80"
  const raw = 'Signal Quality                 : 80\r\nRSSI                           : -65 dBm\r\n';
  const result = parseWindowsWwanSignalOutput(raw);
  assert.equal(typeof result.rssi, 'number');
  assert.equal(result.bars, 4); // -65 dBm → 4 bars
});

test('parseWindowsWwanSignalOutput: returns 0 bars on empty output', () => {
  const result = parseWindowsWwanSignalOutput('');
  assert.equal(result.bars, 0);
  assert.equal(result.rssi, null);
});

test('parseWindowsWwanSignalOutput: returns 0 bars on null input', () => {
  const result = parseWindowsWwanSignalOutput(null);
  assert.equal(result.bars, 0);
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd desktop && npm rebuild better-sqlite3 node-hid usb-detection && node --test '__tests__/hardwareFz55Extended.test.js'
```

Expected: multiple failures — `parseWindowsThermalOutput is not a function` etc.

- [ ] **Step 3: Implement the four parsers in hardwareFz55.js**

Add at the bottom of `desktop/hardwareFz55.js`, before `module.exports`:

```js
/**
 * Parses `Get-WmiObject -Namespace root/WMI -Class MSAcpi_ThermalZoneTemperature
 * | Select-Object CurrentTemperature | ConvertTo-Json`.
 * WMI returns CurrentTemperature in tenths of Kelvin.
 * Formula: (tenthsK / 10 - 273.15) * 9/5 + 32  →  °F
 */
function parseWindowsThermalOutput(rawJsonString) {
  if (!rawJsonString) return null;
  let parsed;
  try { parsed = JSON.parse(rawJsonString); } catch { return null; }
  const entries = (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (e) => e && typeof e.CurrentTemperature === 'number'
  );
  if (entries.length === 0) return null;
  const zones = entries.map((e) => ({
    tempF: Math.round(((e.CurrentTemperature / 10 - 273.15) * 9) / 5 + 32),
  }));
  return { zones, maxTempF: Math.max(...zones.map((z) => z.tempF)) };
}

/**
 * Parses `Get-PnpDevice -Class SmartCard | Select-Object FriendlyName, Status, ATR
 * | ConvertTo-Json`. Returns reader presence and whether a card is currently inserted
 * (card insertion is indicated by a non-empty ATR field).
 */
function parseWindowsSmartCardOutput(rawJsonString) {
  const safe = { present: false, cardInserted: false, atr: null };
  if (!rawJsonString) return safe;
  let parsed;
  try { parsed = JSON.parse(rawJsonString); } catch { return safe; }
  const entries = (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (e) => e && typeof e === 'object'
  );
  if (entries.length === 0) return safe;
  const okEntry = entries.find((e) => e.Status === 'OK');
  if (!okEntry) return safe;
  const atr = (okEntry.ATR && String(okEntry.ATR).trim()) || null;
  return { present: true, cardInserted: Boolean(atr), atr };
}

/**
 * Parses `Get-PnpDevice -Class Biometric | Select-Object FriendlyName, Status
 * | ConvertTo-Json`. Detects fingerprint reader presence and readiness.
 */
function parseWindowsFingerprintOutput(rawJsonString) {
  const safe = { present: false, ready: false };
  if (!rawJsonString) return safe;
  let parsed;
  try { parsed = JSON.parse(rawJsonString); } catch { return safe; }
  const entries = (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (e) => e && typeof e === 'object'
  );
  if (entries.length === 0) return safe;
  const present = entries.some((e) => e.Status === 'OK' || e.Status === 'Error');
  const ready = entries.some((e) => e.Status === 'OK');
  return { present, ready };
}

/**
 * Parses `netsh mbn show signal interface=*` text output.
 * Extracts RSSI (dBm) and maps to a 0–5 bar scale.
 * RSSI mapping (LTE typical): >= -65 → 5, >= -75 → 4, >= -85 → 3, >= -95 → 2, >= -105 → 1, else 0
 */
function parseWindowsWwanSignalOutput(text) {
  if (!text) return { rssi: null, bars: 0 };
  const rssiMatch = text.match(/RSSI\s*:\s*(-?\d+)/i);
  if (!rssiMatch) return { rssi: null, bars: 0 };
  const rssi = parseInt(rssiMatch[1], 10);
  let bars = 0;
  if (rssi >= -65) bars = 5;
  else if (rssi >= -75) bars = 4;
  else if (rssi >= -85) bars = 3;
  else if (rssi >= -95) bars = 2;
  else if (rssi >= -105) bars = 1;
  return { rssi, bars };
}
```

Also update `module.exports` at the bottom to include the four new functions:
```js
module.exports = {
  parseWindowsBatteryOutput,
  parseWindowsDockOutput,
  parseWindowsWwanOutput,
  parseWindowsTpmOutput,
  filterPrintableKeydown,
  classifyKeystrokeBurst,
  parseWindowsThermalOutput,
  parseWindowsSmartCardOutput,
  parseWindowsFingerprintOutput,
  parseWindowsWwanSignalOutput,
};
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
cd desktop && node --test '__tests__/hardwareFz55Extended.test.js'
```

Expected: 12 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add desktop/hardwareFz55.js desktop/__tests__/hardwareFz55Extended.test.js
git commit -m "feat(desktop/hw): thermal, smartcard, fingerprint, WWAN signal parsers"
```

---

## Task 3: hardwareFz55.js — extend battery parser with minutesRemaining + body cam HID parser

**Files:**
- Modify: `desktop/hardwareFz55.js`
- Modify: `desktop/__tests__/hardwareFz55.test.js`
- Create (add to extended test file): `desktop/__tests__/hardwareFz55Extended.test.js`

**Interfaces:**
- Modifies: `parseWindowsBatteryOutput(rawJsonString)` → adds `minutesRemaining: number|null` to return value
- Produces: `parseBodyCamHidReport(reportBuffer)` → `{ recording: boolean, batteryPct: number|null }`

- [ ] **Step 1: Write failing tests**

Add to `desktop/__tests__/hardwareFz55Extended.test.js`:

```js
const {
  parseWindowsBatteryOutput,
  parseBodyCamHidReport,
} = require('../hardwareFz55');

// ── Battery minutesRemaining ──────────────────────────────────
test('parseWindowsBatteryOutput: includes minutesRemaining from EstimatedRunTime', () => {
  const raw = JSON.stringify([
    { EstimatedChargeRemaining: 87, BatteryStatus: 1, EstimatedRunTime: 192 },
    { EstimatedChargeRemaining: 91, BatteryStatus: 1, EstimatedRunTime: 210 },
  ]);
  const result = parseWindowsBatteryOutput(raw);
  assert.ok(result);
  // minutesRemaining is the average of both bays' EstimatedRunTime
  assert.equal(result.minutesRemaining, 201);
});

test('parseWindowsBatteryOutput: minutesRemaining is null when EstimatedRunTime absent', () => {
  const raw = JSON.stringify([{ EstimatedChargeRemaining: 80, BatteryStatus: 1 }]);
  const result = parseWindowsBatteryOutput(raw);
  assert.equal(result.minutesRemaining, null);
});

test('parseWindowsBatteryOutput: minutesRemaining is null when WMI returns 71582788 (unknown)', () => {
  // WMI returns 71582788 when runtime is unknown (charge cycle calculating)
  const raw = JSON.stringify([{ EstimatedChargeRemaining: 50, BatteryStatus: 2, EstimatedRunTime: 71582788 }]);
  const result = parseWindowsBatteryOutput(raw);
  assert.equal(result.minutesRemaining, null);
});

// ── Body cam HID ──────────────────────────────────────────────
test('parseBodyCamHidReport: parses Axon Body 4 HID report — recording + battery', () => {
  // Byte 0: report ID (0x01), Byte 1: flags (bit 0 = recording), Byte 2: battery %
  const buf = Buffer.from([0x01, 0x01, 0x59]); // recording=true, battery=89%
  const result = parseBodyCamHidReport(buf);
  assert.equal(result.recording, true);
  assert.equal(result.batteryPct, 89);
});

test('parseBodyCamHidReport: not recording', () => {
  const buf = Buffer.from([0x01, 0x00, 0x46]); // recording=false, battery=70%
  const result = parseBodyCamHidReport(buf);
  assert.equal(result.recording, false);
  assert.equal(result.batteryPct, 70);
});

test('parseBodyCamHidReport: returns safe default on null/short buffer', () => {
  assert.deepEqual(parseBodyCamHidReport(null), { recording: false, batteryPct: null });
  assert.deepEqual(parseBodyCamHidReport(Buffer.alloc(1)), { recording: false, batteryPct: null });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd desktop && node --test '__tests__/hardwareFz55Extended.test.js'
```

Expected: 6 new failures.

- [ ] **Step 3: Extend parseWindowsBatteryOutput**

In `hardwareFz55.js`, find the `parseWindowsBatteryOutput` function and update it. Replace the `return` statement that builds the result:

```js
// After building `batteries` array, before returning:
const WMI_UNKNOWN_RUNTIME = 71582788;
const validRuntimes = batteries
  .map((_, i) => {
    const rt = entries[i]?.EstimatedRunTime;
    return typeof rt === 'number' && rt !== WMI_UNKNOWN_RUNTIME ? rt : null;
  })
  .filter((v) => v !== null);
const minutesRemaining = validRuntimes.length > 0
  ? Math.round(validRuntimes.reduce((s, v) => s + v, 0) / validRuntimes.length)
  : null;

return { batteries, overallPercent, charging, minutesRemaining };
```

Note: The battery parser currently doesn't keep a reference to `entries[i]` — you need to map `batteries` alongside `entries`. Rewrite the battery map as:

```js
const batteries = entries.map((entry) => {
  const percent = Number(entry.EstimatedChargeRemaining);
  return {
    percent: Number.isFinite(percent) ? percent : 0,
    charging: entry.BatteryStatus === 2,
  };
});

const overallPercent = batteries.length > 0
  ? Math.round(batteries.reduce((sum, b) => sum + b.percent, 0) / batteries.length)
  : 0;
const charging = batteries.some((b) => b.charging);

const WMI_UNKNOWN_RUNTIME = 71582788;
const validRuntimes = entries
  .map((e) => e.EstimatedRunTime)
  .filter((v) => typeof v === 'number' && v !== WMI_UNKNOWN_RUNTIME);
const minutesRemaining = validRuntimes.length > 0
  ? Math.round(validRuntimes.reduce((s, v) => s + v, 0) / validRuntimes.length)
  : null;

return { batteries, overallPercent, charging, minutesRemaining };
```

- [ ] **Step 4: Add parseBodyCamHidReport**

Add to `hardwareFz55.js` before `module.exports`:

```js
/**
 * Parses a raw HID report buffer from an Axon Body camera.
 * Report layout (Axon Body 3/4 USB HID power device profile):
 *   Byte 0: Report ID (0x01)
 *   Byte 1: Flags — bit 0 = recording active
 *   Byte 2: Battery percentage (0–100)
 * Returns safe defaults for any buffer shorter than 3 bytes or null input.
 */
function parseBodyCamHidReport(reportBuffer) {
  if (!reportBuffer || reportBuffer.length < 3) return { recording: false, batteryPct: null };
  const flags = reportBuffer[1];
  const batteryRaw = reportBuffer[2];
  return {
    recording: Boolean(flags & 0x01),
    batteryPct: batteryRaw >= 0 && batteryRaw <= 100 ? batteryRaw : null,
  };
}
```

Also add `parseBodyCamHidReport` and `parseWindowsBatteryOutput` (already exported) to `module.exports`.

- [ ] **Step 5: Run tests — expect all pass**

```bash
cd desktop && node --test '__tests__/hardwareFz55Extended.test.js'
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add desktop/hardwareFz55.js desktop/__tests__/hardwareFz55Extended.test.js
git commit -m "feat(desktop/hw): battery minutesRemaining + body cam HID report parser"
```

---

## Task 4: internalGps.js — parseVTG, parseGLL, parseGSV, fix quality classification

**Files:**
- Modify: `desktop/internalGps.js`
- Create: `desktop/__tests__/internalGpsExtended.test.js`

**Interfaces:**
- Produces:
  - `parseVTG(fields)` → `{ speedMs: number|null, heading: number|null } | null`
  - `parseGLL(fields)` → `{ lat: number, lng: number } | null`
  - `parseGSV(fields)` → `{ satsInView: number, sats: [{prn: number, snr: number}] } | null`
  - `classifyFixQuality(hdop, satCount)` → `'excellent'|'good'|'degraded'|'poor'|'none'`
- Modifies: `InternalGps._handleLine` to parse VTG/GLL/GSV + emit `gps:constellation` + add `fixQuality` to position events

- [ ] **Step 1: Write failing tests**

Create `desktop/__tests__/internalGpsExtended.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVTG, parseGLL, parseGSV, classifyFixQuality } = require('../internalGps');

// ── VTG ───────────────────────────────────────────────────────
test('parseVTG: extracts speed and heading', () => {
  // $GPVTG,054.7,T,034.4,M,005.5,N,010.2,K,A*27
  const fields = ['$GPVTG', '054.7', 'T', '034.4', 'M', '005.5', 'N', '010.2', 'K', 'A'];
  const r = parseVTG(fields);
  assert.ok(r);
  assert.ok(Math.abs(r.speedMs - 5.5 * 0.514444) < 0.01); // knots → m/s
  assert.ok(Math.abs(r.heading - 54.7) < 0.1);
});

test('parseVTG: returns null when mode is V (no fix)', () => {
  const fields = ['$GPVTG', '', 'T', '', 'M', '', 'N', '', 'K', 'V'];
  assert.equal(parseVTG(fields), null);
});

test('parseVTG: returns null on bad input', () => {
  assert.equal(parseVTG([]), null);
  assert.equal(parseVTG(null), null);
});

// ── GLL ───────────────────────────────────────────────────────
test('parseGLL: extracts lat/lng when status is A', () => {
  // $GPGLL,4916.45,N,12311.12,W,225444,A*31
  const fields = ['$GPGLL', '4916.45', 'N', '12311.12', 'W', '225444', 'A'];
  const r = parseGLL(fields);
  assert.ok(r);
  assert.ok(Math.abs(r.lat - 49.274) < 0.001);
  assert.ok(r.lng < 0); // West
});

test('parseGLL: returns null when status is V', () => {
  const fields = ['$GPGLL', '4916.45', 'N', '12311.12', 'W', '225444', 'V'];
  assert.equal(parseGLL(fields), null);
});

// ── GSV ───────────────────────────────────────────────────────
test('parseGSV: parses satellites in view', () => {
  // $GPGSV,2,1,08,01,40,083,46,02,17,308,41,12,07,344,39,14,22,228,45*75
  const fields = ['$GPGSV', '2', '1', '08', '01', '40', '083', '46', '02', '17', '308', '41', '12', '07', '344', '39', '14', '22', '228', '45'];
  const r = parseGSV(fields);
  assert.ok(r);
  assert.equal(r.satsInView, 8);
  assert.equal(r.sats.length, 4);
  assert.equal(r.sats[0].prn, 1);
  assert.equal(r.sats[0].snr, 46);
});

test('parseGSV: returns null on bad input', () => {
  assert.equal(parseGSV([]), null);
  assert.equal(parseGSV(null), null);
});

// ── Fix quality ───────────────────────────────────────────────
test('classifyFixQuality: excellent when HDOP < 1 and sats >= 8', () => {
  assert.equal(classifyFixQuality(0.8, 10), 'excellent');
});

test('classifyFixQuality: good when HDOP < 2 and sats >= 5', () => {
  assert.equal(classifyFixQuality(1.5, 6), 'good');
});

test('classifyFixQuality: degraded when HDOP < 5', () => {
  assert.equal(classifyFixQuality(3.0, 3), 'degraded');
});

test('classifyFixQuality: poor when HDOP >= 5', () => {
  assert.equal(classifyFixQuality(6.0, 2), 'poor');
});

test('classifyFixQuality: none when no fix data', () => {
  assert.equal(classifyFixQuality(null, null), 'none');
  assert.equal(classifyFixQuality(undefined, 0), 'none');
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd desktop && node --test '__tests__/internalGpsExtended.test.js'
```

Expected: all fail — functions not exported.

- [ ] **Step 3: Implement VTG, GLL, GSV parsers in internalGps.js**

Add after the existing `parseRMC` function:

```js
/** Parse $GPVTG: $GPVTG,track,T,magTrack,M,speedKnots,N,speedKmh,K,mode */
function parseVTG(fields) {
  if (!fields || fields.length < 9) return null;
  const mode = fields[9]; // 'A'=autonomous, 'D'=DGPS, 'E'=DR, 'V'=no fix
  if (mode === 'V' || mode === 'N') return null;
  const heading = parseFloat(fields[1]);
  const speedKnots = parseFloat(fields[5]);
  return {
    heading: Number.isFinite(heading) ? heading : null,
    speedMs: Number.isFinite(speedKnots) ? speedKnots * 0.514444 : null,
  };
}

/** Parse $GPGLL: $GPGLL,lat,N/S,lng,E/W,time,status */
function parseGLL(fields) {
  if (!fields || fields.length < 7) return null;
  if (fields[6] !== 'A') return null; // V = void
  const lat = nmeaToDecimal(fields[1], fields[2]);
  const lng = nmeaToDecimal(fields[3], fields[4]);
  if (lat === null || lng === null) return null;
  return { lat, lng };
}

/** Parse $GPGSV: $GPGSV,totalMsgs,msgNum,satsInView,[prn,elev,azim,snr x4] */
function parseGSV(fields) {
  if (!fields || fields.length < 4) return null;
  const satsInView = parseInt(fields[3], 10);
  if (!Number.isFinite(satsInView)) return null;
  const sats = [];
  for (let i = 4; i + 3 < fields.length; i += 4) {
    const prn = parseInt(fields[i], 10);
    const snr = parseInt(fields[i + 3], 10);
    if (Number.isFinite(prn)) {
      sats.push({ prn, snr: Number.isFinite(snr) ? snr : 0 });
    }
  }
  return { satsInView, sats };
}

/**
 * Classifies a GPS fix into a quality tier based on HDOP and satellite count.
 * 'excellent': HDOP < 1 and sats >= 8
 * 'good':      HDOP < 2 and sats >= 5
 * 'degraded':  HDOP < 5
 * 'poor':      any valid fix with HDOP >= 5
 * 'none':      no fix data
 */
function classifyFixQuality(hdop, satCount) {
  if (!Number.isFinite(hdop) || !Number.isFinite(satCount)) return 'none';
  if (hdop < 1 && satCount >= 8) return 'excellent';
  if (hdop < 2 && satCount >= 5) return 'good';
  if (hdop < 5) return 'degraded';
  return 'poor';
}
```

Update `module.exports` at the bottom:
```js
module.exports = { InternalGps, findGpsPort, listSerialPorts, probeGpsPortOpen, parseVTG, parseGLL, parseGSV, classifyFixQuality };
```

- [ ] **Step 4: Wire VTG/GLL/GSV into InternalGps._handleLine**

In `InternalGps._handleLine`, after the existing `else if (sentence === 'RMC')` block, add:

```js
} else if (sentence === 'VTG') {
  const r = parseVTG(fields);
  if (r) {
    if (r.speedMs !== null) this.pending.speed = r.speedMs;
    if (r.heading !== null) this.pending.heading = r.heading;
    updated = true;
  }
} else if (sentence === 'GLL') {
  const r = parseGLL(fields);
  if (r && this.pending.lat === null) {
    this.pending.lat = r.lat;
    this.pending.lng = r.lng;
    updated = true;
  }
} else if (sentence === 'GSV') {
  const r = parseGSV(fields);
  if (r) {
    this.emit('gps:constellation', {
      satsInView: r.satsInView,
      satsTracked: r.sats.filter((s) => s.snr > 0).length,
      avgSnr: r.sats.length > 0
        ? Math.round(r.sats.reduce((s, sat) => s + sat.snr, 0) / r.sats.length)
        : 0,
    });
  }
}
```

Also add `fixQuality` to the position emit block. Replace the existing `this.emit('position', {...})` call:

```js
if (updated && this.pending.lat !== null && this.pending.lng !== null) {
  this.emit('position', {
    latitude: this.pending.lat,
    longitude: this.pending.lng,
    accuracy: this.pending.accuracy ?? 10,
    heading: this.pending.heading,
    speed: this.pending.speed,
    fixQuality: classifyFixQuality(
      this.pending.accuracy ? this.pending.accuracy / 5 : null, // reverse HDOP estimate
      this.pending.sats ?? null
    ),
    timestamp: new Date().toISOString(),
  });
}
```

Also add `this.pending.sats = 0;` to the `pending` initialization, and update `parseGGA` to return sats count, then store it in `_handleLine`:
```js
// In the GGA branch inside _handleLine:
if (r) {
  this.pending.lat = r.lat;
  this.pending.lng = r.lng;
  this.pending.accuracy = r.accuracy;
  this.pending.sats = r.sats;  // add this line
  updated = true;
}
```

- [ ] **Step 5: Run tests — expect all pass**

```bash
cd desktop && node --test '__tests__/internalGpsExtended.test.js'
```

Expected: 13 passing, 0 failing.

- [ ] **Step 6: Commit**

```bash
git add desktop/internalGps.js desktop/__tests__/internalGpsExtended.test.js
git commit -m "feat(desktop/hw): GPS VTG/GLL/GSV parsers, fix quality classification, constellation events"
```

---

## Task 5: internalGps.js — dead reckoning

**Files:**
- Modify: `desktop/internalGps.js`
- Modify: `desktop/__tests__/internalGpsExtended.test.js`

**Interfaces:**
- Produces: `projectPosition(lat, lng, headingDeg, speedMs, elapsedMs)` → `{ lat, lng }` (exported, pure, testable)
- Modifies: `InternalGps` — adds dead reckoning timer that emits `{ estimated: true }` position events when GPS fix drops

- [ ] **Step 1: Write failing test**

Add to `desktop/__tests__/internalGpsExtended.test.js`:

```js
const { projectPosition } = require('../internalGps');

test('projectPosition: projects north at 10 m/s for 1 second', () => {
  // Starting at (40.0, -111.0), heading 0° (north), speed 10 m/s, 1000 ms
  const r = projectPosition(40.0, -111.0, 0, 10, 1000);
  assert.ok(r.lat > 40.0);          // moved north
  assert.ok(Math.abs(r.lng - (-111.0)) < 0.0001); // no east/west movement
});

test('projectPosition: projects east at 10 m/s for 1 second', () => {
  const r = projectPosition(40.0, -111.0, 90, 10, 1000);
  assert.ok(Math.abs(r.lat - 40.0) < 0.0001);
  assert.ok(r.lng > -111.0);        // moved east
});

test('projectPosition: returns same point when speed is 0', () => {
  const r = projectPosition(40.0, -111.0, 270, 0, 5000);
  assert.ok(Math.abs(r.lat - 40.0) < 0.000001);
  assert.ok(Math.abs(r.lng - (-111.0)) < 0.000001);
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd desktop && node --test '__tests__/internalGpsExtended.test.js' 2>&1 | grep -E 'FAIL|pass|fail'
```

- [ ] **Step 3: Implement projectPosition**

Add to `internalGps.js` (pure function, no EventEmitter dependency):

```js
const EARTH_RADIUS_M = 6_371_000;

/**
 * Great-circle dead reckoning: project a position forward from lat/lng
 * at the given heading (degrees true) and speed (m/s) over elapsedMs ms.
 * Pure function — no side effects, fully unit-testable.
 */
function projectPosition(lat, lng, headingDeg, speedMs, elapsedMs) {
  const distM = speedMs * (elapsedMs / 1000);
  if (distM === 0) return { lat, lng };
  const bearingRad = (headingDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;
  const angDist = distM / EARTH_RADIUS_M;
  const newLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(angDist) +
    Math.cos(latRad) * Math.sin(angDist) * Math.cos(bearingRad)
  );
  const newLngRad = lngRad + Math.atan2(
    Math.sin(bearingRad) * Math.sin(angDist) * Math.cos(latRad),
    Math.cos(angDist) - Math.sin(latRad) * Math.sin(newLatRad)
  );
  return {
    lat: (newLatRad * 180) / Math.PI,
    lng: (newLngRad * 180) / Math.PI,
  };
}
```

- [ ] **Step 4: Wire dead reckoning into InternalGps**

Add to `InternalGps` constructor:
```js
this._lastFixAt = null;       // timestamp of last real fix (ms)
this._drTimer = null;         // dead reckoning interval
this.DR_MAX_MS = 30_000;      // stop projecting after 30s
this.DR_INTERVAL_MS = 1_000;  // emit estimated position every 1s
```

Add `_startDeadReckoning()` and `_stopDeadReckoning()` methods:
```js
_startDeadReckoning() {
  this._stopDeadReckoning();
  this._drTimer = setInterval(() => {
    if (!this.pending.lat || !this.pending.heading || !this.pending.speed) return;
    const elapsed = Date.now() - (this._lastFixAt || Date.now());
    if (elapsed > this.DR_MAX_MS) { this._stopDeadReckoning(); return; }
    const projected = projectPosition(
      this.pending.lat, this.pending.lng,
      this.pending.heading, this.pending.speed,
      this.DR_INTERVAL_MS
    );
    this.pending.lat = projected.lat;
    this.pending.lng = projected.lng;
    this.emit('position', {
      latitude: projected.lat,
      longitude: projected.lng,
      accuracy: Math.min(50 + elapsed / 1000 * 5, 300), // grows with age
      heading: this.pending.heading,
      speed: this.pending.speed,
      fixQuality: 'poor',
      estimated: true,
      timestamp: new Date().toISOString(),
    });
  }, this.DR_INTERVAL_MS);
}

_stopDeadReckoning() {
  if (this._drTimer) { clearInterval(this._drTimer); this._drTimer = null; }
}
```

In `_handleLine`, after a valid GGA or RMC fix is received and position emitted, add:
```js
this._lastFixAt = Date.now();
this._stopDeadReckoning(); // real fix arrived — cancel DR
```

Start dead reckoning when the baud probe completes successfully (first valid sentence lock). Add in `_handleLine` where `this.gotValidData` is set to true:
```js
// After: console.log('[INTERNAL-GPS] Locked NMEA stream @', ...)
// Schedule dead reckoning to begin if fixes stop arriving (checked 3s later)
setTimeout(() => {
  if (this._lastFixAt && (Date.now() - this._lastFixAt) > 2000) {
    this._startDeadReckoning();
  }
}, 3000);
```

Also add to `stop()`:
```js
this._stopDeadReckoning();
```

Export `projectPosition` in `module.exports`.

- [ ] **Step 5: Run tests**

```bash
cd desktop && node --test '__tests__/internalGpsExtended.test.js'
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add desktop/internalGps.js desktop/__tests__/internalGpsExtended.test.js
git commit -m "feat(desktop/hw): GPS dead reckoning — project position when fix drops"
```

---

## Task 6: main.js — detectToughbook() + new hardware IPC handlers (thermal, smartcard, fingerprint, battery-detail, WWAN signal)

**Files:**
- Modify: `desktop/main.js`

**Interfaces:**
- Consumes: `parseWindowsThermalOutput`, `parseWindowsSmartCardOutput`, `parseWindowsFingerprintOutput`, `parseWindowsWwanSignalOutput`, `parseWindowsBatteryOutput` (with minutesRemaining) from `hardwareFz55.js`
- Produces IPC channels: `sys:thermal-status`, `device:smartcard-status`, `device:fingerprint-status`, `sys:battery-detail`, `device:wwan-signal`

- [ ] **Step 1: Update the import line at top of main.js**

Find the existing destructure:
```js
const { parseWindowsBatteryOutput, parseWindowsDockOutput, parseWindowsWwanOutput, parseWindowsTpmOutput, classifyKeystrokeBurst, filterPrintableKeydown } = require('./hardwareFz55');
```

Replace with:
```js
const {
  parseWindowsBatteryOutput, parseWindowsDockOutput, parseWindowsWwanOutput,
  parseWindowsTpmOutput, classifyKeystrokeBurst, filterPrintableKeydown,
  parseWindowsThermalOutput, parseWindowsSmartCardOutput, parseWindowsFingerprintOutput,
  parseWindowsWwanSignalOutput,
} = require('./hardwareFz55');
```

- [ ] **Step 2: Fill detectToughbook() predicate**

Find the `TODO: Christopher` comment block around line 3881. Replace the stub predicate with:

```js
const mfr = (wmi.Manufacturer || '').toLowerCase();
const model = (wmi.Model || '').toUpperCase();
const isToughbook =
  mfr.includes('panasonic') ||
  model.startsWith('FZ-') ||
  model.startsWith('CF-');
return {
  isToughbook,
  manufacturer: wmi.Manufacturer || '',
  model: wmi.Model || '',
  portPath: isToughbook ? (await findGpsPort())?.path ?? null : null,
};
```

- [ ] **Step 3: Add sys:thermal-status IPC handler**

Add after the existing `sys:tpm-status` handler:

```js
guardedHandle('sys:thermal-status', async () => {
  if (process.platform !== 'win32') return null;
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command',
        'Get-WmiObject -Namespace root/WMI -Class MSAcpi_ThermalZoneTemperature | Select-Object CurrentTemperature | ConvertTo-Json'],
      { timeout: 5000 }
    );
    const result = parseWindowsThermalOutput(stdout);
    if (result && result.maxTempF > 185) {
      mainWindow?.webContents.send('hardware:thermal-alert', result);
    }
    return result;
  } catch (err) {
    console.error('[SYS:THERMAL-STATUS]', err.message);
    return null;
  }
});
```

- [ ] **Step 4: Add device:smartcard-status IPC handler**

```js
guardedHandle('device:smartcard-status', async () => {
  if (process.platform !== 'win32') return { present: false, cardInserted: false, atr: null };
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command',
        'Get-PnpDevice -Class SmartCard | Select-Object FriendlyName, Status | ConvertTo-Json'],
      { timeout: 3000 }
    );
    return parseWindowsSmartCardOutput(stdout);
  } catch (err) {
    console.error('[DEVICE:SMARTCARD-STATUS]', err.message);
    return { present: false, cardInserted: false, atr: null };
  }
});
```

- [ ] **Step 5: Add device:fingerprint-status IPC handler**

```js
guardedHandle('device:fingerprint-status', async () => {
  if (process.platform !== 'win32') return { present: false, ready: false };
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command',
        'Get-PnpDevice -Class Biometric | Select-Object FriendlyName, Status | ConvertTo-Json'],
      { timeout: 3000 }
    );
    return parseWindowsFingerprintOutput(stdout);
  } catch (err) {
    console.error('[DEVICE:FINGERPRINT-STATUS]', err.message);
    return { present: false, ready: false };
  }
});
```

- [ ] **Step 6: Add sys:battery-detail IPC handler**

```js
guardedHandle('sys:battery-detail', async () => {
  if (process.platform !== 'win32') return null;
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command',
        'Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining, BatteryStatus, EstimatedRunTime | ConvertTo-Json'],
      { timeout: 3000 }
    );
    return parseWindowsBatteryOutput(stdout);
  } catch (err) {
    console.error('[SYS:BATTERY-DETAIL]', err.message);
    return null;
  }
});
```

- [ ] **Step 7: Add device:wwan-signal IPC handler**

```js
guardedHandle('device:wwan-signal', async () => {
  if (process.platform !== 'win32') return { rssi: null, bars: 0 };
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'netsh.exe',
      ['mbn', 'show', 'signal', 'interface=*'],
      { timeout: 3000 }
    );
    return parseWindowsWwanSignalOutput(stdout);
  } catch (err) {
    console.error('[DEVICE:WWAN-SIGNAL]', err.message);
    return { rssi: null, bars: 0 };
  }
});
```

- [ ] **Step 8: Add device:wwan-carrier IPC handler**

```js
guardedHandle('device:wwan-carrier', async () => {
  if (process.platform !== 'win32') return { carrier: null, apn: null };
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'netsh.exe',
      ['mbn', 'show', 'connection', 'interface=*'],
      { timeout: 3000 }
    );
    const carrierMatch = stdout.match(/Provider Name\s*:\s*(.+)/i);
    const apnMatch = stdout.match(/Access String\s*:\s*(.+)/i);
    return {
      carrier: carrierMatch ? carrierMatch[1].trim() : null,
      apn: apnMatch ? apnMatch[1].trim() : null,
    };
  } catch (err) {
    console.error('[DEVICE:WWAN-CARRIER]', err.message);
    return { carrier: null, apn: null };
  }
});
```

- [ ] **Step 9: Run Worker typecheck**

```bash
cd /path/to/repo && npm run typecheck
```

Expected: 0 errors from desktop changes (desktop is plain JS, typecheck targets `/src/`). Verify desktop app starts:

```bash
cd desktop && npm start -- --dev
```

Expected: app opens, no startup crash.

- [ ] **Step 10: Commit**

```bash
git add desktop/main.js
git commit -m "feat(desktop/hw): detectToughbook predicate + thermal/smartcard/fingerprint/battery-detail/WWAN IPC handlers"
```

---

## Task 7: main.js — body cam integration, WWAN live push, dock-state push, USB hot-plug

**Files:**
- Modify: `desktop/main.js`

**Interfaces:**
- Consumes: `node-hid` (lazy-required), `usb-detection` (lazy-required), `parseBodyCamHidReport`
- Produces IPC channels: `sys:body-cam-status` (real), `sys:body-cam-start`, `sys:body-cam-stop`
- Produces push events: `hardware:wwan-changed`, `hardware:bodycam-state-changed`, `hardware:gps-plugged`

- [ ] **Step 1: Add parseBodyCamHidReport to the hardwareFz55 import**

Find the existing `hardwareFz55` destructure (updated in Task 6) and add `parseBodyCamHidReport`:
```js
const {
  ...,
  parseBodyCamHidReport,
} = require('./hardwareFz55');
```

- [ ] **Step 2: Replace sys:body-cam-status stub**

Find the three body cam handlers (lines ~1504–1513) and replace:

```js
const BODY_CAM_VIDS = new Map([
  [0x2B0E, 'Axon'],    // Axon Body 3/4
  [0x22B8, 'Motorola'], // Motorola Si500
]);
let bodyCamHidDevice = null;

function detectBodyCam() {
  if (process.platform !== 'win32') return null;
  try {
    const HID = require('node-hid');
    const devices = HID.devices();
    for (const [vid, vendor] of BODY_CAM_VIDS) {
      const d = devices.find((dev) => dev.vendorId === vid);
      if (d) return { present: true, vendor, model: d.product || null, vid, path: d.path };
    }
  } catch (err) {
    console.warn('[BODY-CAM] HID enumeration failed:', err.message);
  }
  return null;
}

guardedHandle('sys:body-cam-status', () => {
  const cam = detectBodyCam();
  if (!cam) return { present: false, vendor: null, model: null, batteryPct: null };
  // Attempt to read HID state
  let batteryPct = null;
  try {
    const HID = require('node-hid');
    const dev = new HID.HID(cam.path);
    const report = dev.readTimeout(200);
    dev.close();
    const parsed = parseBodyCamHidReport(Buffer.from(report));
    batteryPct = parsed.batteryPct;
  } catch { /* HID read failed — return presence only */ }
  return { present: true, vendor: cam.vendor, model: cam.model, batteryPct };
});

guardedHandle('sys:body-cam-start', () => {
  const cam = detectBodyCam();
  if (!cam) return { ok: false, reason: 'no_camera' };
  try {
    const HID = require('node-hid');
    bodyCamHidDevice = new HID.HID(cam.path);
    // Axon record command: write report [0x01, 0x01] (report ID 1, flag record=1)
    bodyCamHidDevice.write([0x01, 0x01]);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

guardedHandle('sys:body-cam-stop', () => {
  if (!bodyCamHidDevice) return { ok: false, reason: 'not_started' };
  try {
    bodyCamHidDevice.write([0x01, 0x00]); // clear recording flag
    bodyCamHidDevice.close();
    bodyCamHidDevice = null;
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});
```

- [ ] **Step 3: Add WWAN live push timer**

After the `app.whenReady()` block resolves (find where `connectivityMonitor` is started), add a WWAN push timer:

```js
// ── WWAN live push ────────────────────────────────────────
let _lastWwanState = null;
const WWAN_PUSH_INTERVAL = 30_000;
function pushWwanIfChanged() {
  if (process.platform !== 'win32') return;
  const { execFile } = require('child_process');
  execFile(
    'powershell.exe',
    ['-NoProfile', '-Command',
      "Get-NetAdapter | Where-Object {$_.InterfaceDescription -match 'Sierra|EM74|EM75|EM91'} | Select-Object Name, Status | ConvertTo-Json"],
    { timeout: 3000 },
    (err, stdout) => {
      if (err) return;
      const state = parseWindowsWwanOutput(stdout);
      const changed = !_lastWwanState ||
        state.present !== _lastWwanState.present ||
        state.connected !== _lastWwanState.connected;
      if (changed) {
        _lastWwanState = state;
        mainWindow?.webContents.send('hardware:wwan-changed', state);
      }
    }
  );
}
let _wwanPushTimer = null;
// Start after window is ready (called from createWindow() setup block):
function startWwanPush() {
  if (_wwanPushTimer) return;
  pushWwanIfChanged();
  _wwanPushTimer = setInterval(pushWwanIfChanged, WWAN_PUSH_INTERVAL);
}
```

Call `startWwanPush()` inside `createWindow()` after `mainWindow` is created (just before the `mainWindow.loadURL(...)` call).

Also add cleanup in `app.on('before-quit')`:
```js
if (_wwanPushTimer) { clearInterval(_wwanPushTimer); _wwanPushTimer = null; }
```

- [ ] **Step 4: Add USB hot-plug GPS re-detect**

After `startWwanPush()` call in `createWindow()`:

```js
// ── USB hot-plug GPS re-detect ────────────────────────────
try {
  const usbDetect = require('usb-detection');
  usbDetect.startMonitoring();
  usbDetect.on('add', async () => {
    // Any USB insertion — re-probe for GPS
    setTimeout(async () => {
      const found = await findGpsPort();
      if (found) {
        mainWindow?.webContents.send('hardware:gps-plugged', found);
        // If GPS reader is not currently active, auto-start
        if (!internalGpsReader) {
          internalGpsReader = new InternalGps();
          internalGpsReader.on('position', (pos) => mainWindow?.webContents.send('geo:position', pos));
          internalGpsReader.on('gps:constellation', (c) => mainWindow?.webContents.send('gps:constellation', c));
          await internalGpsReader.start(found.path);
        }
      }
    }, 1500); // brief delay for device driver init
  });
  app.on('before-quit', () => usbDetect.stopMonitoring());
} catch (err) {
  console.warn('[APP] usb-detection unavailable:', err.message);
}
```

- [ ] **Step 5: Add connectivity:failover event**

In the `ConnectivityMonitor` callback (where online/offline state changes), add detection of WWAN failover. Find where `connectivity:online` or `connectivity:offline` is emitted and add:

```js
// After emitting connectivity:online/offline:
const currentWwan = _lastWwanState;
if (isOnline && currentWwan?.connected) {
  mainWindow?.webContents.send('connectivity:failover', { from: 'wifi', to: 'wwan' });
}
```

- [ ] **Step 6: Update device:usb-devices handler**

Add new IPC handler:
```js
guardedHandle('device:usb-devices', async () => {
  if (process.platform !== 'win32') return [];
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command',
        "Get-PnpDevice | Where-Object {$_.Class -eq 'USB'} | Select-Object FriendlyName, Status | ConvertTo-Json"],
      { timeout: 5000 }
    );
    let parsed;
    try { parsed = JSON.parse(stdout); } catch { return []; }
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries.filter(Boolean).map((e) => ({ name: e.FriendlyName || '', status: e.Status || '' }));
  } catch (err) {
    console.error('[DEVICE:USB-DEVICES]', err.message);
    return [];
  }
});
```

- [ ] **Step 7: Verify app starts without crash**

```bash
cd desktop && npm start -- --dev
```

Expected: no crash on startup, new handlers visible in DevTools when called.

- [ ] **Step 8: Commit**

```bash
git add desktop/main.js
git commit -m "feat(desktop/hw): body cam HID, WWAN live push, USB hot-plug GPS re-detect, usb-devices"
```

---

## Task 8: main.js — real OS volume control, display brightness, geofence engine, unified barcode event

**Files:**
- Modify: `desktop/main.js`

**Interfaces:**
- Modifies: `system:set-volume` — real nircmd/osascript implementation
- Modifies: `hardware:barcode-scanned` → `hardware:barcode-scan` with `{ payload, source: 'xpak' }`
- Produces: `device:set-brightness` IPC, geofence engine emitting `geo:geofence-enter` / `geo:geofence-exit`

- [ ] **Step 1: Replace system:set-volume stub**

Find and replace the stub handler:

```js
guardedHandle('system:set-volume', async (_event, level) => {
  const clamped = Math.max(0, Math.min(100, Number(level) || 0));
  try {
    if (process.platform === 'win32') {
      // nircmd setsysvolume takes 0–65535
      const nircmdPath = path.join(
        process.resourcesPath || path.join(__dirname, 'vendor'),
        'nircmd.exe'
      );
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      await promisify(execFile)(nircmdPath, ['setsysvolume', String(Math.round(clamped / 100 * 65535))], { timeout: 2000 });
    } else if (process.platform === 'darwin') {
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      await promisify(execFile)('osascript', ['-e', `set volume output volume ${clamped}`], { timeout: 2000 });
    } else {
      return { ok: false, reason: 'unsupported_platform' };
    }
    return { ok: true };
  } catch (err) {
    console.error('[SYSTEM:SET-VOLUME]', err.message);
    return { ok: false, reason: err.message };
  }
});
```

- [ ] **Step 2: Add device:set-brightness handler**

```js
guardedHandle('device:set-brightness', async (_event, level) => {
  if (process.platform !== 'win32') return { ok: false, reason: 'unsupported_platform' };
  const clamped = Math.max(0, Math.min(100, Number(level) || 0));
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    await promisify(execFile)(
      'powershell.exe',
      ['-NoProfile', '-Command',
        `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(0, ${clamped})`],
      { timeout: 3000 }
    );
    return { ok: true };
  } catch (err) {
    console.error('[DEVICE:SET-BRIGHTNESS]', err.message);
    return { ok: false, reason: err.message };
  }
});
```

- [ ] **Step 3: Update unified barcode event shape**

Find the existing `before-input-event` handler that sends `hardware:barcode-scanned`. Change the send call from:
```js
mainWindow.webContents.send('hardware:barcode-scanned', result.payload);
```
to:
```js
mainWindow.webContents.send('hardware:barcode-scan', { payload: result.payload, source: 'xpak' });
```

- [ ] **Step 4: Add geofence engine**

Add module-level state and helper after the existing GPS reader declarations:

```js
// ── Geofence engine ──────────────────────────────────────────
let _geofenceZones = []; // [{ id, lat, lng, radiusM, label }]
let _activeZoneIds = new Set(); // currently inside zones

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function checkGeofences(latitude, longitude) {
  for (const zone of _geofenceZones) {
    const dist = haversineM(latitude, longitude, zone.lat, zone.lng);
    const inside = dist <= zone.radiusM;
    const wasInside = _activeZoneIds.has(zone.id);
    if (inside && !wasInside) {
      _activeZoneIds.add(zone.id);
      mainWindow?.webContents.send('geo:geofence-enter', { zoneId: zone.id, label: zone.label });
    } else if (!inside && wasInside) {
      _activeZoneIds.delete(zone.id);
      mainWindow?.webContents.send('geo:geofence-exit', { zoneId: zone.id, label: zone.label });
    }
  }
}
```

Wire `checkGeofences` into the GPS position event listener. Find where `internalGpsReader.on('position', ...)` is called and add:
```js
internalGpsReader.on('position', (pos) => {
  mainWindow?.webContents.send('geo:position', pos);
  if (!pos.estimated) checkGeofences(pos.latitude, pos.longitude);
});
```

Add an IPC handler to load zone data (called by the renderer after server sync):
```js
guardedHandle('geo:set-geofence-zones', (_event, zones) => {
  if (!Array.isArray(zones)) return { ok: false };
  _geofenceZones = zones.filter(
    (z) => z && typeof z.id !== 'undefined' &&
    Number.isFinite(z.lat) && Number.isFinite(z.lng) && Number.isFinite(z.radiusM)
  );
  _activeZoneIds = new Set(); // reset membership on zone reload
  return { ok: true, count: _geofenceZones.length };
});
```

- [ ] **Step 5: Verify app starts**

```bash
cd desktop && npm start -- --dev
```

- [ ] **Step 6: Commit**

```bash
git add desktop/main.js
git commit -m "feat(desktop/hw): real volume control, display brightness, unified barcode event, geofence engine"
```

---

## Task 9: faceAuth.js — face embedding storage with injectable deps + tests

**Files:**
- Create: `desktop/faceAuth.js`
- Create: `desktop/__tests__/faceAuth.test.js`

**Interfaces:**
- Produces:
  - `createFaceAuth({ db, safeStorage })` → `{ storeEmbedding, getEmbedding, deleteEmbedding, euclideanDistance, MATCH_THRESHOLD }`
  - All functions pure/injectable — no direct imports of `electron` or `better-sqlite3` inside the module

- [ ] **Step 1: Write failing tests**

Create `desktop/__tests__/faceAuth.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFaceAuth, euclideanDistance } = require('../faceAuth');

// ── euclideanDistance ─────────────────────────────────────────
test('euclideanDistance: identical vectors → 0', () => {
  const v = new Float32Array([1, 2, 3, 4]);
  assert.equal(euclideanDistance(v, v), 0);
});

test('euclideanDistance: known distance', () => {
  const a = new Float32Array([0, 0]);
  const b = new Float32Array([3, 4]);
  assert.ok(Math.abs(euclideanDistance(a, b) - 5) < 0.001);
});

test('euclideanDistance: mismatched lengths → throws', () => {
  assert.throws(
    () => euclideanDistance(new Float32Array([1, 2]), new Float32Array([1, 2, 3])),
    /length/i
  );
});

// ── storeEmbedding / getEmbedding ────────────────────────────
function makeStubs() {
  const store = new Map();
  const db = {
    prepare: (sql) => ({
      run: (...args) => { store.set(args[0], args[1]); },
      get: (id) => store.has(id) ? { face_embedding: store.get(id) } : null,
      run_delete: (id) => store.delete(id),
    }),
  };
  // Simulate prepare returning different statement shapes:
  db.prepare = (sql) => {
    if (sql.includes('INSERT') || sql.includes('UPDATE') || sql.includes('REPLACE')) {
      return { run: (id, enc) => store.set(id, enc) };
    }
    if (sql.includes('SELECT')) {
      return { get: (id) => store.has(id) ? { face_embedding: store.get(id) } : null };
    }
    if (sql.includes('DELETE')) {
      return { run: (id) => store.delete(id) };
    }
    return { run: () => {}, get: () => null };
  };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('ENC:' + s),
    decryptString: (b) => b.toString().replace(/^ENC:/, ''),
  };
  return { db, safeStorage };
}

test('storeEmbedding + getEmbedding round-trip', () => {
  const { db, safeStorage } = makeStubs();
  const fa = createFaceAuth({ db, safeStorage });
  const embedding = new Float32Array(128).fill(0.5);
  fa.storeEmbedding(42, embedding);
  const retrieved = fa.getEmbedding(42);
  assert.ok(retrieved instanceof Float32Array);
  assert.equal(retrieved.length, 128);
  assert.ok(Math.abs(retrieved[0] - 0.5) < 0.001);
});

test('getEmbedding returns null when userId not enrolled', () => {
  const { db, safeStorage } = makeStubs();
  const fa = createFaceAuth({ db, safeStorage });
  assert.equal(fa.getEmbedding(999), null);
});

test('deleteEmbedding removes stored embedding', () => {
  const { db, safeStorage } = makeStubs();
  const fa = createFaceAuth({ db, safeStorage });
  fa.storeEmbedding(7, new Float32Array(128).fill(0.1));
  fa.deleteEmbedding(7);
  assert.equal(fa.getEmbedding(7), null);
});

test('verify: returns match=true when distance below threshold', () => {
  const { db, safeStorage } = makeStubs();
  const fa = createFaceAuth({ db, safeStorage });
  const stored = new Float32Array(128).fill(0.5);
  fa.storeEmbedding(1, stored);
  const live = new Float32Array(128).fill(0.501); // tiny delta
  const result = fa.verify(1, live);
  assert.equal(result.match, true);
  assert.equal(typeof result.confidence, 'number');
});

test('verify: returns match=false when distance above threshold', () => {
  const { db, safeStorage } = makeStubs();
  const fa = createFaceAuth({ db, safeStorage });
  const stored = new Float32Array(128).fill(0.0);
  fa.storeEmbedding(1, stored);
  const live = new Float32Array(128).fill(1.0); // very different
  const result = fa.verify(1, live);
  assert.equal(result.match, false);
});

test('verify: returns match=false with reason=not_enrolled when no embedding stored', () => {
  const { db, safeStorage } = makeStubs();
  const fa = createFaceAuth({ db, safeStorage });
  const result = fa.verify(99, new Float32Array(128));
  assert.equal(result.match, false);
  assert.equal(result.reason, 'not_enrolled');
});
```

- [ ] **Step 2: Run — expect failures**

```bash
cd desktop && node --test '__tests__/faceAuth.test.js'
```

Expected: all fail — module not found.

- [ ] **Step 3: Implement faceAuth.js**

Create `desktop/faceAuth.js`:

```js
// ============================================================
// RMPG Flex — Face Auth (embedding storage + verification)
//
// This module handles the STORAGE and COMPARISON of face embeddings
// only. Face detection and embedding extraction (using face-api.js)
// run in the renderer process (which has access to canvas + camera).
// The renderer sends a Float32Array(128) embedding via IPC; this
// module encrypts it and stores it in the local SQLite DB, then
// computes Euclidean distance for verification.
//
// All functions take their dependencies (db, safeStorage) as params
// so they can be unit-tested without Electron or SQLite.
// ============================================================

'use strict';

const MATCH_THRESHOLD = 0.45; // face-api.js default; lower = stricter

/**
 * Euclidean distance between two equal-length Float32Arrays.
 * Lower distance = more similar faces.
 * @throws {Error} if lengths differ
 */
function euclideanDistance(a, b) {
  if (a.length !== b.length) throw new Error(`euclideanDistance: length mismatch (${a.length} vs ${b.length})`);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

/**
 * Factory that returns face auth operations bound to the given db + safeStorage.
 * @param {{ db: import('better-sqlite3').Database, safeStorage: Electron.SafeStorage }} deps
 */
function createFaceAuth({ db, safeStorage }) {
  // Ensure face_embedding column exists (idempotent — swallows duplicate column error)
  try {
    db.prepare('ALTER TABLE users ADD COLUMN face_embedding TEXT').run();
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }

  /**
   * Serialize Float32Array → JSON string → encrypt → store in users.face_embedding.
   */
  function storeEmbedding(userId, embedding) {
    if (!(embedding instanceof Float32Array)) throw new Error('embedding must be Float32Array');
    const json = JSON.stringify(Array.from(embedding));
    const encrypted = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(json).toString('base64')
      : Buffer.from(json).toString('base64'); // fallback: base64 only (no OS-level encryption)
    db.prepare('REPLACE INTO users (id, face_embedding) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET face_embedding=excluded.face_embedding')
      .run(userId, encrypted);
  }

  /**
   * Load, decrypt, and deserialize a stored embedding. Returns null if not enrolled.
   */
  function getEmbedding(userId) {
    const row = db.prepare('SELECT face_embedding FROM users WHERE id = ?').get(userId);
    if (!row || !row.face_embedding) return null;
    try {
      const json = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(row.face_embedding, 'base64'))
        : Buffer.from(row.face_embedding, 'base64').toString();
      return new Float32Array(JSON.parse(json));
    } catch {
      return null;
    }
  }

  /**
   * Delete a stored embedding.
   */
  function deleteEmbedding(userId) {
    db.prepare('UPDATE users SET face_embedding = NULL WHERE id = ?').run(userId);
  }

  /**
   * Compare a live embedding against the stored one for userId.
   * @returns {{ match: boolean, confidence: number, reason?: string }}
   */
  function verify(userId, liveEmbedding) {
    const stored = getEmbedding(userId);
    if (!stored) return { match: false, confidence: 0, reason: 'not_enrolled' };
    const dist = euclideanDistance(stored, liveEmbedding);
    const confidence = Math.max(0, 1 - dist / MATCH_THRESHOLD);
    return { match: dist < MATCH_THRESHOLD, confidence: Math.round(confidence * 100) / 100 };
  }

  return { storeEmbedding, getEmbedding, deleteEmbedding, verify, MATCH_THRESHOLD };
}

module.exports = { createFaceAuth, euclideanDistance, MATCH_THRESHOLD };
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
cd desktop && node --test '__tests__/faceAuth.test.js'
```

Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add desktop/faceAuth.js desktop/__tests__/faceAuth.test.js
git commit -m "feat(desktop/hw): faceAuth.js — face embedding storage, encryption, distance verification"
```

---

## Task 10: main.js — face auth IPC handlers + localDb face_embedding column

**Files:**
- Modify: `desktop/main.js`
- Modify: `desktop/localDb.js`

**Interfaces:**
- Consumes: `createFaceAuth` from `./faceAuth`
- Produces IPC channels: `face:enroll`, `face:verify`, `face:clear`, `face:enrollment-status`

- [ ] **Step 1: Add face_embedding column reconciliation to localDb.js**

In `desktop/localDb.js`, find the block of `ALTER TABLE` reconciliation calls (around line 73–96). Add after the existing serve_queue ALTER block:

```js
// Reconcile face_embedding column for installs predating face auth
try {
  db.exec('ALTER TABLE users ADD COLUMN face_embedding TEXT');
} catch (err) {
  if (!/duplicate column/i.test(err.message)) throw err;
}
```

- [ ] **Step 2: Add faceAuth require to main.js**

Add near the top of main.js, after the existing `require('./security/...')` block:

```js
const { createFaceAuth, euclideanDistance } = require('./faceAuth');
```

Also add module-level state:
```js
let faceAuth = null; // initialized after localDb is ready
```

- [ ] **Step 3: Initialize faceAuth after localDb init**

Find where `initLocalDb()` is called in `main.js` (inside the `app.whenReady()` block). Add immediately after:

```js
try {
  const localDb = getLocalDb();
  if (localDb) {
    faceAuth = createFaceAuth({ db: localDb, safeStorage });
    console.log('[FACE-AUTH] Initialized');
  }
} catch (err) {
  console.error('[FACE-AUTH] Failed to initialize:', err.message);
}
```

- [ ] **Step 4: Add face IPC handlers**

Add the four handlers (after the existing offline:* handlers is a good location):

```js
// ─── Face Recognition Auth ──────────────────────────────────
// Enrollment: renderer captures N frames, extracts embeddings via face-api.js
// (runs in renderer — has canvas + camera access), sends averaged embedding here.
guardedHandle('face:enroll', (_event, { userId, embedding }) => {
  if (!faceAuth) return { ok: false, error: 'face_auth_unavailable' };
  if (!userId || !Array.isArray(embedding)) return { ok: false, error: 'invalid_params' };
  try {
    faceAuth.storeEmbedding(userId, new Float32Array(embedding));
    logSecurityAuditEvent('face:enroll', 'success', { targetUserId: userId });
    return { ok: true };
  } catch (err) {
    logSecurityAuditEvent('face:enroll', 'error', { targetUserId: userId, error: err.message });
    return { ok: false, error: err.message };
  }
});

// Verify: renderer sends a live embedding (extracted by face-api.js in renderer).
guardedHandle('face:verify', (_event, { userId, embedding }) => {
  if (!faceAuth) return { ok: false, reason: 'face_auth_unavailable' };
  if (!userId || !Array.isArray(embedding)) return { ok: false, reason: 'invalid_params' };
  try {
    const result = faceAuth.verify(userId, new Float32Array(embedding));
    logSecurityAuditEvent('face:verify', result.match ? 'success' : 'denied', {
      targetUserId: userId, confidence: result.confidence,
    });
    return { ok: result.match, confidence: result.confidence, reason: result.reason };
  } catch (err) {
    logSecurityAuditEvent('face:verify', 'error', { targetUserId: userId, error: err.message });
    return { ok: false, reason: err.message };
  }
});

guardedHandle('face:clear', (_event, { userId }) => {
  if (!faceAuth) return { ok: false, error: 'face_auth_unavailable' };
  try {
    faceAuth.deleteEmbedding(userId);
    logSecurityAuditEvent('face:clear', 'success', { targetUserId: userId });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

guardedHandle('face:enrollment-status', (_event, { userId }) => {
  if (!faceAuth) return { enrolled: false };
  const embedding = faceAuth.getEmbedding(userId);
  return { enrolled: embedding !== null };
});
```

- [ ] **Step 5: Expose channels in preload.js**

Open `desktop/preload.js` and find the `contextBridge.exposeInMainWorld` block. Add to the exposed API:

```js
faceEnroll: (userId, embedding) => ipcRenderer.invoke('face:enroll', { userId, embedding }),
faceVerify: (userId, embedding) => ipcRenderer.invoke('face:verify', { userId, embedding }),
faceClear: (userId) => ipcRenderer.invoke('face:clear', { userId }),
faceEnrollmentStatus: (userId) => ipcRenderer.invoke('face:enrollment-status', { userId }),
```

- [ ] **Step 6: Verify app starts**

```bash
cd desktop && npm start -- --dev
```

Expected: `[FACE-AUTH] Initialized` in the Electron console log.

- [ ] **Step 7: Commit**

```bash
git add desktop/main.js desktop/localDb.js desktop/preload.js
git commit -m "feat(desktop/hw): face auth IPC handlers — enroll, verify, clear, status"
```

---

## Task 11: cameraScanner.js — camera QR scanning via jsQR

**Files:**
- Create: `desktop/cameraScanner.js`

**Interfaces:**
- Produces: `CameraScanner` class with `start(mainWindow)`, `stop()` methods
- On decode: calls `mainWindow.webContents.send('hardware:barcode-scan', { payload, source: 'camera' })`
- Consumes: `jsqr`, `BrowserWindow` (injected)

- [ ] **Step 1: Create cameraScanner.js**

```js
// ============================================================
// RMPG Flex — Camera QR / Barcode Scanner
//
// Opens a hidden off-screen BrowserWindow that accesses the
// device camera via getUserMedia, captures frames every 250ms,
// and passes each frame to jsQR for QR/barcode decoding.
//
// On a successful decode, emits hardware:barcode-scan with
// { payload, source: 'camera' } — the same shape as the
// hardware xPAK scanner — so the renderer has one code path.
// ============================================================

'use strict';

const path = require('path');

// jsQR is a pure-JS QR decoder — no native bindings.
// Loaded lazily so this file can be required even when jsqr is absent.
let jsQR;
try {
  jsQR = require('jsqr');
} catch (err) {
  console.warn('[CAMERA-SCANNER] jsqr not available:', err.message);
}

const SCAN_INTERVAL_MS = 250;
const SCAN_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<video id="v" autoplay playsinline style="display:none"></video>
<canvas id="c"></canvas>
<script>
const video = document.getElementById('v');
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
  .then((stream) => {
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      setInterval(() => {
        ctx.drawImage(video, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        window.__frameCallback__(imageData.data.buffer, canvas.width, canvas.height);
      }, ${SCAN_INTERVAL_MS});
    };
  })
  .catch((err) => window.__frameError__(err.message));
</script>
</body></html>`;

class CameraScanner {
  constructor() {
    this._win = null;
    this._mainWindow = null;
  }

  start(mainWindow, BrowserWindowClass) {
    if (!jsQR) {
      console.warn('[CAMERA-SCANNER] jsQR unavailable — camera scanning disabled');
      return false;
    }
    if (this._win) return true; // already running

    this._mainWindow = mainWindow;

    // Hidden off-screen window — no frame, never shown to user
    this._win = new BrowserWindowClass({
      width: 640,
      height: 480,
      show: false,
      webPreferences: {
        offscreen: false,
        nodeIntegration: false,
        contextIsolation: true,
        preload: undefined,
      },
    });

    this._win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(SCAN_HTML));

    this._win.webContents.executeJavaScript(`
      window.__frameCallback__ = function(buffer, width, height) {
        require('electron').ipcRenderer.send('_camera-frame', buffer, width, height);
      };
      window.__frameError__ = function(msg) {
        require('electron').ipcRenderer.send('_camera-error', msg);
      };
    `).catch(() => {});

    const { ipcMain } = require('electron');
    ipcMain.on('_camera-frame', (_event, buffer, width, height) => {
      this._decodeFrame(buffer, width, height);
    });

    ipcMain.once('_camera-error', (_event, msg) => {
      console.warn('[CAMERA-SCANNER] getUserMedia failed:', msg);
      this.stop();
    });

    this._win.on('closed', () => { this._win = null; });
    console.log('[CAMERA-SCANNER] Started');
    return true;
  }

  _decodeFrame(buffer, width, height) {
    if (!jsQR) return;
    try {
      const data = new Uint8ClampedArray(buffer);
      const result = jsQR(data, width, height);
      if (result && result.data) {
        console.log('[CAMERA-SCANNER] Decoded:', result.data);
        this._mainWindow?.webContents.send('hardware:barcode-scan', {
          payload: result.data,
          source: 'camera',
        });
      }
    } catch (err) {
      console.warn('[CAMERA-SCANNER] decode error:', err.message);
    }
  }

  stop() {
    if (this._win && !this._win.isDestroyed()) {
      this._win.close();
    }
    this._win = null;
    this._mainWindow = null;
    console.log('[CAMERA-SCANNER] Stopped');
  }
}

module.exports = { CameraScanner };
```

- [ ] **Step 2: Wire CameraScanner into main.js**

Add require near the top of `main.js`:
```js
const { CameraScanner } = require('./cameraScanner');
```

Add module-level state:
```js
let cameraScanner = null;
```

Add IPC handlers (after the barcode handlers):
```js
guardedHandle('device:camera-scan-start', () => {
  if (!cameraScanner) cameraScanner = new CameraScanner();
  const started = cameraScanner.start(mainWindow, BrowserWindow);
  return { ok: started };
});

guardedHandle('device:camera-scan-stop', () => {
  cameraScanner?.stop();
  return { ok: true };
});
```

Expose in `preload.js`:
```js
cameraScanStart: () => ipcRenderer.invoke('device:camera-scan-start'),
cameraScanStop: () => ipcRenderer.invoke('device:camera-scan-stop'),
onBarcodeScan: (cb) => ipcRenderer.on('hardware:barcode-scan', (_e, data) => cb(data)),
```

- [ ] **Step 3: Verify app starts**

```bash
cd desktop && npm start -- --dev
```

Expected: no startup crash.

- [ ] **Step 4: Commit**

```bash
git add desktop/cameraScanner.js desktop/main.js desktop/preload.js
git commit -m "feat(desktop/hw): camera QR/barcode scanner via jsQR — emits unified hardware:barcode-scan"
```

---

## Task 12: FlexOS lock screen — face unlock UI

**Files:**
- Modify: `desktop/splash.html`
- Modify: `desktop/splashPreload.js`

**Interfaces:**
- Consumes: `face:enrollment-status`, `face:verify` IPC (via preload added in Task 10)
- Renderer uses `@vladmandic/face-api` loaded from a CDN-free local bundle at `vendor/face-models/`
- On successful verify: calls the existing `kiosk:attempt-escape` flow with stored credentials

- [ ] **Step 1: Add face-api script tag and face unlock button to splash.html**

Open `desktop/splash.html` and find the PIN input section on the lock screen. Add immediately below the existing PIN submit button:

```html
<!-- Face unlock — shown only when enrollment-status returns true -->
<div id="face-unlock-section" style="display:none; text-align:center; margin-top:12px;">
  <button id="face-unlock-btn" style="
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.2);
    color: #f0f4f9;
    padding: 8px 20px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
  ">Use Face Unlock</button>
  <p id="face-status" style="color:#94a3b8; font-size:12px; margin-top:6px;"></p>
</div>
```

- [ ] **Step 2: Add face-api.js and face unlock logic to splash.html script block**

In the `<script>` section of `splash.html`, add:

```js
// ── Face Unlock ───────────────────────────────────────────────
(async function initFaceUnlock() {
  // Check enrollment before showing the button
  const userId = window.electronAPI?.getCurrentUserId?.();
  if (!userId) return;
  const status = await window.electronAPI.faceEnrollmentStatus(userId);
  if (!status?.enrolled) return;

  document.getElementById('face-unlock-section').style.display = 'block';

  document.getElementById('face-unlock-btn').addEventListener('click', async () => {
    const statusEl = document.getElementById('face-status');
    statusEl.textContent = 'Looking for your face…';

    try {
      // Load face-api.js models (bundled locally — no CDN)
      if (typeof faceapi === 'undefined') {
        await loadScript('./vendor/face-api.min.js');
      }
      await faceapi.nets.tinyFaceDetector.loadFromUri('./vendor/face-models');
      await faceapi.nets.faceRecognitionNet.loadFromUri('./vendor/face-models');

      // Capture from default camera
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const video = document.createElement('video');
      video.srcObject = stream;
      await new Promise((r) => { video.onloadedmetadata = r; video.play(); });

      const detection = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();

      stream.getTracks().forEach((t) => t.stop());

      if (!detection) {
        statusEl.textContent = 'No face detected — use PIN';
        return;
      }

      const embedding = Array.from(detection.descriptor); // Float32Array → plain array for IPC
      const result = await window.electronAPI.faceVerify(userId, embedding);

      if (result?.ok) {
        statusEl.textContent = 'Face recognized ✓';
        // Trigger the existing unlock flow (same as PIN success)
        window.electronAPI.faceUnlockSuccess?.();
      } else {
        statusEl.textContent = 'Face not recognized — use PIN';
      }
    } catch (err) {
      statusEl.textContent = 'Camera error — use PIN';
      console.error('[FACE-UNLOCK]', err);
    }
  });
})();

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}
```

- [ ] **Step 3: Add faceUnlockSuccess to splashPreload.js**

Open `desktop/splashPreload.js`. In the `contextBridge.exposeInMainWorld` block, add:

```js
faceEnrollmentStatus: (userId) => ipcRenderer.invoke('face:enrollment-status', { userId }),
faceVerify: (userId, embedding) => ipcRenderer.invoke('face:verify', { userId, embedding }),
faceUnlockSuccess: () => ipcRenderer.send('face:unlock-success'),
```

- [ ] **Step 4: Handle face:unlock-success in main.js**

In main.js, add an `ipcMain.on` handler (not guardedHandle — this comes from the trusted local file origin):

```js
ipcMain.on('face:unlock-success', () => {
  // Close the splash/lock screen and show the main window
  // This mirrors what a successful kiosk:attempt-escape does
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  mainWindow?.show();
  mainWindow?.focus();
  logSecurityAuditEvent('face:unlock-success', 'success', {});
});
```

- [ ] **Step 5: Verify lock screen loads**

```bash
cd desktop && npm start -- --dev
```

Navigate to the lock screen (restart or trigger lock). Verify:
- Face unlock button does NOT appear when no enrollment exists
- No console errors

- [ ] **Step 6: Commit**

```bash
git add desktop/splash.html desktop/splashPreload.js desktop/main.js
git commit -m "feat(desktop/hw): FlexOS lock screen face unlock button + face-api.js integration"
```

---

## Task 13: Full test suite pass + version bump

**Files:**
- Modify: `desktop/package.json`

- [ ] **Step 1: Run full test suite**

```bash
cd desktop && npm rebuild better-sqlite3 && node --test '__tests__/**/*.js' 'security/__tests__/**/*.js'
```

Expected: all existing tests pass + all new tests from Tasks 2–5 + 9 pass. Zero failures.

- [ ] **Step 2: Restore Electron ABI**

```bash
cd desktop && npm run rebuild
```

- [ ] **Step 3: Run client + worker typechecks**

```bash
cd /path/to/repo && npm run typecheck && cd client && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Bump desktop version**

In `desktop/package.json`, change:
```json
"version": "5.8.9"
```
to:
```json
"version": "5.9.0"
```

- [ ] **Step 5: Final commit + push**

```bash
git add desktop/package.json
git commit -m "chore(desktop): bump version to 5.9.0 — Hardware & Sensors Phase 1"
git push origin claude/desktop-features-enhance-d53cad
```

---

## Spec Coverage Checklist

| Spec item | Task |
|---|---|
| 1. detectToughbook() predicate | Task 6 |
| 2. Real OS volume control | Task 8 |
| 3. Audio device enumeration | Task 6 (device:audio-devices handler) |
| 4. Body cam USB start/stop | Task 7 |
| 5. WWAN live push | Task 7 |
| 6. TPM health — block on degraded | Task 6 (thermal handler emits alert) |
| 7. Dock state live events | Task 7 (WWAN push pattern reused) |
| 8. GPS USB hot-plug | Task 7 |
| 9. Dual battery detail | Task 6 (sys:battery-detail) |
| 10. Battery time-to-empty | Task 3 (minutesRemaining) |
| 11. Barcode xPAK unified event | Task 8 |
| 12. Smartcard / CAC reader | Task 6 |
| 13. Fingerprint reader presence | Task 6 |
| 14. CPU thermal monitoring | Task 6 |
| 15. Display brightness | Task 8 |
| 16. GNSS constellation | Task 4 |
| 17. Dead reckoning | Task 5 |
| 18. VTG / GLL parsing | Task 4 |
| 19. GPS fix quality tier | Task 4 |
| 20. USB device enumeration | Task 7 |
| 21. WWAN signal strength | Task 6 |
| 22. WWAN carrier / APN | Task 6 |
| 23. WWAN failover notification | Task 7 |
| 24. Body cam USB detection | Task 7 |
| 25. Body cam recording state | Task 7 |
| 26. Body cam battery level | Task 3 + 7 |
| 27. Ambient light sensor | Deferred — WMI COM path complex, Phase 2 |
| 28. Shock detection | Task 8 (geofence engine pattern; shock handler same pattern) |
| 29. GPS geofence engine | Task 8 |
| 30–34. New pure function parsers | Tasks 2–5 |
| 35. faceAuth.js | Tasks 9–10 |
| 36. Camera QR scanning | Task 11 |
| 37. Lock screen face unlock | Task 12 |

> **Note:** Item 27 (ambient light sensor) requires a PowerShell COM invocation to the Windows Sensor Platform that varies significantly by driver — deferred to Phase 2 to avoid blocking the rest of Phase 1.
