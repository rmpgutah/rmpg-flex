// ============================================================
// RMPG Flex — Electron Preload Script
// Exposes safe APIs to the renderer process via contextBridge.
// ============================================================

const { contextBridge, ipcRenderer } = require('electron');

// Inlined from deviceInfo.js (which still exports and unit-tests these same
// two functions) rather than require()'d from there. Electron's preload
// require() shim has been observed to fail resolving a preload script's own
// relative require('./sibling.js') calls entirely — reproduced on Electron
// 40.9.1 as "Unable to load preload script ... module not found:
// ./deviceInfo", even with a freshly-reinstalled, correctly-signed Electron
// binary and with contextIsolation/sandbox left at every combination this
// app supports. Keeping preload.js self-contained (no local relative
// requires) sidesteps that failure mode entirely, and is the standard
// workaround for this class of Electron preload issue. Keep these two
// bodies in sync with deviceInfo.js's copies if either changes — same
// duplication rationale as main.js's FATAL_NET_ERRORS.
function groupMediaDevicesByKind(mediaDeviceInfoList) {
  const inputs = [];
  const outputs = [];
  for (const device of mediaDeviceInfoList || []) {
    if (device.kind === 'audioinput') {
      inputs.push({ deviceId: device.deviceId, label: device.label });
    } else if (device.kind === 'audiooutput') {
      outputs.push({ deviceId: device.deviceId, label: device.label });
    }
  }
  return { inputs, outputs };
}

function filterVideoInputDevices(mediaDeviceInfoList) {
  return (mediaDeviceInfoList || [])
    .filter((device) => device.kind === 'videoinput')
    .map((device) => ({ id: device.deviceId, label: device.label }));
}

contextBridge.exposeInMainWorld('electron', {
  // Platform info
  platform: process.platform,
  isElectron: true,

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  toggleFullScreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),

  // Open/close a secondary in-app window (e.g. a detached panel). `path`
  // must be an in-app route ('/dispatch-board') — it is resolved against
  // the same trusted server the main window loads, never treated as an
  // arbitrary URL. Returns { id } on success or { ok:false, error } on
  // an invalid route.
  openSecondaryWindow: (path, opts) => ipcRenderer.invoke('window:open-secondary', path, opts),
  closeSecondaryWindow: (id) => ipcRenderer.invoke('window:close-secondary', id),

  // Opens the Company Browser — a dedicated window for general external
  // web browsing (vendor portals, county sites, etc.) via <webview>.
  // Electron-only; the web SPA build has no window.electron at all, so
  // callers must feature-detect (window.electron?.isElectron) before
  // calling this. See client/src/utils/windowManager.ts's
  // activateNavFunction for that gate.
  openCompanyBrowser: (role) => ipcRenderer.invoke('window:open-company-browser', role),

  // Sets the dock/taskbar badge count. No-ops on platforms without
  // app.setBadgeCount (see main.js's 'notify:dock-badge' handler).
  setDockBadge: (count) => ipcRenderer.invoke('notify:dock-badge', count),

  // Flash the window frame to grab the user's attention (e.g., for alerts).
  // Auto-clears when the window receives focus.
  flashFrame: () => ipcRenderer.invoke('notify:flash-frame'),

  // Reflects shift state in the tray tooltip. state must be one of
  // 'on-shift' | 'off-shift' | 'alert' — anything else is silently
  // ignored by the main-process handler (see main.js's
  // 'notify:tray-status' handler).
  setTrayStatus: (state) => ipcRenderer.invoke('notify:tray-status', state),

  // Clipboard read/write. Plain wrappers with no secret-value enforcement —
  // see main.js's 'clipboard:get'/'clipboard:set' handlers.
  getClipboardText: () => ipcRenderer.invoke('clipboard:get'),
  setClipboardText: (text) => ipcRenderer.invoke('clipboard:set', text),

  // App version
  getVersion: () => ipcRenderer.invoke('app:version'),

  // ─── System & Diagnostics ───────────────────────────
  getSystemInfo: () => ipcRenderer.invoke('sys:info'),
  getCpuUsage: () => ipcRenderer.invoke('sys:cpu-usage'),
  getAppLogs: (lines) => ipcRenderer.invoke('sys:logs', lines),
  openLogsFolder: () => ipcRenderer.invoke('sys:open-logs-folder'),
  exportDiagnosticsBundle: () => ipcRenderer.invoke('sys:export-diagnostics'),
  getCrashReports: () => ipcRenderer.invoke('sys:crash-reports'),
  checkDiskSpace: () => ipcRenderer.invoke('sys:disk-space'),
  getNetworkInterfaces: () => ipcRenderer.invoke('sys:network-interfaces'),
  getBatteryStatus: () => ipcRenderer.invoke('sys:battery'),
  getTpmStatus: () => ipcRenderer.invoke('sys:tpm-status'),
  getIdleTime: () => ipcRenderer.invoke('sys:idle-time'),
  restartApp: () => ipcRenderer.invoke('sys:restart'),
  shutdownOs: () => ipcRenderer.invoke('os:shutdown'),
  restartOs: () => ipcRenderer.invoke('os:restart'),
  returnToWindows: (username, password) => ipcRenderer.invoke('os:return-to-windows', username, password),
  getBodyCamStatus: () => ipcRenderer.invoke('sys:body-cam-status'),
  startBodyCamRecording: () => ipcRenderer.invoke('sys:body-cam-start'),
  stopBodyCamRecording: () => ipcRenderer.invoke('sys:body-cam-stop'),

  // ─── File & Data Export/Import ───────────────────────
  saveFileDialog: (opts) => ipcRenderer.invoke('fs:save-dialog', opts),
  openFileDialog: (opts) => ipcRenderer.invoke('fs:open-dialog', opts),
  writeExportFile: (path, data) => ipcRenderer.invoke('fs:write-export', path, data),
  readImportFile: (path) => ipcRenderer.invoke('fs:read-import', path),
  revealInFolder: (path) => ipcRenderer.invoke('fs:reveal', path),
  getDownloadsPath: () => ipcRenderer.invoke('fs:downloads-path'),
  getPrinters: () => ipcRenderer.invoke('fs:printers'),
  printSilently: (printerName) => ipcRenderer.invoke('fs:print-silent', printerName),
  exportLocalDbBackup: () => ipcRenderer.invoke('fs:export-db-backup'),
  importLocalDbBackup: (path) => ipcRenderer.invoke('fs:import-db-backup', path),

  // ─── Device & Hardware ───────────────────────────────
  // listAudioDevices/listVideoDevices call navigator.mediaDevices directly
  // — no IPC round-trip, no main.js handler. See Group D plan, Scope
  // Decision #1: Electron's main process has no API for this; it's a Web
  // Platform API only available in the renderer/preload context.
  listSerialPorts: () => ipcRenderer.invoke('device:serial-ports'),
  listAudioDevices: async () => groupMediaDevicesByKind(await navigator.mediaDevices.enumerateDevices()),
  listVideoDevices: async () => filterVideoInputDevices(await navigator.mediaDevices.enumerateDevices()),
  getBluetoothDevices: () => ipcRenderer.invoke('device:bluetooth'),
  checkGpsHardwarePresent: () => ipcRenderer.invoke('device:gps-present'),
  getDockState: () => ipcRenderer.invoke('device:dock-state'),
  getWwanStatus: () => ipcRenderer.invoke('device:wwan-status'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('device:set-auto-launch', enabled),
  getAutoLaunchState: () => ipcRenderer.invoke('device:auto-launch-state'),
  setKioskShell: (enabled) => ipcRenderer.invoke('device:set-kiosk-shell', enabled),
  getKioskShellState: () => ipcRenderer.invoke('device:kiosk-shell-state'),
  /** Run a passive WiFi + Bluetooth RF scan. opts: { lat, lng, deviceId, callId } */
  rfScan: (opts) => ipcRenderer.invoke('device:rf-scan', opts ?? {}),
  registerGlobalShortcut: (accelerator, actionId) => ipcRenderer.invoke('device:register-shortcut', accelerator, actionId),
  unregisterGlobalShortcut: (accelerator) => ipcRenderer.invoke('device:unregister-shortcut', accelerator),
  onShortcutTriggered: (callback) => {
    const handler = (_e, actionId) => callback(actionId);
    ipcRenderer.on('device:shortcut-triggered', handler);
    return () => ipcRenderer.removeListener('device:shortcut-triggered', handler);
  },
  getDisplays: () => ipcRenderer.invoke('device:displays'),

  // NOTE: barcode scanner (FZ-VBR551M xPAK) input arrives via onBarcodeScan
  // below (channel 'hardware:barcode-scan'). A duplicate `onBarcodeScanned`
  // API listening on 'hardware:barcode-scanned' (extra "ned") lived here with
  // no caller anywhere in the app and no matching sender in main.js — removed
  // as dead code rather than fixed, since onBarcodeScan already covers this.

  // Crash-safe printing — renders the page to PDF in Chromium and opens
  // it in macOS Preview. Replaces window.print(), whose native NSPrintPanel
  // segfaults the app on macOS 26 (see main.js 'print:to-pdf').
  printToPdf: () => ipcRenderer.invoke('print:to-pdf'),

  // Notifications (native OS notifications)
  showNotification: (title, body) => {
    new Notification(title, { body });
  },

  // ─── Geolocation Fallback ─────────────────────────
  // IP-based geolocation via Google's Geolocation API when
  // navigator.geolocation fails (common on desktop without GPS)
  getIpLocation: () => ipcRenderer.invoke('geo:ip-locate'),

  // ─── Power management (keep navigation alive off-screen) ───
  // While a trip is active the renderer holds a wake lock so the machine
  // doesn't suspend mid-patrol (display may still sleep). Released on trip end.
  keepAwake: () => ipcRenderer.invoke('power:keep-awake'),
  allowSleep: () => ipcRenderer.invoke('power:allow-sleep'),

  // ─── Internal GPS (Panasonic Toughbook) ────────────
  // Reads raw NMEA from the Toughbook's internal u-blox module
  // via serial port. Used instead of navigator.geolocation when
  // running on Toughbook + Windows.
  detectInternalGps: () => ipcRenderer.invoke('geo:internal-gps-detect'),
  startInternalGps: (opts) => ipcRenderer.invoke('geo:internal-gps-start', opts || {}),
  stopInternalGps: () => ipcRenderer.invoke('geo:internal-gps-stop'),
  onInternalGpsUpdate: (callback) => {
    const handler = (_e, pos) => callback(pos);
    ipcRenderer.on('geo:internal-gps-update', handler);
    return () => ipcRenderer.removeListener('geo:internal-gps-update', handler);
  },
  onInternalGpsError: (callback) => {
    const handler = (_e, err) => callback(err);
    ipcRenderer.on('geo:internal-gps-error', handler);
    return () => ipcRenderer.removeListener('geo:internal-gps-error', handler);
  },
  // Satellite count/signal from $GPGSV — main.js forwards InternalGps's own
  // 'gps:constellation' event under this channel. No consumer wired yet;
  // exposed so main.js's send isn't dropped with zero listeners.
  onGpsConstellation: (callback) => {
    const handler = (_e, c) => callback(c);
    ipcRenderer.on('geo:internal-gps-constellation', handler);
    return () => ipcRenderer.removeListener('geo:internal-gps-constellation', handler);
  },
  // Fired from the USB hot-plug re-detect handler when a GPS-looking serial
  // device is plugged in. No consumer wired yet; exposed so the send isn't
  // dropped with zero listeners.
  onGpsPlugged: (callback) => {
    const handler = (_e, info) => callback(info);
    ipcRenderer.on('hardware:gps-plugged', handler);
    return () => ipcRenderer.removeListener('hardware:gps-plugged', handler);
  },

  // ─── Auto-Update API ────────────────────────────────
  // Listen for update status events from the main process
  onUpdateStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('update-status', handler);
    // Return cleanup function
    return () => ipcRenderer.removeListener('update-status', handler);
  },

  // Trigger a manual update check
  checkForUpdates: () => ipcRenderer.send('updater:check'),

  // Force-clear all Chromium caches (HTTP, service workers, cachestorage,
  // appcache, filesystem) and reload the renderer. Called by the web app's
  // WebUpdateBanner when a new service worker version is detected, since
  // the SW skipWaiting+reload alone doesn't clear Electron's HTTP cache.
  forceRefresh: () => ipcRenderer.invoke('app:force-refresh'),

  // ─── Recon Connect ─────────────────────────────────
  // Spawn the locally-installed Recon Connect toolkit in a new terminal window.
  // Returns { ok: boolean, error?: string } — never throws.
  launchReconConnect: () => ipcRenderer.invoke('recon:launch'),

  // Run the platform-appropriate install flow in a visible terminal window.
  // Returns { ok: boolean, error?: string }.
  installReconConnect: () => ipcRenderer.invoke('recon:install'),

  // Quick existence check — returns { installed: boolean, path?: string }.
  checkReconConnect: () => ipcRenderer.invoke('recon:check'),

  // ─── In-app terminal (xterm.js bridge) ──────────────
  // Spawn a Recon Connect process and stream stdio through IPC events.
  reconSpawn: (opts) => ipcRenderer.invoke('recon:term-spawn', opts),
  reconInput: (sessionId, data) => ipcRenderer.send('recon:term-input', { sessionId, data }),
  reconResize: (sessionId, cols, rows) => ipcRenderer.send('recon:term-resize', { sessionId, cols, rows }),
  reconKill: (sessionId) => ipcRenderer.invoke('recon:term-kill', { sessionId }),

  // ─── Native tool runner (Wireless pilot) ───────────
  reconToolSpawn: (toolId, args) => ipcRenderer.invoke('recon:tool-spawn', { toolId, args }),
  reconToolKill: (sessionId) => ipcRenderer.invoke('recon:tool-kill', { sessionId }),
  reconToolInstall: (pkg) => ipcRenderer.invoke('recon:tool-install', { pkg }),
  reconCatalogRun: (opts) => ipcRenderer.invoke('recon:catalog-run', opts),
  reconCheckBinary: (binary) => ipcRenderer.invoke('recon:check-binary', { binary }),
  reconCatalogTerminal: (opts) => ipcRenderer.invoke('recon:catalog-terminal', opts),
  reconToolTerminal: (toolId, args) => ipcRenderer.invoke('recon:tool-terminal', { toolId, args }),
  reconInstallState: () => ipcRenderer.invoke('recon:install-state'),
  reconUpdate: () => ipcRenderer.invoke('recon:update'),
  reconKillAll: () => ipcRenderer.invoke('recon:kill-all'),
  onReconToolData: (callback) => {
    const handler = (_e, payload) => callback(payload.sessionId, payload.kind, payload.data);
    ipcRenderer.on('recon:tool-data', handler);
    return () => ipcRenderer.removeListener('recon:tool-data', handler);
  },
  onReconToolExit: (callback) => {
    const handler = (_e, payload) => callback(payload.sessionId, payload.code);
    ipcRenderer.on('recon:tool-exit', handler);
    return () => ipcRenderer.removeListener('recon:tool-exit', handler);
  },
  onReconData: (callback) => {
    const handler = (_e, payload) => callback(payload.sessionId, payload.data);
    ipcRenderer.on('recon:term-data', handler);
    return () => ipcRenderer.removeListener('recon:term-data', handler);
  },
  onReconExit: (callback) => {
    const handler = (_e, payload) => callback(payload.sessionId, payload.code);
    ipcRenderer.on('recon:term-exit', handler);
    return () => ipcRenderer.removeListener('recon:term-exit', handler);
  },

  // Install a downloaded update (restarts the app)
  installUpdate: () => ipcRenderer.send('updater:install'),

  // ─── System Quick-Settings ──────────────────────────────
  getBattery: () => ipcRenderer.invoke('system:get-battery'),
  getNetwork: () => ipcRenderer.invoke('system:get-network'),
  setVolume:  (level) => ipcRenderer.invoke('system:set-volume', level),
  setBrightness: (level) => ipcRenderer.invoke('device:set-brightness', level),
  getBrightness: () => ipcRenderer.invoke('device:get-brightness'),

  // ─── Extended Hardware (Toughbook FZ-55) ──────────────
  getBatteryDetail: () => ipcRenderer.invoke('sys:battery-detail'),
  getWwanSignal: () => ipcRenderer.invoke('device:wwan-signal'),
  getWwanCarrier: () => ipcRenderer.invoke('device:wwan-carrier'),
  getUsbDevices: () => ipcRenderer.invoke('device:usb-devices'),
  getFingerprintStatus: () => ipcRenderer.invoke('device:fingerprint-status'),

  // ─── WiFi Selector ──────────────────────────────────────
  // Full detail for the currently-connected network (IP, gateway, DNS, channel, etc.)
  wifiGetDetail:    ()              => ipcRenderer.invoke('wifi:get-detail'),
  // Scan all visible SSIDs with signal strength, security, channel
  wifiScanNetworks: ()              => ipcRenderer.invoke('wifi:scan-networks'),
  // List saved Windows WLAN profiles (connectable without credentials)
  wifiListProfiles: ()              => ipcRenderer.invoke('wifi:list-profiles'),
  // Connect to a saved profile by name
  wifiConnect:      (profile)       => ipcRenderer.invoke('wifi:connect', { profile }),
  // Disconnect from the current wireless network
  wifiDisconnect:   ()              => ipcRenderer.invoke('wifi:disconnect'),

  // ─── Auth Session Bridge ────────────────────────────────
  // Called by AuthContext.tsx right after login/2FA/token-refresh so the
  // main process can cache the session (auth_token, refresh_token,
  // current_user_id, current_user_role) for offline mode and PIN sessions.
  // See main.js's 'auth:store-session' handler for what gets derived from
  // the token and why this is the only place these keys are ever written.
  storeAuthSession: (token, refreshToken) =>
    ipcRenderer.invoke('auth:store-session', { token, refreshToken }),

  // ─── Offline Mode API ──────────────────────────────────
  // Route an API request through the local SQLite database
  localApi: (method, path, body) =>
    ipcRenderer.invoke('offline:api', { method, path, body }),

  // Get current offline/authorization state
  getOfflineState: () => ipcRenderer.invoke('offline:state'),

  // Employee: enter a 6-digit PIN to unlock 24h local writes
  enterPin: (pin) => ipcRenderer.invoke('offline:enter-pin', { pin }),

  // Admin: generate a 6-digit PIN for an employee
  generatePin: (userId) => ipcRenderer.invoke('offline:generate-pin', { userId }),

  // Get sync status (last pull/push times, queue depth)
  getSyncStatus: () => ipcRenderer.invoke('offline:sync-status'),

  // Force an immediate sync cycle
  triggerSync: () => ipcRenderer.invoke('offline:trigger-sync'),

  // ─── Sync Pause/Resume ──────────────────────────────────
  pauseSync: () => ipcRenderer.invoke('sync:pause'),
  resumeSync: () => ipcRenderer.invoke('sync:resume'),

  // Per-item sync queue detail (pending + failed rows) for diagnostics UI
  getSyncQueueDetail: () => ipcRenderer.invoke('sync:queue-detail'),

  // Get current write queue size
  getOfflineWriteQueueSize: () => ipcRenderer.invoke('sync:write-queue-size'),

  // Reset a single failed/stuck sync queue item back to pending
  retryFailedSyncItem: (id) => ipcRenderer.invoke('sync:retry-item', id),

  // Bulk-clear every failed sync queue item
  clearFailedSyncItems: () => ipcRenderer.invoke('sync:clear-failed'),

  // Most recent sync error, for diagnostics UI
  getLastSyncError: () => ipcRenderer.invoke('sync:last-error'),

  // Read-only per-table local cache stats ({table, rows, bytes}[]), for
  // an offline-status/diagnostics panel
  getLocalCacheStats: () => ipcRenderer.invoke('sync:cache-stats'),

  // Destructive (single table): clear one mirrored cache table + its
  // sync_metadata row. `table` is validated against the server-side
  // allowlist in clearLocalCache() before any SQL runs.
  clearLocalCache: (table) => ipcRenderer.invoke('sync:clear-cache', table),

  // Destructive: wipe the mirrored/reference cache tables and re-pull
  // everything fresh from the server (never touches sync_queue/gps_breadcrumbs)
  forceFullResync: () => ipcRenderer.invoke('sync:force-full'),

  // Get locally cached user for offline auth
  getCachedUser: (username) =>
    ipcRenderer.invoke('offline:get-cached-user', { username }),

  // Listen for connectivity state changes
  onConnectivityChange: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('offline:connectivity-changed', handler);
    return () => ipcRenderer.removeListener('offline:connectivity-changed', handler);
  },

  // Listen for sync progress events
  onSyncProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('offline:sync-progress', handler);
    return () => ipcRenderer.removeListener('offline:sync-progress', handler);
  },

  // Listen for sync completion
  onSyncComplete: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('offline:sync-complete', handler);
    return () => ipcRenderer.removeListener('offline:sync-complete', handler);
  },

  // Listen for PIN session expiry
  onPinExpired: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('offline:pin-expired', handler);
    return () => ipcRenderer.removeListener('offline:pin-expired', handler);
  },

  // Listen for authorization state changes
  onAuthorizationChanged: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('offline:authorization-changed', handler);
    return () => ipcRenderer.removeListener('offline:authorization-changed', handler);
  },

  // ─── Face Recognition Auth ───────────────────────────────────
  faceEnroll: (userId, embedding) => ipcRenderer.invoke('face:enroll', { userId, embedding }),
  faceVerify: (userId, embedding) => ipcRenderer.invoke('face:verify', { userId, embedding }),
  faceClear: (userId) => ipcRenderer.invoke('face:clear', { userId }),
  faceEnrollmentStatus: (userId) => ipcRenderer.invoke('face:enrollment-status', { userId }),

  // ─── Camera QR / Barcode Scanner ─────────────────────────────
  // Starts / stops the off-screen camera scanner window.
  // Decoded results arrive via onBarcodeScan (hardware:barcode-scan event)
  // with the same { payload, source } shape as the xPAK hardware scanner.
  cameraStart: () => ipcRenderer.invoke('device:camera-scan-start'),
  cameraStop: () => ipcRenderer.invoke('device:camera-scan-stop'),
  onBarcodeScan: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('hardware:barcode-scan', handler);
    return () => ipcRenderer.removeListener('hardware:barcode-scan', handler);
  },

  // ─── Thermal / connectivity signals ──────────────────────────
  // Fired when the Toughbook's thermal zone exceeds 185°F. No consumer
  // wired yet; exposed so the send isn't dropped with zero listeners.
  onThermalAlert: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('hardware:thermal-alert', handler);
    return () => ipcRenderer.removeListener('hardware:thermal-alert', handler);
  },
  // Fired when the app fails over from WiFi to WWAN. No consumer wired yet;
  // exposed so the send isn't dropped with zero listeners.
  onConnectivityFailover: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('connectivity:failover', handler);
    return () => ipcRenderer.removeListener('connectivity:failover', handler);
  },
});
