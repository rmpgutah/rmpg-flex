// RMPG Flex — Tauri ↔ Electron Compatibility Bridge
// Injected into the remote webview so the React SPA at rmpgutah.us sees the
// same window.electron API it expects from the Electron preload.

(function () {
  if (window.electron) return; // already injected (or real Electron)

  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;

  function noop() { return Promise.resolve(); }
  function noopObj(val) { return () => Promise.resolve(val); }

  function tauriListen(eventName, callback) {
    let unlisten = null;
    listen(eventName, (event) => callback(event.payload))
      .then((fn) => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  }

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
    setTrayStatus: (state) => invoke('set_tray_status', { state }),

    // ─── Company Browser ──────────────────────────────
    openCompanyBrowser: (role) => invoke('open_company_browser', { role: role || null }),

    // ─── Secondary windows ──────────────────────────
    openSecondaryWindow: (path, opts) => invoke('open_secondary_window', {
      path,
      width: opts?.width || null,
      height: opts?.height || null,
    }),
    closeSecondaryWindow: (id) => invoke('close_secondary_window', { id }),

    // ─── Device & Hardware ───────────────────────────
    listSerialPorts: () => invoke('list_serial_ports'),
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
    checkGpsHardwarePresent: () => invoke('detect_internal_gps').then((r) => r.found).catch(() => false),
    getDockState: noopObj({ docked: false }),
    getWwanStatus: noopObj({ available: false }),
    setAutoLaunch: (enabled) => invoke('set_auto_launch', { enabled }),
    getAutoLaunchState: () => invoke('get_auto_launch_state'),
    setKioskShell: (enabled) => invoke('set_kiosk_shell', { enabled }),
    getKioskShellState: () => invoke('get_kiosk_shell_state'),
    registerGlobalShortcut: noop,
    unregisterGlobalShortcut: noop,
    onShortcutTriggered: () => () => {},
    getDisplays: () => invoke('get_displays'),
    onBarcodeScanned: (callback) => {
      const BARCODE_MAX_GAP_MS = 30;
      const BARCODE_MIN_CHARS = 3;
      let buffer = [];
      let timestamps = [];
      let resetTimer = null;

      const handler = (e) => {
        const now = performance.now();
        if (e.key === 'Enter' && buffer.length >= BARCODE_MIN_CHARS) {
          const allFast = timestamps.every((t, i) =>
            i === 0 || (t - timestamps[i - 1]) < BARCODE_MAX_GAP_MS
          );
          if (allFast) {
            e.preventDefault();
            e.stopPropagation();
            callback(buffer.join(''));
          }
          buffer = [];
          timestamps = [];
          clearTimeout(resetTimer);
          return;
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
          buffer.push(e.key);
          timestamps.push(now);
          clearTimeout(resetTimer);
          resetTimer = setTimeout(() => { buffer = []; timestamps = []; }, 200);
        }
      };

      document.addEventListener('keydown', handler, true);
      return () => document.removeEventListener('keydown', handler, true);
    },
    printToPdf: () => invoke('print_to_pdf'),
    exportDiagnosticsBundle: () => invoke('export_diagnostics_bundle'),
    getCrashReports: () => invoke('get_crash_reports'),
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
    getIpLocation: () => invoke('get_ip_location'),

    // ─── Internal GPS (Toughbook serial) ─────────────
    detectInternalGps: () => invoke('detect_internal_gps'),
    startInternalGps: () => invoke('start_internal_gps'),
    stopInternalGps: () => invoke('stop_internal_gps'),
    onInternalGpsUpdate: (callback) => tauriListen('geo:internal-gps-update', callback),
    onInternalGpsError: (callback) => tauriListen('geo:internal-gps-error', callback),

    // ─── Auto-Update ─────────────────────────────────
    onUpdateStatus: (callback) => tauriListen('update-status', callback),
    checkForUpdates: () => invoke('check_for_updates'),
    installUpdate: () => invoke('install_update'),

    // ─── Recon Connect ───────────────────────────────
    launchReconConnect: () => invoke('launch_recon_connect'),
    installReconConnect: () => invoke('install_recon_connect'),
    checkReconConnect: () => invoke('check_recon_connect'),
    reconSpawn: (opts) => invoke('recon_spawn', { opts: opts || null }),
    reconInput: (sessionId, data) => invoke('recon_input', { sessionId, data }),
    reconResize: noop,
    reconKill: (sessionId) => invoke('recon_kill', { sessionId }),
    reconToolSpawn: (opts) => invoke('recon_spawn', { opts: opts || null }),
    reconToolKill: (sessionId) => invoke('recon_kill', { sessionId }),
    reconToolInstall: () => invoke('install_recon_connect'),
    reconCatalogRun: noop,
    reconCheckBinary: () => invoke('check_recon_connect').then((r) => ({ found: r.installed })),
    reconCatalogTerminal: noop,
    reconToolTerminal: noop,
    reconInstallState: () => invoke('recon_install_state'),
    reconUpdate: () => invoke('recon_update'),
    reconKillAll: () => invoke('recon_kill_all'),
    onReconToolData: (callback) => tauriListen('recon:term-data', callback),
    onReconToolExit: (callback) => tauriListen('recon:term-exit', callback),
    onReconData: (callback) => tauriListen('recon:term-data', callback),
    onReconExit: (callback) => tauriListen('recon:term-exit', callback),

    // ─── Auth Session Bridge (offline) ───────────────
    storeAuthSession: (session) => invoke('store_auth_session', { session }),

    // ─── Offline Mode (local SQLite) ─────────────────
    localApi: (method, path, body) => invoke('local_api', { method, path, body: body || null }),
    getOfflineState: () => invoke('get_offline_state'),
    enterPin: (userId, pin) => invoke('enter_pin', { userId, pin }),
    generatePin: (userId, secret) => invoke('generate_pin', { userId, secret }),
    getSyncStatus: () => invoke('get_sync_status'),
    triggerSync: () => invoke('trigger_sync'),
    pauseSync: () => invoke('pause_sync'),
    resumeSync: () => invoke('resume_sync'),
    getSyncQueueDetail: () => invoke('get_sync_queue_detail'),
    getOfflineWriteQueueSize: () => invoke('get_offline_write_queue_size'),
    retryFailedSyncItem: (id) => invoke('retry_failed_sync_item', { id }),
    clearFailedSyncItems: () => invoke('clear_failed_sync_items'),
    getLastSyncError: () => invoke('get_last_sync_error'),
    getLocalCacheStats: () => invoke('get_local_cache_stats'),
    clearLocalCache: () => invoke('clear_local_cache'),
    forceFullResync: () => invoke('force_full_resync'),
    getCachedUser: (userId) => invoke('get_cached_user', { userId }),
    onConnectivityChange: (callback) => tauriListen('offline:connectivity-change', callback),
    onSyncProgress: (callback) => tauriListen('offline:sync-progress', callback),
    onSyncComplete: (callback) => tauriListen('offline:sync-complete', callback),
    onPinExpired: (callback) => tauriListen('offline:pin-expired', callback),
    onAuthorizationChanged: (callback) => tauriListen('offline:auth-changed', callback),
  };
})();
