# FZ-55 Windows-native hardware integration — design

**Date:** 2026-07-29
**Scope:** `desktop/` (Electron app, the production Windows deployment target for
Panasonic Toughbook FZ-55 units), not `kiosk-linux/` (a separate, unbooted Buildroot
program — see [`docs/superpowers/specs/2026-07-25-rmpg-flex-desktop-os-program.md`](2026-07-25-rmpg-flex-desktop-os-program.md)).

## Problem

`desktop/main.js`'s `sys:battery` handler ([main.js:1370](../../../desktop/main.js#L1370))
returns `null` on every platform except macOS (`pmset -g batt`), because it was written
and tested on a Mac dev machine. The FZ-55 units this app actually ships to run Windows —
so **battery status does not work in production today**. Several other FZ-55-native
capabilities are also unwired despite being either standard on every mk1/mk2/mk3 unit or
confirmed present in RMPG's fleet, per
[`docs/panasonic-fz55-os-build-requirements.md`](../../panasonic-fz55-os-build-requirements.md)
section 5 (Panasonic spec-sheet-grounded, not inferred):

- **Dual hot-swap batteries** (10.8V/6500mAh front + rear bay) — officers swap batteries
  mid-shift without powering down; a single-battery-shaped status object can't represent that.
- **24-pin docking connector** — used for vehicle mounts; no code today distinguishes
  docked (vehicle) vs. handheld use.
- **WWAN/LTE modem** (Sierra EM7455/EM7511, mk3 adds EM9190 5G) — patrol units' primary
  connectivity when there's no Wi-Fi; signal/carrier state isn't surfaced anywhere.
- **Barcode reader xPAK** (`FZ-VBR551M`) — confirmed installed in RMPG's fleet. Acts as a
  USB HID keyboard-wedge, not a distinct driver integration.
- **TPM 2.0 / Secured-core PC** — standard on all three generations; RMPG's
  `desktop/security/` module already reasons about device trust posture but has no signal
  from the platform's actual hardware root of trust.

Fingerprint (`FZ-VFP551W`) and smartcard (`FZ-VNF551W`/`FZ-VSC551W`) xPAK modules exist in
Panasonic's catalog but are **not confirmed installed in RMPG's fleet** — out of scope
here; add them later if/when a unit actually has one.

## Architecture

Follow the existing convention exactly (`systemInfo.js`, `deviceInfo.js`,
`desktop/security/*.js`): one new pure-logic module, **`desktop/hardwareFz55.js`**, holding
parsing/shaping functions that take their OS-touching dependency as an explicit parameter
(a CIM/PowerShell JSON string, a `child_process` executor, etc.) — no live OS access inside
the pure functions, so they unit-test with `node --test` and fixture strings, no Windows
machine required. `main.js` wires each function to a `guardedHandle(...)` IPC channel;
`preload.js` exposes it on `window.electron`; `client/src` consumes it.

Every new capability is **Windows-first** (that's the actual deployment target) and
degrades to `null`/`{ present: false }` on any other platform — mirroring `sys:battery`'s
existing `darwin`-only branch, just inverted, so macOS dev machines keep working without
throwing.

### Windows data source: PowerShell CIM, not a native module

All new hardware queries (battery, dock, WWAN, TPM) go through
`child_process.execFile('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance ... | ConvertTo-Json'])`,
matching how `pmset` is already invoked for battery today. This avoids adding any
node-gyp/native-addon dependency beyond the two (`serialport`, `better-sqlite3`) the
project already accepts the ABI-rebuild pain for (see `package.json`'s `postinstall`
comment) — a WMI/CIM native binding would add a third.

## Components

### 1. Battery status (`hardwareFz55.js`: `parseWindowsBatteryOutput`)

PowerShell: `Get-CimInstance -ClassName Win32_Battery | Select-Object DeviceID, EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json`.
`Win32_Battery` returns **one instance per installed battery** — the FZ-55's dual hot-swap
bays surface as an array (0, 1, or 2 entries; a bay with no battery installed is simply
absent, not a zeroed entry). `BatteryStatus` value `2` = AC/charging, `1` = discharging
(per the WMI enum) — same charging/not-charging semantics `parsePmsetBatteryOutput`
already exposes, just per-bay.

Shape: `{ batteries: [{ percent, charging }], overallPercent, charging }` — `overallPercent`
is the arithmetic mean when 2 bays are populated (so existing single-battery UI that reads
`overallPercent`/`charging` keeps working unchanged); `batteries[]` is additive for a
future dual-bay-aware UI. Empty array (desktop Mac, no battery) → same `null` result
`sys:battery` returns today, so no consumer needs updating for the non-laptop case.

### 2. Dock state (`hardwareFz55.js`: `parseWindowsDockOutput`)

PowerShell: `Get-CimInstance -ClassName Win32_ComputerSystem | Select-Object -ExpandProperty PCSystemType`
is unreliable for dock detection (it reports chassis type, not live dock state). Use
`Get-PnpDevice -Class DockUpDown` filtered to `Status -eq 'OK'`, which reflects the ACPI
dock/undock event the 24-pin connector fires. Shape: `{ docked: boolean }`. New IPC
channel `device:dock-state`.

### 3. WWAN modem status (`hardwareFz55.js`: `parseWindowsWwanOutput`)

PowerShell: `Get-NetAdapter | Where-Object {$_.InterfaceDescription -match 'Sierra|EM74|EM75|EM91'} | Select-Object Name, Status`
for presence/link-up, plus `Get-CimInstance -Namespace root\wmi -ClassName MSFT_NetworkAdapterSignalQuality` (best-effort;
some Sierra Wireless minidrivers don't publish this WMI class — treat a query failure as
signal-quality-unavailable, not as "no modem"). Shape: `{ present: boolean, connected: boolean, signalPercent: number | null }`.
New IPC channel `device:wwan-status`.

### 4. Barcode scanner capture (`hardwareFz55.js`: `classifyKeystrokeBurst`)

Pure function: given an array of `{ char, timestampMs }` keydown records, returns
`{ isScan: boolean, payload: string }` when the gap between consecutive keys stays under
a threshold (30ms — HID keyboard-wedge scanners emit characters far faster than a human
typing) **and** the burst terminates in Enter, with a minimum length (3 chars) to avoid
misclassifying a fast Enter-after-single-char human keystroke. `main.js` attaches a
`before-input-event` listener on the main `BrowserWindow` that buffers keydowns per-window
(a 200ms trailing gap or explicit non-Enter-terminated-timeout resets the buffer) and calls
this classifier on every Enter. Emits `hardware:barcode-scanned` with the payload to the
renderer via `webContents.send`. `preload.js` adds `onBarcodeScanned(callback)` alongside
the existing `onInternalGpsUpdate`-style subscription pattern.

### 5. TPM / Secured-core posture (`hardwareFz55.js`: `parseWindowsTpmOutput`)

PowerShell: `Get-Tpm | Select-Object TpmPresent, TpmReady, TpmEnabled | ConvertTo-Json`.
Shape: `{ present, ready, enabled }`. New IPC channel `sys:tpm-status`. This is read-only
reporting, consumed by `desktop/security/` as one more posture signal — **not** a new
enforcement point; nothing blocks app function on TPM absence.

## Data flow

Renderer → `window.electron.getBatteryStatus()` / `.getDockState()` / `.getWwanStatus()` /
`.getTpmStatus()` → `ipcRenderer.invoke(...)` → `main.js` `guardedHandle` → platform branch
(`win32`: PowerShell CIM query + pure parser; `darwin`: existing `pmset` path for battery,
`null` for the other three; else: `null`) → JSON back to renderer. Barcode capture is
push, not pull: main-process keydown listener → classifier → `webContents.send('hardware:barcode-scanned', payload)` →
renderer subscribes via `onBarcodeScanned`.

## Error handling

Every Windows branch wraps its `execFile` call in try/catch exactly like the existing
`sys:battery` handler, logging via `console.error` and returning `null`/`{ present: false }`
on any PowerShell failure (missing cmdlet, timeout, non-zero exit) — never throwing across
the IPC boundary. A 3-second `execFile` timeout (matching the existing `pmset` call)
prevents a hung PowerShell process from blocking the renderer's await.

## Testing

`desktop/__tests__/hardwareFz55.test.js`, mirroring `systemInfo.test.js`'s style: fixture
JSON strings for each `Get-CimInstance ... | ConvertTo-Json` shape (single battery, dual
battery, zero battery, malformed/truncated JSON) run through each pure parser with
`assert.deepEqual`. `classifyKeystrokeBurst` gets fixture keystroke-timing arrays covering:
fast scan-shaped burst, slow human typing, short burst under the 3-char minimum, burst not
terminated by Enter.

## Out of scope

- Fingerprint and smartcard xPAK modules — not confirmed in RMPG's fleet.
- WWAN *data* control (dialing, APN config) — read-only status only; provisioning is a
  carrier/BIOS-level concern (Panasonic PC Command for PowerShell), not this app's job.
- Automatic UI mode-switching on dock state (vehicle/nav layout) — this design only wires
  the dock-state signal through; consuming it to change layout is a follow-on client-side task.
