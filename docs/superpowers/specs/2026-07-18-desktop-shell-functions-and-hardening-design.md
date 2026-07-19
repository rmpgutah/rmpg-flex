# Desktop Shell — 50 New Functions + 50 Hardening Functions — Design Spec

**Date**: 2026-07-18
**Status**: Approved for planning
**Scope**: Electron desktop shell (`desktop/`) only — no changes to the `/desktop`
web launcher feature (see
[2026-07-18-desktop-launcher-v2-design.md](2026-07-18-desktop-launcher-v2-design.md),
already shipped).

## Purpose

Two matched additions to the Electron shell, designed and shipped together
rather than sequentially:

1. **50 new IPC/preload functions** closing real capability gaps in the
   current 36-handler surface (diagnostics, file export/import, sync
   control, hardware access, window/UX utilities).
2. **50 hardening functions** closing real security gaps found by auditing
   the *existing* shell — not speculative checklist items. Every new
   function from (1) gets its hardening applied as part of the same unit of
   work, and every one of the 5 hardening groups also retrofits the existing
   36 handlers.

Building the new surface and its hardening in one coordinated pass (rather
than "ship first, harden later") avoids ever shipping an unvalidated IPC
handler, even temporarily.

## Confirmed gaps motivating this spec

Audited directly against `desktop/main.js` (2872 lines), `desktop/preload.js`,
`desktop/pinManager.js`, `desktop/localDb.js`, `desktop/updater.js`:

- No `Content-Security-Policy` is set anywhere on the session.
- `setPermissionRequestHandler`/`setPermissionCheckHandler`
  ([main.js:715-728](../../../desktop/main.js)) grant geolocation/
  notifications/media to **any** origin the window ever navigates to, not
  just the production host.
- None of the 36 `ipcMain.handle`/`ipcMain.on` registrations validate
  `event.senderFrame` — any script with access to `window.electron` can call
  every handler, including ones that spawn local child processes
  (`recon:tool-spawn`, `recon:catalog-run`) with renderer-supplied args.
- No `will-navigate` guard on the main window (only `setWindowOpenHandler`
  for *new* windows is covered).
- `pinManager.js` reads `admin_offline_secret` and `all_user_secrets`
  ([pinManager.js:45-58](../../../desktop/pinManager.js)) from the local
  SQLite `config` table in plaintext — no `safeStorage` (OS keychain) use
  anywhere in the shell.
- `localDb.js` stores a cached `password_hash` column
  ([localDb.js:60](../../../desktop/localDb.js)) in an unencrypted `.sqlite`
  file with no explicit file-permission restriction.
- Recon child processes inherit the full parent environment and have no
  timeout or concurrency cap.

## Non-goals

- No changes to the `/desktop` web launcher (React feature) — this spec is
  the Electron shell only.
- No new deep-link (`rmpgflex://`) protocol handler — flagged during design
  as its own scope (packaging/Info.plist/registry changes) and deferred to a
  future spec.
- No OS theme following — the app is forced Blue & Silver dark regardless of
  OS preference (per CLAUDE.md), so a `getOsThemePreference` function was
  considered and dropped as not actionable.
- Not a `sandbox: true` migration for every `BrowserWindow` — full renderer
  sandboxing would require re-architecting several preload APIs that need
  Node's `child_process`/`serialport`/`better-sqlite3` access in the main
  process today; `hardenWebPreferencesDefaults` (Group F) locks down every
  *other* webPreferences flag and documents this as a explicitly-deferred
  follow-up, not a silent gap.

## Architecture

### New files (isolation by responsibility, mirrors existing `desktop/*.js` flat-file pattern)

**Capability modules** (Section 1 — new functions):
- `desktop/systemInfo.js` — Group A (System & Diagnostics)
- `desktop/fileOps.js` — Group B (File & Data Export/Import)
- `desktop/deviceInfo.js` — Group D (Device & Hardware)
- Group C (Sync & Offline Management) extends existing `desktop/syncManager.js`
  and `desktop/localDb.js` directly — these functions operate on state those
  modules already own, so new functions belong there, not a new file.
- Group E (Window/UX/Notifications) extends `desktop/main.js` directly —
  these are thin wrappers around `BrowserWindow`/`app`/`Tray`/`clipboard`
  APIs already imported there.

**Security modules** (Section 2 — hardening functions), all under a new
`desktop/security/` directory:
- `desktop/security/sessionHardening.js` — Group F (Process & Session)
- `desktop/security/ipcGuard.js` — Group G (IPC Input Validation / Sender Auth)
- `desktop/security/secretsStore.js` — Group H (Local Data Protection)
- `desktop/security/sessionAuth.js` — Group I (Auth/Session Hardening)
- `desktop/security/childProcessGuard.js` — Group J (Child-Process/Network)

Each security module exports pure, independently-testable functions — e.g.
`ipcGuard.js` exports `validateIpcSenderOrigin(event, expectedHost)` which
`main.js` calls as the first line of every handler, not a framework or
decorator layer. This keeps the hardening auditable: `grep validateIpcSenderOrigin
desktop/main.js` should show one call per handler.

### IPC channel naming

Follows the existing `namespace:action` convention
(`window:minimize`, `geo:ip-locate`, `offline:api`):

| Group | Namespace | Preload-exposed? |
|---|---|---|
| A System & Diagnostics | `sys:*` | yes, all 10 |
| B File & Data | `fs:*` | yes, all 10 |
| C Sync & Offline Mgmt | `sync:*` (new, distinct from existing `offline:*`) | yes, all 10 |
| D Device & Hardware | `device:*` | yes, all 10 |
| E Window/UX/Notifications | `window:*` / `notify:*` / `clipboard:*` | 8 of 10 (2 are main-process-internal, see table) |

## Section 1 — 50 New Functions

### Group A — System & Diagnostics (`desktop/systemInfo.js`, `sys:*`)

| # | Function | Channel | Signature | Purpose |
|---|---|---|---|---|
| 1 | `getSystemInfo` | `sys:info` | `() => {os, arch, cpuModel, totalMem, freeMem, diskFree}` | Support-ticket triage without asking the officer to screenshot System Info |
| 2 | `getAppLogs` | `sys:logs` | `(lines=500) => string` | Tail the app's log file for in-app diagnostics view |
| 3 | `openLogsFolder` | `sys:open-logs-folder` | `() => void` | `shell.openPath()` to the logs directory |
| 4 | `exportDiagnosticsBundle` | `sys:export-diagnostics` | `() => {ok, path}` | Zips redacted logs + config for support; redaction via `secretsStore.redactSensitiveFieldsInLogs` |
| 5 | `getCrashReports` | `sys:crash-reports` | `() => Array<{date, path}>` | Lists Electron `crashReporter` dumps if any exist |
| 6 | `restartApp` | `sys:restart` | `() => void` | `app.relaunch(); app.exit()` |
| 7 | `checkDiskSpace` | `sys:disk-space` | `() => {freeBytes, warn: boolean}` | Warn before a local DB write that would fail on a full disk |
| 8 | `getNetworkInterfaces` | `sys:network-interfaces` | `() => Array<{name, address, type}>` | Diagnose connectivity issues, inform geofence config |
| 9 | `getBatteryStatus` | `sys:battery` | `() => {percent, charging} \| null` | Laptop-in-vehicle power awareness (null on desktops) |
| 10 | `getIdleTime` | `sys:idle-time` | `() => seconds` | Wraps `powerMonitor.getSystemIdleTime()` |

### Group B — File & Data Export/Import (`desktop/fileOps.js`, `fs:*`)

| # | Function | Channel | Signature | Purpose |
|---|---|---|---|---|
| 11 | `saveFileDialog` | `fs:save-dialog` | `(opts: {defaultPath, filters}) => path \| null` | Native save dialog for PDF/CSV exports |
| 12 | `openFileDialog` | `fs:open-dialog` | `(opts: {filters, multi}) => paths \| null` | Native open dialog for bulk imports |
| 13 | `writeExportFile` | `fs:write-export` | `(path, data) => {ok, error?}` | Write buffer/string to a `saveFileDialog`-chosen path |
| 14 | `readImportFile` | `fs:read-import` | `(path) => {ok, data?, error?}` | Read a chosen import file |
| 15 | `revealInFolder` | `fs:reveal` | `(path) => void` | `shell.showItemInFolder()` |
| 16 | `exportLocalDbBackup` | `fs:export-db-backup` | `() => {ok, path}` | Encrypted snapshot of the local SQLite cache (via `secretsStore`) |
| 17 | `importLocalDbBackup` | `fs:import-db-backup` | `(path) => {ok, error?}` | Restore from an encrypted snapshot; validated by `secretsStore.validateBackupFileBeforeImport` |
| 18 | `getDownloadsPath` | `fs:downloads-path` | `() => path` | `app.getPath('downloads')` wrapper |
| 19 | `printSilently` | `fs:print-silent` | `(printerName) => {ok, error?}` | Silent print to a named printer, validated against `getPrinters()` output |
| 20 | `getPrinters` | `fs:printers` | `() => Array<{name, isDefault}>` | `webContents.getPrintersAsync()` wrapper |

### Group C — Sync & Offline Management (extends `syncManager.js`/`localDb.js`, `sync:*`)

| # | Function | Channel | Signature | Purpose |
|---|---|---|---|---|
| 21 | `pauseSync` | `sync:pause` | `() => void` | Suspend the background sync loop (e.g. on metered connection) |
| 22 | `resumeSync` | `sync:resume` | `() => void` | Resume it |
| 23 | `getSyncQueueDetail` | `sync:queue-detail` | `() => Array<{id, table, action, failCount, lastError}>` | Visibility into stuck/failed items, not just a count |
| 24 | `retryFailedSyncItem` | `sync:retry-item` | `(id) => {ok, error?}` | Re-attempt one failed queue item; `id` validated against real rows by `ipcGuard.validateSyncQueueIdInput` |
| 25 | `clearFailedSyncItems` | `sync:clear-failed` | `() => {cleared: number}` | Drop permanently-failed items after officer/admin review |
| 26 | `getLastSyncError` | `sync:last-error` | `() => {message, at} \| null` | Most recent sync failure detail for the sync-status UI |
| 27 | `forceFullResync` | `sync:force-full` | `() => {ok}` | Wipe local cache + full re-pull (e.g. after suspected corruption) |
| 28 | `getLocalCacheStats` | `sync:cache-stats` | `() => Array<{table, rows, bytes}>` | Per-table cache size for the offline-status panel |
| 29 | `clearLocalCache` | `sync:clear-cache` | `(table) => {ok}` | Targeted cache clear; `table` allowlisted against known schema |
| 30 | `getOfflineWriteQueueSize` | `sync:write-queue-size` | `() => number` | Count of queued offline writes awaiting push, for a taskbar badge |

### Group D — Device & Hardware (`desktop/deviceInfo.js`, `device:*`)

| # | Function | Channel | Signature | Purpose |
|---|---|---|---|---|
| 31 | `listSerialPorts` | `device:serial-ports` | `() => Array<{path, manufacturer}>` | Generalizes beyond the fixed Toughbook GPS path for other serial hardware |
| 32 | `listAudioDevices` | `device:audio-devices` | `() => {inputs, outputs}` | Mic/speaker enumeration for radio/dispatch audio setup |
| 33 | `listVideoDevices` | `device:video-devices` | `() => Array<{id, label}>` | Camera enumeration for ALPR/field-camera device picking |
| 34 | `getBluetoothDevices` | `device:bluetooth` | `() => Array<{name, paired, connected}>` | Body-cam/dashcam docking status |
| 35 | `checkGpsHardwarePresent` | `device:gps-present` | `() => {present, portBusy}` | Distinguishes "no GPS module" from "port in use" (currently ambiguous in `internalGps.js`) |
| 36 | `setAutoLaunch` | `device:set-auto-launch` | `(enabled) => {ok}` | `app.setLoginItemSettings()` wrapper |
| 37 | `getAutoLaunchState` | `device:auto-launch-state` | `() => boolean` | Read current OS auto-launch registration |
| 38 | `registerGlobalShortcut` | `device:register-shortcut` | `(accelerator, actionId) => {ok, error?}` | E.g. a panic-button hotkey; `accelerator` allowlisted by `ipcGuard.validateGlobalShortcutAccelerator` |
| 39 | `unregisterGlobalShortcut` | `device:unregister-shortcut` | `(accelerator) => void` | Cleanup counterpart |
| 40 | `getDisplays` | `device:displays` | `() => Array<{id, bounds, primary}>` | Multi-monitor layout info for secondary-window placement |

### Group E — Window/UX/Notifications (extends `main.js`)

| # | Function | Channel | Preload-exposed | Signature | Purpose |
|---|---|---|---|---|---|
| 41 | `openSecondaryWindow` | `window:open-secondary` | yes | `(path, opts) => {id}` | E.g. a floating dispatch board on a second monitor; created with the same hardened `webPreferences` as the main window (`sessionHardening.hardenWebPreferencesDefaults`) |
| 42 | `closeSecondaryWindow` | `window:close-secondary` | yes | `(id) => void` | Counterpart |
| 43 | `setDockBadge` | `notify:dock-badge` | yes | `(count) => void` | Unread-notification badge on Dock/Taskbar; `count` coerced to a bounded integer |
| 44 | `flashFrame` | `notify:flash-frame` | yes | `() => void` | Attention-flash the taskbar icon on an urgent alert |
| 45 | `setTrayStatus` | `notify:tray-status` | yes | `(state: 'on-shift'\|'off-shift'\|'alert') => void` | Tray icon/tooltip reflecting shift state; `state` is an enum, not a free string |
| 46 | `saveWindowBounds` | *(main-internal)* | no | `(win) => void` | Called from `main.js`'s own `resize`/`move`/`close` listeners — no renderer trigger needed |
| 47 | `restoreWindowBounds` | *(main-internal)* | no | `() => {x,y,width,height} \| null` | Called at `createMainWindow()` time |
| 48 | `toggleFullScreen` | `window:toggle-fullscreen` | yes | `() => void` | Wraps `win.setFullScreen(!win.isFullScreen())` |
| 49 | `getClipboardText` | `clipboard:get` | yes | `() => string` | Wraps Electron's `clipboard.readText()` |
| 50 | `setClipboardText` | `clipboard:set` | yes | `(text) => void` | Wraps `clipboard.writeText()`; never called with secret values (enforced by `sessionAuth.disableClipboardAutoSyncOfSecrets`) |

## Section 2 — 50 Hardening Functions

### Group F — Process & Session Level (`desktop/security/sessionHardening.js`)

| # | Function | Closes |
|---|---|---|
| 1 | `configureContentSecurityPolicy()` | No CSP set anywhere — adds one via `session.defaultSession.webRequest.onHeadersReceived`, scoped to the app + API hosts |
| 2 | `scopePermissionHandlers()` | `setPermissionRequestHandler`/`setPermissionCheckHandler` currently allow geo/notifications/media for any origin — restricts to the configured `serverHost` |
| 3 | `installNavigationGuard()` | Only `setWindowOpenHandler` (new windows) exists today — adds `will-navigate` to block cross-origin navigation of existing windows too |
| 4 | `hardenWebPreferencesDefaults()` | Single source of truth for `webPreferences` (contextIsolation, nodeIntegration:false, webSecurity:true, no webviewTag, no experimentalFeatures) applied to every `BrowserWindow` — main, splash, and the new `openSecondaryWindow` |
| 5 | `restrictNewWindowCreation()` | Hardens `setWindowOpenHandler` to deny by default and explicitly reject `javascript:`/`data:` schemes, not just same-host allow |
| 6 | `pinCertificateOrValidateTls()` | No TLS validation beyond OS defaults — adds explicit host-pinning for `api.rmpgutah.us`/`rmpgutah.us` via `session.setCertificateVerifyProc`, fail-closed |
| 7 | `disableRemoteModuleAndInsecureDefaults()` | Explicitly pins `enableRemoteModule: false` and other Electron security defaults instead of relying on version defaults |
| 8 | `lockDownAutoUpdaterTransport()` | Confirms `autoUpdater` only fetches over https and that `forceDevUpdateConfig` can never be true in a packaged build |
| 9 | `restrictDevToolsInProduction()` | No gate today — disables `webContents.openDevTools()` when `app.isPackaged` is true |
| 10 | `restrictBrowserWindowPreloadPaths()` | Ensures every `BrowserWindow` (including the new `openSecondaryWindow`) can only ever load the shell's own `preload.js`, never a caller-supplied path |

### Group G — IPC Input Validation / Sender Auth (`desktop/security/ipcGuard.js`)

| # | Function | Closes |
|---|---|---|
| 11 | `validateIpcSenderOrigin(event, expectedHost)` | None of the 36 existing handlers check `event.senderFrame` — this becomes the first line of every handler (existing + new) |
| 12 | `sanitizeReconToolArgs(toolId, args)` | `recon:tool-spawn`/`recon:catalog-run` take renderer args straight into `child_process.spawn` — allowlists `toolId` and strictly types/bounds `args` |
| 13 | `validatePinInput(pin)` | Defense-in-depth 6-digit-numeric check before `pinManager` touches it, even though the renderer UI already constrains it |
| 14 | `validateUserIdInput(userId)` | Type/range check before any `offline:*` or new `sync:*` handler touches `localDb` |
| 15 | `validateFilePathInput(path, allowedRoots)` | New `fs:*` handlers (save/open dialog results, backup export/import) must resolve inside an allowed directory — no arbitrary filesystem write via a crafted path |
| 16 | `validateSyncQueueIdInput(id)` | `retryFailedSyncItem` must reference a real existing queue row |
| 17 | `validateGlobalShortcutAccelerator(accelerator)` | `registerGlobalShortcut` must not let a renderer hijack arbitrary OS-level hotkeys |
| 18 | `rateLimitIpcHandler(channel, event)` | No rate limiting on any channel today — generic per-channel limiter applied to expensive/dangerous ones (recon spawn, diagnostics export, force-full-resync) |
| 19 | `requireOfflineAuthForSensitiveIpc(event)` | `offline:generate-pin` (admin-only) is currently callable by any renderer code with no role check |
| 20 | `auditIpcHandlerRegistry()` | Dev-mode startup self-check that every registered channel has a matching validator wired — fails loud if a new handler skips it |

### Group H — Local Data Protection (`desktop/security/secretsStore.js`)

| # | Function | Closes |
|---|---|---|
| 21 | `encryptSecretForStorage(plaintext)` / `decryptSecretForStorage(ciphertext)` | Wraps Electron's `safeStorage.encryptString`/`decryptString` (OS keychain-backed) — currently unused anywhere in the shell |
| 22 | `migrateOfflineSecretsToSafeStorage()` | One-time migration moving `admin_offline_secret`/`all_user_secrets` out of plaintext `config` table |
| 23 | `encryptCachedPasswordHashes()` | Wraps `localDb.js`'s cached `password_hash` column through safeStorage with an added integrity check |
| 24 | `secureDeleteLocalCache(table)` | `clearLocalCache`/`forceFullResync` currently just `DELETE FROM` — this overwrites before drop so stale PII doesn't linger in freed SQLite pages |
| 25 | `verifyLocalDbIntegrity()` | No `PRAGMA integrity_check` today — runs at startup, refuses to trust a corrupted/tampered cache |
| 26 | `restrictLocalDbFilePermissions()` | The SQLite file has no explicit permission restriction — chmod 0600 on creation |
| 27 | `encryptDiagnosticsBundleOnExport()` | New `exportDiagnosticsBundle` (Group A) could leak tokens/PII in plaintext — redacts + encrypts before writing to disk |
| 28 | `redactSensitiveFieldsInLogs()` | No log redaction today — strips JWTs/PINs/secrets before any `console.log`/log-file write |
| 29 | `wipeSecretsOnLogout()` | Cached offline secrets currently only expire on the fixed 24h window — adds explicit clear on officer logout |
| 30 | `validateBackupFileBeforeImport(path)` | New `importLocalDbBackup` (Group B) must checksum/verify a backup before restoring it, so a swapped-in malicious file can't be loaded |

### Group I — Auth/Session Hardening (`desktop/security/sessionAuth.js`)

| # | Function | Closes |
|---|---|---|
| 31 | `enforceJwtExpiryCheckLocally()` | `offline:api` can currently serve responses against a stale cached JWT with no local expiry check |
| 32 | `bindPinSessionToDeviceId()` | The 24h offline PIN override isn't tied to a device fingerprint — a shared/stolen PIN can be replayed from another machine |
| 33 | `auditPinAttemptLogRetention()` | `pin_attempts` table (already used for lockout) has no cap/rotation — grows unbounded |
| 34 | `requireReauthForRecon()` | Recon Connect tool launches have no session-authenticated-officer check today, just "app is open" |
| 35 | `expireCachedCredentialsOnClockSkew()` | A large system-clock jump (anti-forensic trick) isn't detected — forces re-validation of cached auth instead of trusting a rolled-back-clock PIN window |
| 36 | `lockOnSystemSleep()` | PIN re-entry today only happens on the fixed 24h expiry, not on wake-from-sleep |
| 37 | `disableClipboardAutoSyncOfSecrets()` | New `getClipboardText`/`setClipboardText` (Group E) must never round-trip PIN/secret values automatically |
| 38 | `enforceSecondaryWindowSecurityDefaults()` | New `openSecondaryWindow` (Group E) must not be usable to spin up a window with weaker `webPreferences` than the main window |
| 39 | `verifyUpdatePackageSignatureExplicitly()` | Belt-and-suspenders check beyond electron-updater's default OS-level code-sign verification before `quitAndInstall` |
| 40 | `revokeStaleSyncTokensOnMismatch()` | If `syncManager.js` detects the cached org/user no longer matches the authenticated session, purge instead of syncing mismatched data |

### Group J — Child-Process & Network Hardening (`desktop/security/childProcessGuard.js`)

| # | Function | Closes |
|---|---|---|
| 41 | `sandboxChildProcessEnv()` | Recon child processes currently inherit the full parent environment |
| 42 | `enforceChildProcessTimeout()` | No max-runtime today — hard-kills a spawned recon/tool process past a limit |
| 43 | `capConcurrentChildProcesses()` | No concurrency cap — limits simultaneous recon/tool sessions |
| 44 | `validateBinaryPathBeforeSpawn()` | `recon:check-binary`/tool-spawn resolve a renderer-supplied `binary` path with no allowlist against the install directory |
| 45 | `pinOutboundApiHost()` | Ensures `offline:api`/geo/updater calls only ever target the configured hosts, never a renderer-influenced URL |
| 46 | `verifyIpLocateResponseShape()` | `geo:ip-locate`'s third-party response is trusted as-is today — validates shape before use |
| 47 | `timeoutAllIpcNetworkCalls()` | Network-touching handlers (`geo:ip-locate`, `offline:trigger-sync`) have no hard timeout — a hang currently blocks the renderer indefinitely |
| 48 | `logSecurityRelevantIpcCalls()` | No audit trail today for PIN generation, recon spawn, backup import/export, or shortcut registration |
| 49 | `disableInsecureElectronFlags()` | No startup assertion that dev-only flags (`--disable-web-security`, etc.) aren't active in a packaged build |
| 50 | `selfTestHardeningOnStartup()` | Runs Groups F-J's checks as a single startup diagnostic (CSP set? sender validator wired? safeStorage migration done?) and logs/warns on any regression — closes the "who checks the checkers" gap |

## Guardrails

- Every Section-1 function that accepts renderer input calls the matching
  Section-2 validator before doing anything — this is enforced structurally
  (validators are the first statement in the handler body), not by
  convention alone, and `auditIpcHandlerRegistry()` (#20) fails a dev-mode
  startup check if one is missing.
- No hardening function silently changes existing user-facing behavior
  (e.g. `scopePermissionHandlers` still grants geo/notifications/media —
  just only to the real app origin instead of any origin).
- `sandbox: true` is explicitly deferred (see Non-goals) — this is
  documented here so it isn't mistaken for an oversight in `hardenWebPreferencesDefaults`.

## Error Handling

- File-system functions (`fs:*`) never throw across the IPC boundary — they
  return `{ok: false, error}` so the renderer can toast, matching the
  existing `{ok, error?}` convention already used by `recon:launch`/`recon:install`.
- `sync:*` functions that fail (e.g. `retryFailedSyncItem` on a since-deleted
  queue row) return a typed error, not a thrown exception — the renderer's
  sync-status panel is expected to render failures inline, not crash.
- `selfTestHardeningOnStartup()` (#50) never blocks app launch — failures
  are logged via `redactSensitiveFieldsInLogs()` and surfaced as a
  non-blocking startup toast, consistent with this shell's existing pattern
  of never letting a diagnostic check hard-fail startup (see the existing
  cache-clear race in `createMainWindow()`).

## Testing

- Each `desktop/security/*.js` module is pure enough to unit-test directly
  (e.g. `validateFilePathInput` given a path and allowed roots, no Electron
  runtime needed) — add Node-runnable tests under `desktop/security/__tests__/`
  using the same `node --test` pattern implied by this repo's existing
  `tests/*.test.ts` convention (adapted for plain JS in `desktop/`).
- `desktop/systemInfo.js`, `desktop/fileOps.js`, `desktop/deviceInfo.js`
  functions that wrap Electron/Node APIs directly are covered by thin
  integration smoke tests only (mocking `electron`), not exhaustive unit
  tests — consistent with this shell having no existing test suite to
  extend beyond smoke-level coverage.
- Manual: dev-run (`npm run start` in `desktop/`) covering — diagnostics
  export produces a redacted, encrypted bundle; sync pause/resume actually
  stops/resumes network calls; a crafted out-of-allowlist `recon:tool-spawn`
  call is rejected; PIN entry after simulated sleep re-prompts;
  `configureContentSecurityPolicy` doesn't break the production app's own
  script/style loading (verify in the packaged app, not just `--dev`).
- Post-merge: no D1/migration step — this is entirely local to the Electron
  shell, no server-side change.

## Sequencing Note

100 functions across 10 groups is far larger than either prior Desktop
Launcher spec (v1: 1 PR, v2: 13 features across 4 categories). This lands as
**10 independently-committable, independently-shippable PRs, one per
group**, in this order:

1. Group G (IPC sender/input validation) — foundational; every later PR's
   new handlers depend on `ipcGuard.js` existing first.
2. Group F (Process & session hardening) — also foundational, independent of G.
3. Group H (Local data protection) — unblocks safe use of any new function
   that touches secrets or the local DB.
4. Group A (System & Diagnostics)
5. Group B (File & Data Export/Import)
6. Group C (Sync & Offline Management)
7. Group D (Device & Hardware)
8. Group E (Window/UX/Notifications) — last among Section 1 since it's the
   only group with main-process-internal (non-preload) functions to shake out.
9. Group I (Auth/session hardening) — depends on Groups A-E existing (several
   entries reference specific new functions, e.g. `enforceSecondaryWindowSecurityDefaults`).
10. Group J (Child-process/network hardening) — last, since `selfTestHardeningOnStartup`
    (#50) checks that Groups F-J are all wired up.

Each PR updates `desktop/package.json`'s `build.files` allowlist for any new
module file (required for `electron-builder` packaging — an easy miss).
