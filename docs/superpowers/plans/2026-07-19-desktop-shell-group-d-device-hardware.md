# Desktop Shell — Group D (Device & Hardware) Implementation Plan

**Goal:** Build `desktop/deviceInfo.js` — the 10 Device & Hardware functions for the RMPG Flex desktop shell (serial/audio/video/bluetooth device enumeration, GPS hardware presence, auto-launch, global shortcuts, multi-display info) — per Group D of the 10-group sequence in [`docs/superpowers/specs/2026-07-18-desktop-shell-functions-and-hardening-design.md`](../specs/2026-07-18-desktop-shell-functions-and-hardening-design.md) (spec functions #31-40, `device:*` channel namespace). Stacked on `main` post-merge of Groups G/F/H/A/B (PRs #2851/#2853/#2854/#2857/#2858); Group C (Sync & Offline Management) is concurrently in progress in a separate worktree and is not a dependency of Group D's code.

**Architecture:** Same DI pattern as `desktop/systemInfo.js`/`desktop/fileOps.js` — every OS/Electron-touching function takes its dependency as a parameter so pure decision/shaping logic is unit-tested with fakes in `desktop/__tests__/deviceInfo.test.js`, and the thin `main.js` wiring layer does the real `require()`s and `guardedHandle` registration.

## Global Constraints

- Match existing `desktop/*.js` conventions: CommonJS, no TypeScript, header comment block matching `desktop/systemInfo.js`'s style.
- Commit after each task.

## Scope decisions (flagged, not silently absorbed)

1. **Audio/video device enumeration (#32/#33) run in the renderer, not main process.** Electron's main process has no API to list audio/video input devices — that's the Web Platform's `navigator.mediaDevices.enumerateDevices()`, available in the renderer/preload context (preload scripts run with access to browser APIs), not `ipcMain`. So `listAudioDevices`/`listVideoDevices` are implemented as **preload-direct functions with no IPC round-trip and no `main.js` handler** — the `device:audio-devices`/`device:video-devices` "channel" names from the spec table exist only as documentation of the capability's namespace, not literal `ipcMain.handle` registrations. The pure grouping/filtering logic (`groupMediaDevicesByKind`, `filterVideoInputDevices`) still lives in `deviceInfo.js` and is required by `preload.js`, so it's unit-tested the same way as everything else. Labels are empty strings until a `getUserMedia` stream has been granted at least once in-session — not addressed here (no permission-priming logic added; documented limitation).
2. **Bluetooth enumeration (#34) is macOS-only for v1**, via `system_profiler SPBluetoothDataType -json` (structured, parseable) shelled out from `main.js`, mirroring `sys:battery`'s existing `pmset`-on-darwin-only pattern. Non-macOS platforms return `[]` rather than attempting a Windows-specific PowerShell equivalent — consistent with `sys:battery`'s existing `if (process.platform !== 'darwin') return null` precedent, and flagged here as a deliberate v1 scope line, not an oversight.
3. **`checkGpsHardwarePresent` (#35) closes the ambiguity via a live open-probe, not just enumeration.** `internalGps.js`'s existing `findGpsPort()` already tells us whether a GNSS-looking serial device is enumerated at all. To distinguish "present and free" from "present but in use" (by this app's own already-running `InternalGps` instance, or another process/driver), a new `probeGpsPortOpen(portPath, SerialPortCtor)` in `internalGps.js` attempts a fresh `open()`/`close()` against the same path (OS-level exclusive-lock semantics mean this correctly reports busy without disturbing an already-open connection). `deviceInfo.js`'s pure `classifyGpsPresence(foundPort, probeError)` turns `{foundPort, probeError}` into the spec's `{present, portBusy}` shape.
4. **`registerGlobalShortcut`'s `actionId` needs no server-side allowlist.** Unlike `accelerator` (validated by Group G's existing `validateGlobalShortcutAccelerator`), `actionId` is treated as an opaque string the main process never interprets — the registered `globalShortcut` callback just re-emits it to the renderer over a new `device:shortcut-triggered` event (`preload.js`'s `onShortcutTriggered(callback)`, following the existing `onInternalGpsUpdate`-style listener pattern). The renderer owns deciding what each `actionId` means and reacting to it; main.js is a dumb relay with no privileged action registry to keep in sync, so there's nothing an attacker gains by supplying an arbitrary `actionId` beyond an arbitrary string round-tripping back to the same renderer that sent it.
5. **Fixing a pre-existing gap while already touching `package.json`'s `build.files`:** `systemInfo.js` (Group A) and `fileOps.js` (Group B) were never added to `desktop/package.json`'s `build.files` allowlist despite the spec's own explicit warning ("Each PR updates `desktop/package.json`'s `build.files` allowlist for any new module file — required for `electron-builder` packaging, an easy miss"). Since electron-builder's `files` array is a replacing allowlist (not additive to a default glob) when populated with explicit filenames, this means the **packaged app currently ships without `systemInfo.js`/`fileOps.js`**, and every `sys:*`/`fs:*` handler would throw `Cannot find module` at runtime in a built/installed app, even though `npm run start`/`--dev` works fine (dev mode reads source files directly, unpackaged). Fixed in this PR alongside adding `deviceInfo.js`, since it's the same line of code and directly relevant to not repeating the same miss a third time.

## Tasks

### Task 1: `listSerialPorts`
- `internalGps.js`: add `async function listSerialPorts() { if (!SerialPort) return []; try { return await SerialPort.list(); } catch { return []; } }`, export it — single source of truth for the lazy `SerialPort` require, reused by both GPS port discovery and this general-purpose listing.
- `deviceInfo.js`: pure `formatSerialPorts(rawPortList)` → `Array<{path, manufacturer}>`.
- `main.js`: `guardedHandle('device:serial-ports', async () => formatSerialPorts(await listSerialPorts()))`.
- `preload.js`: `listSerialPorts: () => ipcRenderer.invoke('device:serial-ports')`.
- Test: 2-3 fake raw ports → formatted shape; empty list → `[]`.

### Task 2: `listAudioDevices` / `listVideoDevices` (preload-only, no IPC)
- `deviceInfo.js`: pure `groupMediaDevicesByKind(mediaDeviceInfoList)` → `{inputs: [...], outputs: [...]}` (audioinput/audiooutput, each `{deviceId, label}`); pure `filterVideoInputDevices(mediaDeviceInfoList)` → `Array<{id, label}>` (videoinput only, `id` = `deviceId`).
- `preload.js`: `listAudioDevices: async () => groupMediaDevicesByKind(await navigator.mediaDevices.enumerateDevices())`, `listVideoDevices: async () => filterVideoInputDevices(await navigator.mediaDevices.enumerateDevices())` — requires `require('./deviceInfo')` in `preload.js` (new require in that file; confirm no naming collision with existing requires there).
- Test: fake `MediaDeviceInfo[]` (mixed kinds) → correct bucketing/filtering, empty list → empty shapes.

### Task 3: `getBluetoothDevices`
- `deviceInfo.js`: pure `parseSystemProfilerBluetoothOutput(jsonString)` → `Array<{name, paired, connected}>`, tolerant of the real `SPBluetoothDataType` JSON shape (`SPBluetoothDataType[0].device_connected`/`device_not_connected` arrays of `{<name>: {device_services: ..., ...}}`); returns `[]` on unparseable input rather than throwing.
- `main.js`: `guardedHandle('device:bluetooth', async () => { if (process.platform !== 'darwin') return []; try { const { stdout } = await execFileAsync('system_profiler', ['SPBluetoothDataType', '-json'], { timeout: 5000 }); return parseSystemProfilerBluetoothOutput(stdout); } catch (err) { console.error(...); return []; } })`.
- `preload.js`: `getBluetoothDevices: () => ipcRenderer.invoke('device:bluetooth')`.
- Test: fixture JSON string (connected + not-connected devices) → correct `{name, paired, connected}` array; malformed JSON → `[]`.

### Task 4: `checkGpsHardwarePresent`
- `internalGps.js`: add `async function probeGpsPortOpen(portPath, SerialPortCtor) { ... }` — opens+immediately closes a throwaway `SerialPort` instance at `portPath`; resolves `null` on success, resolves the caught `Error` on failure. Export it.
- `deviceInfo.js`: pure `classifyGpsPresence(foundPort, probeError)` → `{present: false, portBusy: false}` when no port found; `{present: true, portBusy: false}` when found and probe succeeded; `{present: true, portBusy: true}` when found but probe failed.
- `main.js`: `guardedHandle('device:gps-present', async () => { const found = await findGpsPort(); if (!found) return classifyGpsPresence(null, null); const probeError = await probeGpsPortOpen(found.path, SerialPort); return classifyGpsPresence(found, probeError); })`.
- `preload.js`: `checkGpsHardwarePresent: () => ipcRenderer.invoke('device:gps-present')`.
- Test: `classifyGpsPresence` with the 3 input combinations above.

### Task 5: `setAutoLaunch` / `getAutoLaunchState`
- No new pure function — trivial one-line wrappers (`app.setLoginItemSettings({openAtLogin: Boolean(enabled)})` / `app.getLoginItemSettings().openAtLogin`), matching Group B's "skip straight to wiring" precedent for handlers with no decision logic to unit-test.
- `main.js`: `guardedHandle('device:set-auto-launch', (event, enabled) => { app.setLoginItemSettings({ openAtLogin: Boolean(enabled) }); return { ok: true }; })`, `guardedHandle('device:auto-launch-state', () => app.getLoginItemSettings().openAtLogin)`.
- `preload.js`: `setAutoLaunch: (enabled) => ipcRenderer.invoke('device:set-auto-launch', enabled)`, `getAutoLaunchState: () => ipcRenderer.invoke('device:auto-launch-state')`.

### Task 6: `registerGlobalShortcut` / `unregisterGlobalShortcut`
- `main.js`: add `globalShortcut` to the `require('electron')` destructure. `guardedHandle('device:register-shortcut', (event, accelerator, actionId) => { const validation = validateGlobalShortcutAccelerator(accelerator); if (!validation.ok) return { ok: false, error: validation.error }; const okRegistered = globalShortcut.register(accelerator, () => mainWindow?.webContents.send('device:shortcut-triggered', actionId)); return okRegistered ? { ok: true } : { ok: false, error: 'registration failed (already taken by another app?)' }; })`, `guardedHandle('device:unregister-shortcut', (event, accelerator) => { const validation = validateGlobalShortcutAccelerator(accelerator); if (validation.ok) globalShortcut.unregister(accelerator); })`.
- `preload.js`: `registerGlobalShortcut: (accelerator, actionId) => ipcRenderer.invoke('device:register-shortcut', accelerator, actionId)`, `unregisterGlobalShortcut: (accelerator) => ipcRenderer.invoke('device:unregister-shortcut', accelerator)`, `onShortcutTriggered: (callback) => { const handler = (_e, actionId) => callback(actionId); ipcRenderer.on('device:shortcut-triggered', handler); return () => ipcRenderer.removeListener('device:shortcut-triggered', handler); }`.
- Cleanup: confirm `app.on('will-quit', () => globalShortcut.unregisterAll())` exists or add it, so shortcuts don't leak past app restart.

### Task 7: `getDisplays`
- `main.js`: add `screen` to the `require('electron')` destructure.
- `deviceInfo.js`: pure `formatDisplays(rawDisplays, primaryDisplayId)` → `Array<{id, bounds, primary}>`.
- `main.js`: `guardedHandle('device:displays', () => formatDisplays(screen.getAllDisplays(), screen.getPrimaryDisplay().id))`.
- `preload.js`: `getDisplays: () => ipcRenderer.invoke('device:displays')`.
- Test: 2 fake displays, one matching `primaryDisplayId` → correct `primary` flags.

### Task 8: package.json build.files fix
- Add `"systemInfo.js"`, `"fileOps.js"`, `"deviceInfo.js"` to `desktop/package.json`'s `build.files` array.

### Task 9: Final verification
- `node --check` on every touched file.
- Run full `desktop` test suite (`npm test` from `desktop/`).
- Confirm 8 new `guardedHandle('device:...')` registrations in `main.js` (10 functions minus 2 preload-only: audio/video).
- Confirm no duplicate `require(...)` lines introduced.
- Update the progress ledger, mark Group D complete.
