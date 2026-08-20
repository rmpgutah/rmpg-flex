# Desktop — Hardware & Sensors Phase 1 Design

**Date:** 2026-08-15
**Branch target:** `claude/desktop-features-enhance-d53cad`
**Scope:** 37 items across hardware sensing, Toughbook peripherals, WWAN depth, body cam, environmental sensors, face recognition, camera scanning, and supporting build infrastructure.

---

## 1. Goals

- Wire every real hardware capability of the Panasonic Toughbook FZ-55 that is currently stubbed or absent
- Keep the existing pure-function / injectable-dependency test pattern (`hardwareFz55.js`, `internalGps.js`, `deviceInfo.js`) for all new parsers
- All hardware access lives in the main process; renderer receives typed IPC events only
- Every new feature degrades gracefully on non-Windows / non-Toughbook hardware (return `null` / `{ present: false }`)
- Face recognition runs entirely offline (local ML model, no cloud)
- Camera QR scanning emits the same `hardware:barcode-scan` event as the hardware xPAK so the renderer has one code path

---

## 2. Architecture Overview

```
Renderer (React SPA)
  └─ preload.js  (contextBridge)
       └─ main.js  IPC handlers  (guardedHandle)
            ├─ hardwareFz55.js     pure parsers — battery, dock, WWAN, TPM, thermal,
            │                       smartcard, fingerprint, WWAN signal, USB, shock
            ├─ internalGps.js      NMEA parser — GGA, RMC, VTG, GSV, GLL + dead reckoning
            ├─ deviceInfo.js       media device helpers, GPS classification, displays
            ├─ faceAuth.js         NEW — face-api.js enrollment + verification (main process)
            └─ cameraScanner.js    NEW — camera frame capture → IPC → renderer jsQR decode
```

New files: `desktop/faceAuth.js`, `desktop/cameraScanner.js`
New test files: `desktop/__tests__/hardwareFz55Extended.test.js`, `desktop/__tests__/internalGpsExtended.test.js`, `desktop/__tests__/faceAuth.test.js`

---

## 3. Items by Area

### 3.1 Toughbook Detection

**Item 1 — `detectToughbook()` predicate**

Fill the manufacturer/model predicate in `main.js:3881`. WMI returns one of:

- `Manufacturer`: `"Panasonic"` or `"Panasonic Corporation"` (FZ-55 production units); some OEM SKUs return blank or `"To Be Filled By O.E.M."` — fall through to model check
- `Model` prefix match: `"FZ-"`, `"CF-"`, `"FZ-G"` covers FZ-55, FZ-G2, CF-33, CF-54

```js
const mfr = (wmi.Manufacturer || '').toLowerCase();
const model = (wmi.Model || '').toUpperCase();
const isToughbook =
  mfr.includes('panasonic') ||
  model.startsWith('FZ-') ||
  model.startsWith('CF-');
```

---

### 3.2 Audio

**Item 2 — Real OS volume control**

New IPC `system:set-volume` (replaces stub).

- Windows: `nircmd.exe setsysvolume <0–65535>` — nircmd is a ~100 KB free utility; bundle in `desktop/vendor/nircmd.exe` (Windows only, gitignored binary, included in `electron-builder` `extraResources`)
- macOS: `osascript -e 'set volume output volume <0–100>'`
- Clamp input to `[0, 100]`, map to platform range before invoking
- Fall back gracefully (return `{ ok: false, reason: 'unsupported_platform' }`) on Linux

**Item 3 — Audio device enumeration**

`device:audio-devices` IPC using `navigator.mediaDevices.enumerateDevices()` via a renderer-side call forwarded through preload. `groupMediaDevicesByKind` in `deviceInfo.js` already exists for this; wire the IPC call site.

---

### 3.3 Body Cam

**Item 4 — Body cam USB detection** (replaces stub)

`sys:body-cam-status` — PowerShell `Get-PnpDevice -Class Image | ConvertTo-Json` filtered on known vendor IDs:
- Axon Body 3/4: VID `2B0E`
- Motorola Si500: VID `22B8`

Returns `{ present: bool, vendor: string|null, model: string|null }`.

**Item 25 — Body cam recording state** (Axon only)

`sys:body-cam-start` / `sys:body-cam-stop` — use `node-hid` to send HID commands to the Axon Body camera when present. Returns `{ ok: true }` on success, `{ ok: false, reason }` when no camera or HID fails.

**Item 26 — Body cam battery level**

Extend `sys:body-cam-status` response to include `{ batteryPct: number|null }` read from HID power descriptor.

New pure function in `hardwareFz55.js`:
```js
function parseBodyCamHidReport(reportBuffer) { ... }
```

---

### 3.4 WWAN / LTE

**Item 5 — WWAN live push**

Poll `device:wwan-status` every 30 seconds in main process; emit `hardware:wwan-changed` IPC event to renderer when state changes (present/connected/carrier). Debounce 2 s to avoid flapping.

**Item 21 — WWAN signal strength**

New `device:wwan-signal` IPC — `netsh mbn show signal interface=*` parsed into `{ rssi: number, bars: 0|1|2|3|4|5 }`.

New pure function in `hardwareFz55.js`:
```js
function parseWindowsWwanSignalOutput(netshString) { ... }
```

**Item 22 — WWAN carrier / APN**

New `device:wwan-carrier` IPC — `netsh mbn show connection interface=*` → `{ carrier: string, apn: string }`.

**Item 23 — WWAN failover notification**

When connectivity monitor detects Wi-Fi drop + WWAN connect (or vice versa), emit `connectivity:failover` with `{ from: 'wifi'|'wwan'|'unknown', to: 'wifi'|'wwan'|'unknown' }`.

---

### 3.5 TPM & Security Hardware

**Item 6 — TPM health panel**

`sys:tpm-status` already works. New: when TPM is not ready or not enabled, emit `hardware:tpm-degraded` IPC event on boot and block `auth:store-session` from writing the session token to `safeStorage` (fall back to in-memory only, log a security audit event).

**Item 12 — Smartcard / CAC reader**

New `device:smartcard-status` IPC — PowerShell `Get-SmartCard | ConvertTo-Json` (Windows 10+). Returns `{ present: bool, cardInserted: bool, atr: string|null }`. Emits `hardware:smartcard-changed` on insert/remove.

New pure function:
```js
function parseWindowsSmartCardOutput(rawJsonString) { ... }
```

**Item 13 — Fingerprint reader presence**

New `device:fingerprint-status` IPC — `Get-PnpDevice -Class Biometric | Select-Object FriendlyName, Status | ConvertTo-Json`. Returns `{ present: bool, ready: bool }`.

New pure function:
```js
function parseWindowsFingerprintOutput(rawJsonString) { ... }
```

Surface in FlexOS lock screen: show "Use fingerprint" button only when `present && ready`.

---

### 3.6 Display & Thermal

**Item 15 — Display brightness control**

New `device:set-brightness` IPC (Windows only):
```powershell
(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(0, <level>)
```
Level 0–100. Auto-dim to 30% when `sys:idle-time` > configurable threshold (default 5 min); restore on input.

**Item 14 — CPU thermal monitoring**

New `sys:thermal-status` IPC:
```powershell
Get-WmiObject -Namespace root/WMI -Class MSAcpi_ThermalZoneTemperature | Select-Object CurrentTemperature | ConvertTo-Json
```
`CurrentTemperature` is in tenths of Kelvin → convert to °F (`(K/10 - 273.15) * 9/5 + 32`).

Alert threshold: **185°F** (85°C). Emits `hardware:thermal-alert` IPC event; renderer shows a warning banner.

New pure function:
```js
function parseWindowsThermalOutput(rawJsonString) { ... }
// returns { zones: [{ tempF: number }], maxTempF: number } | null
```

**Item 27 — Ambient light sensor auto-brightness**

`Get-PnpDevice -Class Sensor | Where-Object {$_.FriendlyName -match 'Ambient|Light'} | ConvertTo-Json` to detect presence. Read lux via Windows Sensor API through a PowerShell COM call. Feed lux → brightness curve (configurable in Quick Settings).

---

### 3.7 Battery

**Item 9 — Dual hot-swap battery detail**

New `sys:battery-detail` IPC — returns full `{ batteries: [{ percent, charging, bay }], overallPercent, charging }` array instead of the aggregated-only shape `sys:battery` returns. Bay index maps to physical slot label.

**Item 10 — Time-to-empty / time-to-full**

Extend `parseWindowsBatteryOutput` to read `EstimatedRunTime` (minutes). Add to both `sys:battery` and `sys:battery-detail` responses as `minutesRemaining: number|null`. Surface in tray tooltip as `"Bay 1: 87% — 3h 12m remaining"`.

---

### 3.8 GPS Enhancements

**Item 8 — GPS USB hot-plug re-detect**

Add `usb-detection` npm package watch in main process. On USB insert, re-run `findGpsPort()` and `geo:internal-gps-detect`; emit `hardware:gps-plugged` IPC event. Tear down existing `InternalGps` instance if a better port is found.

**Item 16 — GNSS constellation status**

Parse `$GPGSV` (satellites in view) in `InternalGps._handleLine`. Emit `gps:constellation` event: `{ satsTracked: number, satsInView: number, avgSnr: number }`.

New pure function in `internalGps.js`:
```js
function parseGSV(fields) { ... } // returns { satsInView, sats: [{prn, snr}] }
```

**Item 17 — Dead reckoning / GPS gap fill**

When `pending.lat` is non-null and no new GGA/RMC arrives for > 2 s, use last heading + speed + elapsed ms to project position via great-circle formula. Emit `{ latitude, longitude, accuracy: estimatedM, estimated: true }`. Stop projecting after 30 s (accuracy too low).

**Item 18 — VTG / GLL parsing**

New pure functions:
```js
function parseVTG(fields) { ... } // returns { speedMs, heading }
function parseGLL(fields) { ... } // returns { lat, lng }
```

**Item 19 — GPS fix quality tier**

Classify each position fix into `'excellent'` (HDOP < 1, sats ≥ 8), `'good'` (HDOP < 2, sats ≥ 5), `'degraded'` (HDOP < 5), `'poor'` (any fix). Emit as `fixQuality` field on every position event.

**Item 20 — USB device enumeration**

New `device:usb-devices` IPC — PowerShell `Get-PnpDevice | Where-Object {$_.Class -eq 'USB'} | Select-Object FriendlyName, Status | ConvertTo-Json`. Used internally by hot-plug detection and surfaced in the Diagnostics panel.

---

### 3.9 Barcode & QR Scanning

**Item 11 — Hardware barcode xPAK integration**

Wire the existing `before-input-event` handler in `main.js` to use `filterPrintableKeydown` + `classifyKeystrokeBurst`. On detected scan, emit `hardware:barcode-scan` IPC event with `{ payload: string, source: 'xpak' }`. Renderer subscribes once and routes to the active search field.

**Item 36 — Camera QR / barcode scanning** *(new)*

New file `desktop/cameraScanner.js`. Design:

- Main process opens a hidden `BrowserWindow` (off-screen rendering) that hosts the camera feed via `getUserMedia`
- Every 250 ms, the hidden window posts a frame (ImageData) to the main process via IPC
- Main process passes the frame to `jsQR` (pure JS, no native deps)
- On decode, emits `hardware:barcode-scan` with `{ payload, source: 'camera' }` — **identical shape as xPAK**, so the renderer code path is shared
- `device:camera-scan-start` / `device:camera-scan-stop` IPC controls the hidden window lifecycle
- Falls back gracefully when no camera is present (`getUserMedia` rejects)

Dependencies: `jsqr` (npm, ~40 KB, no native bindings)

---

### 3.10 Face Recognition — FlexOS Lock Screen Auth

**Item 35 — Officer face enrollment & verification** *(new)*

New file `desktop/faceAuth.js`. Uses `@vladmandic/face-api` (TF.js-based, works in Node.js / Electron renderer, no cloud, fully offline).

**Architecture:**

```
faceAuth.js (main process)
  ├─ init()           — loads TinyFaceDetector + FaceRecognitionNet models from
  │                     desktop/vendor/face-models/ (bundled, ~10 MB)
  ├─ enrollOfficer()  — captures N frames from camera, extracts 128-d embeddings,
  │                     averages them, encrypts with safeStorage, stores in localDb
  ├─ verifyFace()     — captures live frame, computes embedding, Euclidean distance
  │                     against stored embedding; threshold 0.45 (FaceAPI default)
  └─ clearEnrollment() — deletes stored embedding for userId
```

**IPC handlers:**
- `face:enroll` — `{ userId }` → captures 5 frames, stores embedding → `{ ok, error? }`
- `face:verify` — `{}` → captures 1 frame, compares → `{ ok, userId, confidence }`
- `face:clear` — `{ userId }` → deletes enrollment → `{ ok }`
- `face:enrollment-status` — `{ userId }` → `{ enrolled: bool }`

**Lock screen integration:**

FlexOS lock screen (existing `splash.html` / `splashPreload.js`) gains a "Face unlock" button below the PIN entry. On click: `face:verify` → on success, bypass PIN and call the existing `kiosk:attempt-escape` flow with a synthesized credential. On failure (distance > threshold or no face detected): show "Face not recognized — use PIN" and fall back.

**Enrollment:**

Admin-only panel in FlexOS settings. Enrollment requires the officer to be logged in (JWT present). Captures 5 frames with live guidance ("Look straight at camera", "Slight left", "Slight right"). Stored embedding is AES-256 encrypted using `safeStorage.encryptString()` before writing to `localDb` column `face_embedding` on the `users` table (add via migration or `_ext` table — check column cap first).

**Failure modes:**
- No camera → `face:verify` returns `{ ok: false, reason: 'no_camera' }` — PIN shown only
- Model load fails → same fallback, logged to `error_log`
- 3 consecutive failed verifications → lock out face auth for 60 s (same escalation as PIN lockout per item 30)

**Privacy / security:**
- Embeddings never leave the device (no server sync)
- Stored encrypted via `safeStorage` (OS-level key, tied to the Electron app identity)
- Admin can clear any officer's enrollment via `face:clear`
- Security audit event logged on every verify attempt (success or failure)

---

### 3.11 Environmental & Safety

**Item 28 — Accelerometer / shock detection**

`Get-WmiObject -Namespace root/WMI -Class Win32_3DAccelerometer` — not available on all FZ-55 SKUs. Fall back to the Windows Sensor Platform via `Get-PnpDevice -Class Sensor`. On high-G event (> 3g threshold, configurable), emit `hardware:shock-detected` IPC event. Renderer auto-drafts an incident with type `vehicle_accident`.

**Item 29 — GPS geofence engine**

In main process, maintain an in-memory array of `{ id, lat, lng, radiusM, label }` zones. Zones are pulled from the server at boot and refreshed every 10 minutes via `syncManager`. On each GPS position event, check all zones using Haversine distance. Emit `geo:geofence-enter` / `geo:geofence-exit` with `{ zoneId, label }`. Store current zone membership in `localDb` so re-entry is not re-triggered after reconnect.

---

## 4. New Files Summary

| File | Purpose |
|---|---|
| `desktop/faceAuth.js` | Face enrollment + verification (main process, face-api.js) |
| `desktop/cameraScanner.js` | Camera QR/barcode decode loop (jsQR, off-screen BrowserWindow) |
| `desktop/vendor/nircmd.exe` | Windows volume control utility (bundled, `extraResources`) |
| `desktop/vendor/face-models/` | TinyFaceDetector + FaceRecognitionNet model weights (~10 MB) |
| `desktop/__tests__/hardwareFz55Extended.test.js` | Tests for thermal, smartcard, fingerprint, WWAN signal parsers |
| `desktop/__tests__/internalGpsExtended.test.js` | Tests for parseVTG, parseGSV, parseGLL, dead reckoning |
| `desktop/__tests__/faceAuth.test.js` | Tests for enrollment/verify logic with injectable camera stub |

---

## 5. Modified Files Summary

| File | Changes |
|---|---|
| `desktop/main.js` | Fill `detectToughbook()`, replace volume/body-cam stubs, add 15+ new IPC handlers, wire barcode xPAK, add USB hot-plug watch, dock-state push, WWAN push, geofence engine |
| `desktop/hardwareFz55.js` | Add `parseWindowsThermalOutput`, `parseWindowsSmartCardOutput`, `parseWindowsFingerprintOutput`, `parseWindowsWwanSignalOutput`, `parseBodyCamHidReport`, `parseWindowsBatteryOutput` (extend with `minutesRemaining`) |
| `desktop/internalGps.js` | Add `parseVTG`, `parseGSV`, `parseGLL`, dead reckoning engine, `fixQuality` classification, GSV constellation events |
| `desktop/deviceInfo.js` | Add `groupMediaDevicesByKind` wiring, `parseWindowsUsbDevicesOutput` |
| `desktop/kioskShell.js` | Lock screen face-unlock button + `face:verify` call |
| `desktop/splash.html` | Face unlock UI element |
| `desktop/splashPreload.js` | `face:verify` / `face:enrollment-status` contextBridge exposure |
| `desktop/package.json` | Add `@vladmandic/face-api`, `jsqr`, `node-hid`, `usb-detection` |
| `desktop/__tests__/hardwareFz55.test.js` | Extend with battery `minutesRemaining` tests |

---

## 6. New IPC Channels

| Channel | Direction | Shape |
|---|---|---|
| `system:set-volume` | renderer→main | `level: 0–100` → `{ ok, reason? }` |
| `device:audio-devices` | renderer→main | `{}` → `{ inputs, outputs }` |
| `sys:body-cam-status` | renderer→main | `{}` → `{ present, vendor, model, batteryPct }` |
| `sys:body-cam-start` | renderer→main | `{}` → `{ ok, reason? }` |
| `sys:body-cam-stop` | renderer→main | `{}` → `{ ok, reason? }` |
| `device:wwan-signal` | renderer→main | `{}` → `{ rssi, bars }` |
| `device:wwan-carrier` | renderer→main | `{}` → `{ carrier, apn }` |
| `device:smartcard-status` | renderer→main | `{}` → `{ present, cardInserted, atr }` |
| `device:fingerprint-status` | renderer→main | `{}` → `{ present, ready }` |
| `device:set-brightness` | renderer→main | `level: 0–100` → `{ ok }` |
| `sys:thermal-status` | renderer→main | `{}` → `{ zones, maxTempF }` |
| `sys:battery-detail` | renderer→main | `{}` → `{ batteries, overallPercent, charging }` |
| `device:usb-devices` | renderer→main | `{}` → `[{ name, status }]` |
| `device:camera-scan-start` | renderer→main | `{}` → `{ ok }` |
| `device:camera-scan-stop` | renderer→main | `{}` → `{ ok }` |
| `face:enroll` | renderer→main | `{ userId }` → `{ ok, error? }` |
| `face:verify` | renderer→main | `{}` → `{ ok, userId, confidence, reason? }` |
| `face:clear` | renderer→main | `{ userId }` → `{ ok }` |
| `face:enrollment-status` | renderer→main | `{ userId }` → `{ enrolled }` |
| `hardware:barcode-scan` | main→renderer | `{ payload, source: 'xpak'\|'camera' }` |
| `hardware:wwan-changed` | main→renderer | `{ present, connected, carrier? }` |
| `hardware:gps-plugged` | main→renderer | `{ portPath, score }` |
| `hardware:shock-detected` | main→renderer | `{ gForce, timestamp }` |
| `hardware:thermal-alert` | main→renderer | `{ maxTempF, zones }` |
| `hardware:bodycam-state-changed` | main→renderer | `{ recording, batteryPct }` |
| `hardware:smartcard-changed` | main→renderer | `{ cardInserted, atr? }` |
| `connectivity:failover` | main→renderer | `{ from, to }` |
| `geo:geofence-enter` | main→renderer | `{ zoneId, label }` |
| `geo:geofence-exit` | main→renderer | `{ zoneId, label }` |
| `gps:constellation` | main→renderer | `{ satsTracked, satsInView, avgSnr }` |

---

## 7. Dependencies to Add

```json
{
  "@vladmandic/face-api": "^3.4.0",
  "jsqr": "^1.4.0",
  "node-hid": "^3.1.0",
  "usb-detection": "^4.1.0"
}
```

All have native bindings — add to `electron-rebuild -f -w` list in `package.json` `rebuild` script alongside `serialport` and `better-sqlite3`.

---

## 8. Testing

- All new `hardwareFz55.js` parsers: pure functions, tested with raw PowerShell fixture strings in `hardwareFz55Extended.test.js`
- All new `internalGps.js` parsers: pure functions, tested with raw NMEA sentence fixtures in `internalGpsExtended.test.js`
- `faceAuth.js`: enrollment + verify logic tested with injectable camera stub (real model weights not loaded in tests)
- `cameraScanner.js`: jsQR decode tested with known QR image fixture (no Electron runtime needed)
- All tests run via `node --test '__tests__/**/*.js'` (existing test runner, no changes needed)

---

## 9. Out of Scope (Phase 1)

- CAC smartcard authentication (card insert detection only; actual auth flow is Phase 2)
- Officer-facing face recognition of subjects / persons database match (Phase 2, different legal requirements)
- Windows Hello integration (requires OS-level enrollment outside our control)
- Fingerprint auth (reader presence detected; actual biometric auth deferred to Phase 2)
- FlexOS UI widgets for new hardware data (Phase 3 — FlexOS Shell)
- Server-side geofence zone management API (Phase 4)
