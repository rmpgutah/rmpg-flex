// ============================================================
// RMPG Flex — Electron Main Process (Thin Client)
// Loads the RMPG Flex web application from the remote server.
// All data, authentication, and business logic live on the VPS.
// The desktop app provides: native window, system tray, and
// automatic updates via electron-updater.
// ============================================================

const { app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage, ipcMain, net } = require('electron');
const path = require('path');
const { AppUpdater } = require('./updater');
const { initLocalDb, getLocalDb, closeLocalDb, getConfig, setConfig, getQueueDepth, getSyncMeta } = require('./localDb');
const { ConnectivityMonitor } = require('./connectivityMonitor');

// ─── Chromium Geolocation ────────────────────────────────────
// Electron strips Chrome's bundled Google API key. Without it,
// navigator.geolocation silently fails on desktop (no GPS hardware).
// Provide the same key used for Google Maps so Chromium's Network
// Location Provider can resolve WiFi/IP-based positions.
process.env.GOOGLE_API_KEY = 'AIzaSyCfKRUuJkUFlfuc9FvjJiVpm6_p5kASCtM';

// ─── Configuration ──────────────────────────────────────────
const APP_TITLE = 'RMPG Flex — CAD/RMS';
const DEV_MODE = process.argv.includes('--dev');

// Remote server URL — the single source of truth for all data.
// In dev mode, points at the local development server.
// In production, points at the RMPG Flex VPS.
const REMOTE_SERVER_URL = DEV_MODE
  ? 'http://localhost:3001'
  : (process.env.UPDATE_SERVER_URL || 'https://rmpgutah.us');
const UPDATE_SERVER_URL = DEV_MODE
  ? 'http://localhost:3001'
  : 'github';

let mainWindow = null;
let splashWindow = null;
let tray = null;
let isQuitting = false;
let appReady = false;
const appUpdater = new AppUpdater();
let connectivityMonitor = null;

// ─── Single Instance Lock ────────────────────────────────────
// Prevent multiple instances from racing and crashing with
// "Cannot create BrowserWindow before app is ready".
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// These modules are loaded lazily after the local DB is initialized
// (they require localDb to be ready)
let offlineRouter = null;
let syncManager = null;
let pinManager = null;

// ─── Resolve Paths ──────────────────────────────────────────
function getIconPath() {
  return DEV_MODE
    ? path.join(__dirname, '..', 'client', 'public', 'favicon.png')
    : path.join(process.resourcesPath, 'icon.png');
}

// ─── Splash Screen ──────────────────────────────────────────
function createSplashWindow() {
  if (!app.isReady()) { console.warn('[APP] createSplashWindow called before ready — skipping'); return; }
  splashWindow = new BrowserWindow({
    width: 420,
    height: 320,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    center: true,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const splashHTML = `data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #1a1a1a;
          color: #fff;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          border: 1px solid #333;
          border-radius: 12px;
          overflow: hidden;
          -webkit-app-region: drag;
        }
        .logo {
          width: 100px;
          height: 100px;
          border: 3px solid #1a5a9e;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 20px;
        }
        .logo-text {
          font-size: 28px;
          font-weight: 900;
          color: #1a5a9e;
          letter-spacing: 2px;
        }
        h1 {
          font-size: 20px;
          font-weight: 700;
          letter-spacing: 3px;
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .subtitle {
          font-size: 11px;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 2px;
          margin-bottom: 30px;
        }
        .spinner {
          width: 28px;
          height: 28px;
          border: 3px solid #333;
          border-top: 3px solid #1a5a9e;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          margin-bottom: 12px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .status {
          font-size: 10px;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
      </style>
    </head>
    <body>
      <div class="logo"><span class="logo-text">RMPG</span></div>
      <h1>RMPG Flex</h1>
      <p class="subtitle">CAD / RMS Dispatch System</p>
      <div class="spinner"></div>
      <p class="status">Connecting to server...</p>
    </body>
    </html>
  `)}`;

  splashWindow.loadURL(splashHTML);
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

// ─── Server Connectivity Check ──────────────────────────────
/**
 * Verify that the remote RMPG Flex server is reachable.
 * Retries a few times with short delays before giving up.
 */
function checkServerConnectivity() {
  return new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = 5;
    const delayMs = 2000;

    function tryConnect() {
      attempts++;
      console.log(`[APP] Connectivity check attempt ${attempts}/${maxAttempts}: ${REMOTE_SERVER_URL}/api/health`);

      const request = net.request(`${REMOTE_SERVER_URL}/api/health`);

      request.on('response', (response) => {
        if (response.statusCode === 200) {
          console.log('[APP] Server is reachable');
          resolve(true);
        } else if (attempts < maxAttempts) {
          setTimeout(tryConnect, delayMs);
        } else {
          resolve(false);
        }
      });

      request.on('error', (err) => {
        console.log(`[APP] Connection attempt ${attempts} failed:`, err.message);
        if (attempts < maxAttempts) {
          setTimeout(tryConnect, delayMs);
        } else {
          resolve(false);
        }
      });

      request.end();
    }

    tryConnect();
  });
}

// ─── Connection Error Page ──────────────────────────────────
/**
 * HTML page shown when the remote server is unreachable.
 * Includes a retry button that reloads the remote URL.
 */
function getOfflineHTML() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #1a1a1a;
          color: #fff;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          text-align: center;
          padding: 40px;
        }
        .icon {
          font-size: 64px;
          margin-bottom: 24px;
          opacity: 0.6;
        }
        h1 {
          font-size: 22px;
          font-weight: 600;
          margin-bottom: 12px;
          color: #e0e0e0;
        }
        p {
          font-size: 14px;
          color: #888;
          max-width: 400px;
          line-height: 1.6;
          margin-bottom: 32px;
        }
        button {
          padding: 12px 32px;
          font-size: 14px;
          font-weight: 600;
          background: #1a5a9e;
          color: #fff;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        button:hover { background: #14427a; }
        .server-url {
          margin-top: 24px;
          font-size: 11px;
          color: #555;
          font-family: monospace;
        }
      </style>
    </head>
    <body>
      <div class="icon">&#128268;</div>
      <h1>Connection Lost</h1>
      <p>Unable to connect to the RMPG Flex server. Please check your internet connection and try again.</p>
      <button onclick="window.location.href='${REMOTE_SERVER_URL}'">Retry Connection</button>
      <div class="server-url">${REMOTE_SERVER_URL}</div>
    </body>
    </html>
  `)}`;
}

// ─── Window Creation ────────────────────────────────────────
async function createMainWindow() {
  // Guard: BrowserWindow cannot be created before app is ready
  if (!app.isReady()) {
    console.warn('[APP] createMainWindow called before app.isReady — deferring');
    await app.whenReady();
  }
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: APP_TITLE,
    backgroundColor: '#1a1a1a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    // macOS titlebar
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 12, y: 12 },
  });

  // ── Grant geolocation permission automatically ──────────
  // Electron denies geolocation by default. For RMPG Flex, GPS
  // tracking is mandatory for all logged-in users — auto-grant it.
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      const allowed = ['geolocation', 'notifications', 'media'];
      callback(allowed.includes(permission));
    }
  );

  // Also handle the newer permission-check API (Electron 20+)
  mainWindow.webContents.session.setPermissionCheckHandler(
    (_webContents, permission) => {
      if (permission === 'geolocation') return true;
      return false;
    }
  );

  // Clear Chromium HTTP cache before loading — ensures deploys propagate
  // immediately without requiring a manual hard-refresh in the desktop app.
  // (Service workers, localStorage, and IndexedDB are NOT cleared.)
  await mainWindow.webContents.session.clearCache();
  console.log('[APP] HTTP cache cleared');

  // Unregister stale service workers so the latest version installs fresh
  await mainWindow.webContents.session.clearStorageData({ storages: ['serviceworkers'] });
  console.log('[APP] Service workers cleared');

  // Load the remote web application
  console.log('[APP] Loading:', REMOTE_SERVER_URL);
  mainWindow.loadURL(REMOTE_SERVER_URL);

  // Show window when ready, close splash
  mainWindow.once('ready-to-show', () => {
    closeSplash();
    mainWindow.show();
    mainWindow.focus();
  });

  // Handle page load failures (server down, network error)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`[APP] Page load failed: ${errorDescription} (code ${errorCode})`);
    // Show the offline page with a retry button
    mainWindow.loadURL(getOfflineHTML());
  });

  // Extract the server's hostname for link filtering
  let serverHost;
  try {
    serverHost = new URL(REMOTE_SERVER_URL).host;
  } catch {
    serverHost = 'rmpgutah.us';
  }

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http') && !url.includes(serverHost)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Prevent closing — minimize to tray instead
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── IPC Handlers ───────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window:close', () => mainWindow?.close());
ipcMain.handle('app:version', () => app.getVersion());

// ─── IP Geolocation Fallback ─────────────────────────────────
// Desktop machines often lack GPS hardware. When Chromium's
// navigator.geolocation fails, the renderer can call this to get
// an approximate position via Google's Geolocation API (IP-based).
ipcMain.handle('geo:ip-locate', async () => {
  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    const url = `https://www.googleapis.com/geolocation/v1/geolocate?key=${apiKey}`;
    return await new Promise((resolve, reject) => {
      const request = net.request({ method: 'POST', url });
      request.setHeader('Content-Type', 'application/json');
      let body = '';
      request.on('response', (response) => {
        response.on('data', (chunk) => { body += chunk.toString(); });
        response.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.location) {
              resolve({
                latitude: data.location.lat,
                longitude: data.location.lng,
                accuracy: data.accuracy || 5000,
              });
            } else {
              reject(new Error(data.error?.message || 'No location in response'));
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      request.on('error', reject);
      request.write(JSON.stringify({}));
      request.end();
    });
  } catch (err) {
    console.error('[GEO] IP geolocation fallback failed:', err.message);
    return null;
  }
});

// ─── Offline Mode IPC Handlers ──────────────────────────────

// Route an API request through the local SQLite database
ipcMain.handle('offline:api', async (_event, { method, path, body }) => {
  try {
    if (!offlineRouter) return { status: 503, error: 'Offline mode not initialized' };
    return offlineRouter.handle(method, path, body);
  } catch (err) {
    console.error('[OFFLINE:API] Error:', err.message);
    return { status: 500, error: err.message };
  }
});

// Get current offline/authorization state
ipcMain.handle('offline:state', () => {
  try {
    const db = getLocalDb();
    const isOnline = connectivityMonitor ? connectivityMonitor.isOnline : true;

    // Check for active PIN session for the current cached user
    const cachedUserId = getConfig('current_user_id');
    const cachedRole = getConfig('current_user_role');
    let isLocalAuthorized = false;
    let expiresAt = null;

    // Admin always has local access
    if (cachedRole === 'admin') {
      isLocalAuthorized = true;
    } else if (cachedUserId) {
      // Check for active PIN session
      const session = db.prepare(
        `SELECT expires_at FROM pin_sessions
         WHERE user_id = ? AND is_active = 1 AND expires_at > ?
         ORDER BY expires_at DESC LIMIT 1`
      ).get(cachedUserId, new Date().toISOString());
      if (session) {
        isLocalAuthorized = true;
        expiresAt = session.expires_at;
      }
    }

    return {
      isOnline,
      isLocalAuthorized,
      expiresAt,
      role: cachedRole || null,
      syncQueueDepth: getQueueDepth(),
    };
  } catch (err) {
    console.error('[OFFLINE:STATE] Error:', err.message);
    return { isOnline: true, isLocalAuthorized: false, expiresAt: null, role: null, syncQueueDepth: 0 };
  }
});

// Employee enters a PIN to unlock 24h local writes
ipcMain.handle('offline:enter-pin', (_event, { pin }) => {
  try {
    if (!pinManager) return { success: false, error: 'PIN system not initialized' };
    return pinManager.validatePin(pin);
  } catch (err) {
    console.error('[OFFLINE:PIN] Error:', err.message);
    return { success: false, error: err.message };
  }
});

// Admin generates a PIN for an employee
ipcMain.handle('offline:generate-pin', (_event, { userId }) => {
  try {
    if (!pinManager) return { error: 'PIN system not initialized' };
    return pinManager.generatePinForUser(userId);
  } catch (err) {
    console.error('[OFFLINE:GENERATE-PIN] Error:', err.message);
    return { error: err.message };
  }
});

// Get sync status
ipcMain.handle('offline:sync-status', () => {
  try {
    const tables = ['users', 'clients', 'properties', 'calls_for_service', 'units', 'incidents', 'persons', 'vehicles_records'];
    const status = {};
    for (const t of tables) {
      status[t] = getSyncMeta(t);
    }
    return {
      tables: status,
      queueDepth: getQueueDepth(),
      isSyncing: syncManager ? syncManager.isSyncing : false,
      lastPush: syncManager ? syncManager.lastPushAt : null,
    };
  } catch (err) {
    console.error('[OFFLINE:SYNC-STATUS] Error:', err.message);
    return { tables: {}, queueDepth: 0, isSyncing: false, lastPush: null };
  }
});

// Force an immediate sync cycle
ipcMain.handle('offline:trigger-sync', async () => {
  try {
    if (syncManager && connectivityMonitor?.isOnline) {
      await syncManager.pullAll();
      return { success: true };
    }
    return { success: false, error: 'Sync not available (offline or not initialized)' };
  } catch (err) {
    console.error('[OFFLINE:TRIGGER-SYNC] Error:', err.message);
    return { success: false, error: err.message };
  }
});

// Get locally cached user for offline authentication
ipcMain.handle('offline:get-cached-user', (_event, { username }) => {
  try {
    const db = getLocalDb();
    const user = db.prepare(
      `SELECT id, username, password_hash, first_name, last_name, full_name,
              email, role, badge_number, phone, status, avatar_url, created_at
       FROM users WHERE username = ? AND status = 'active'`
    ).get(username);
    return user || null;
  } catch (err) {
    console.error('[OFFLINE:CACHED-USER] Error:', err.message);
    return null;
  }
});

// ─── Application Menu ───────────────────────────────────────
function createMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { isQuitting = true; app.quit(); } },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.webContents.reload(),
        },
        {
          label: 'Clear Cache & Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: async () => {
            if (mainWindow) {
              await mainWindow.webContents.session.clearCache();
              await mainWindow.webContents.session.clearStorageData({ storages: ['serviceworkers'] });
              mainWindow.webContents.reload();
            }
          },
        },
        { type: 'separator' },
        {
          label: isMac ? 'Close Window' : 'Quit',
          accelerator: isMac ? 'CmdOrCtrl+W' : 'Alt+F4',
          click: () => {
            if (isMac) {
              mainWindow?.hide();
            } else {
              isQuitting = true;
              app.quit();
            }
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
        ] : [
          { role: 'close' },
        ]),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── System Tray ────────────────────────────────────────────
function createTray() {
  const iconPath = getIconPath();

  try {
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show RMPG Flex',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);

    tray.setToolTip(APP_TITLE);
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.focus();
        } else {
          mainWindow.show();
        }
      }
    });
  } catch (err) {
    console.warn('[TRAY] Could not create system tray icon:', err.message);
  }
}

// ─── App Lifecycle ──────────────────────────────────────────
app.whenReady().then(async () => {
  appReady = true;
  console.log('[APP] Starting RMPG Flex...');
  console.log('[APP] Mode:', DEV_MODE ? 'development' : 'production');
  console.log('[APP] Platform:', process.platform, process.arch);
  console.log('[APP] Server:', REMOTE_SERVER_URL);

  // Show splash screen while connecting
  createSplashWindow();

  try {
    // Initialize local database for offline support
    initLocalDb();

    // Check server connectivity before loading the app
    const isReachable = await checkServerConnectivity();

    if (!isReachable) {
      console.warn('[APP] Server unreachable — will show offline page');
    }

    createMenu();
    await createMainWindow();
    createTray();

    // Initialize auto-updater
    console.log('[APP] Initializing auto-updater with:', REMOTE_SERVER_URL);
    appUpdater.init(REMOTE_SERVER_URL);

    // Initialize offline modules (lazy-loaded after local DB is ready)
    try {
      offlineRouter = require('./offlineRouter');
      pinManager = require('./pinManager');
      pinManager.init(mainWindow);
      syncManager = require('./syncManager');
      console.log('[APP] Offline modules loaded');
    } catch (err) {
      console.warn('[APP] Offline modules not yet available:', err.message);
    }

    // Start connectivity monitor
    connectivityMonitor = new ConnectivityMonitor(REMOTE_SERVER_URL);
    connectivityMonitor.isOnline = isReachable; // Set initial state from startup check
    connectivityMonitor.start(mainWindow, (nowOnline) => {
      console.log(`[APP] Connectivity transition → ${nowOnline ? 'ONLINE' : 'OFFLINE'}`);
      // When coming back online, trigger push sync
      if (nowOnline && syncManager && syncManager.pushAll) {
        syncManager.pushAll().catch(err => {
          console.error('[APP] Push sync on reconnect failed:', err.message);
        });
      }
    });

    // Start background pull sync if online
    if (isReachable && syncManager && syncManager.startPullSchedule) {
      syncManager.startPullSchedule(REMOTE_SERVER_URL, mainWindow);
    }
  } catch (err) {
    console.error('[APP] Failed to start:', err);
    closeSplash();
    dialog.showErrorBox(
      'RMPG Flex — Startup Error',
      `Failed to start RMPG Flex.\n\n${err.message}\n\nPlease check your internet connection and try again.`
    );
    app.quit();
  }
});

app.on('activate', async () => {
  // macOS: re-create window when dock icon is clicked.
  // Guard against activate firing before app is fully ready —
  // BrowserWindow cannot be created until app.whenReady() resolves.
  if (!appReady) return;
  if (mainWindow === null) {
    await createMainWindow();
  } else {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  appUpdater.destroy();

  // Clean up offline modules
  if (connectivityMonitor) connectivityMonitor.stop();
  if (syncManager && syncManager.stopPullSchedule) syncManager.stopPullSchedule();
  if (pinManager && pinManager.destroy) pinManager.destroy();
  closeLocalDb();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    isQuitting = true;
    app.quit();
  }
});
