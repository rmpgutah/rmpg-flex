// RMPG Flex — Tauri ↔ Electron Compatibility Bridge
// Injected into the remote webview so the React SPA at rmpgutah.us sees the
// same window.electron API it expects from the Electron preload.
// Phase 1: online-only — hardware/offline/sync methods are no-op stubs.

(function () {
  if (window.electron) return; // already injected (or real Electron)

  const { invoke } = window.__TAURI__.core;

  function noop() { return Promise.resolve(); }
  function noopObj(val) { return () => Promise.resolve(val); }
  function noopUnsub() { return () => {}; }

  window.electron = {
    // ─── Identity ────────────────────────────────────
    platform: navigator.platform.startsWith('Win') ? 'win32' : 'darwin',
    isElectron: true, // SPA feature-detects on this

    // ─── Window controls ─────────────────────────────
    minimize: () => invoke('minimize_window'),
    maximize: () => invoke('maximize_window'),
    close: () => invoke('close_window'),
    toggleFullScreen: () => invoke('toggle_fullscreen'),
    setDockBadge: (count) => invoke('set_dock_badge', { count }),
    flashFrame: () => invoke('flash_frame'),

    // ─── App lifecycle ───────────────────────────────
    getVersion: () => invoke('get_version'),
    forceRefresh: () => invoke('force_refresh'),
    restartApp: () => invoke('restart_app'),

    // ─── System & Diagnostics ────────────────────────
    getSystemInfo: () => invoke('get_system_info'),
    getAppLogs: (lines) => invoke('get_app_logs', { lines: lines || 200 }),
    openLogsFolder: () => invoke('open_logs_folder'),
    checkDiskSpace: () => invoke('check_disk_space'),
    getNetworkInterfaces: () => invoke('get_network_interfaces'),
    getBatteryStatus: () => invoke('get_battery_status'),
    getIdleTime: () => invoke('get_idle_time'),

    // ─── Clipboard ───────────────────────────────────
    getClipboardText: async () => {
      try {
        return await window.__TAURI__.clipboardManager.readText();
      } catch { return ''; }
    },
    setClipboardText: async (text) => {
      try {
        await window.__TAURI__.clipboardManager.writeText(text);
      } catch { /* swallow */ }
    },

    // ─── Notifications ───────────────────────────────
    showNotification: (title, body) => {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body });
      } else if (typeof Notification !== 'undefined') {
        Notification.requestPermission().then((p) => {
          if (p === 'granted') new Notification(title, { body });
        });
      }
    },

    // ─── Power management ────────────────────────────
    keepAwake: () => invoke('keep_awake'),
    allowSleep: () => invoke('allow_sleep'),

    // ─── File dialogs (Tauri plugin) ─────────────────
    saveFileDialog: async (opts) => {
      try {
        const path = await window.__TAURI__.dialog.save(opts);
        return path || null;
      } catch { return null; }
    },
    openFileDialog: async (opts) => {
      try {
        const path = await window.__TAURI__.dialog.open(opts);
        return path || null;
      } catch { return null; }
    },

    // ─── Tray ────────────────────────────────────────
    setTrayStatus: noop,

    // ─── Company Browser ──────────────────────────────
    openCompanyBrowser: (role) => invoke('open_company_browser', { role: role || null }),

    // ─── Secondary windows ──────────────────────────
    openSecondaryWindow: (path, opts) => invoke('open_secondary_window', {
      path,
      width: opts?.width || null,
      height: opts?.height || null,
    }),
    closeSecondaryWindow: (id) => invoke('close_secondary_window', { id }),

    // ─── Device & Hardware (Phase 2 — native) ────────
    listSerialPorts: noopObj([]),
    listAudioDevices: async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = [], outputs = [];
        for (const d of devices) {
          if (d.kind === 'audioinput') inputs.push({ deviceId: d.deviceId, label: d.label });
          else if (d.kind === 'audiooutput') outputs.push({ deviceId: d.deviceId, label: d.label });
        }
        return { inputs, outputs };
      } catch { return { inputs: [], outputs: [] }; }
    },
    listVideoDevices: async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices
          .filter((d) => d.kind === 'videoinput')
          .map((d) => ({ id: d.deviceId, label: d.label }));
      } catch { return []; }
    },
    getBluetoothDevices: noopObj([]),
    checkGpsHardwarePresent: noopObj(false),
    getDockState: noopObj({ docked: false }),
    getWwanStatus: noopObj({ available: false }),
    setAutoLaunch: noop,
    getAutoLaunchState: noopObj({ enabled: false }),
    setKioskShell: noopObj({ ok: false, error: 'Kiosk shell not available in Tauri build' }),
    getKioskShellState: noopObj({ supported: false }),
    registerGlobalShortcut: noop,
    unregisterGlobalShortcut: noop,
    onShortcutTriggered: noopUnsub,
    getDisplays: noopObj([]),
    onBarcodeScanned: noopUnsub,
    printToPdf: () => invoke('print_to_pdf'),
    exportDiagnosticsBundle: noopObj(null),
    getCrashReports: noopObj([]),
    getTpmStatus: noopObj({ available: false }),

    // ─── File I/O ─────────────────────────────────────
    writeExportFile: (path, data) => invoke('write_export_file', { path, data }),
    readImportFile: (path) => invoke('read_import_file', { path }),
    revealInFolder: (path) => invoke('reveal_in_folder', { path }),
    getDownloadsPath: () => invoke('get_downloads_path'),
    getPrinters: () => invoke('get_printers'),
    printSilently: (printerName) => invoke('print_silent', { printerName }),
    exportLocalDbBackup: noop,
    importLocalDbBackup: noop,

    // ─── Geolocation fallback ────────────────────────
    getIpLocation: noop,

    // ─── Internal GPS (Phase 2 — Toughbook serial) ───
    detectInternalGps: noopObj({ found: false }),
    startInternalGps: noop,
    stopInternalGps: noop,
    onInternalGpsUpdate: noopUnsub,
    onInternalGpsError: noopUnsub,

    // ─── Auto-Update ─────────────────────────────────
    onUpdateStatus: (callback) => {
      let unlisten = null;
      if (window.__TAURI__?.event?.listen) {
        window.__TAURI__.event.listen('update-status', (event) => {
          callback(event.payload);
        }).then((fn) => { unlisten = fn; });
      }
      return () => { if (unlisten) unlisten(); };
    },
    checkForUpdates: () => invoke('check_for_updates'),
    installUpdate: () => invoke('install_update'),

    // ─── Recon Connect (Phase 2 — native process) ────
    launchReconConnect: noopObj({ ok: false, error: 'Recon Connect not available in Tauri build' }),
    installReconConnect: noopObj({ ok: false, error: 'Recon Connect not available in Tauri build' }),
    checkReconConnect: noopObj({ installed: false }),
    reconSpawn: noop,
    reconInput: noop,
    reconResize: noop,
    reconKill: noop,
    reconToolSpawn: noop,
    reconToolKill: noop,
    reconToolInstall: noop,
    reconCatalogRun: noop,
    reconCheckBinary: noopObj({ found: false }),
    reconCatalogTerminal: noop,
    reconToolTerminal: noop,
    reconInstallState: noopObj({ installed: false }),
    reconUpdate: noop,
    reconKillAll: noop,
    onReconToolData: noopUnsub,
    onReconToolExit: noopUnsub,
    onReconData: noopUnsub,
    onReconExit: noopUnsub,

    // ─── Auth Session Bridge (Phase 2 — offline) ─────
    storeAuthSession: noop,

    // ─── Offline Mode (Phase 2 — local SQLite) ───────
    localApi: noopObj({ ok: false, error: 'Offline mode not available in Tauri build' }),
    getOfflineState: noopObj({ online: true, authorized: false }),
    enterPin: noopObj({ ok: false }),
    generatePin: noopObj({ ok: false }),
    getSyncStatus: noopObj({ lastPull: null, lastPush: null, queueDepth: 0 }),
    triggerSync: noop,
    pauseSync: noop,
    resumeSync: noop,
    getSyncQueueDetail: noopObj({ pending: [], failed: [] }),
    getOfflineWriteQueueSize: noopObj(0),
    retryFailedSyncItem: noop,
    clearFailedSyncItems: noop,
    getLastSyncError: noopObj(null),
    getLocalCacheStats: noopObj([]),
    clearLocalCache: noop,
    forceFullResync: noop,
    getCachedUser: noopObj(null),
    onConnectivityChange: noopUnsub,
    onSyncProgress: noopUnsub,
    onSyncComplete: noopUnsub,
    onPinExpired: noopUnsub,
    onAuthorizationChanged: noopUnsub,
  };
})();
