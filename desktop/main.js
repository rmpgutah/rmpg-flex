// ============================================================
// RMPG Flex — Electron Main Process
// Wraps the Express server + React client into a native app
// for Windows and macOS.
// ============================================================

const { app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage, ipcMain } = require('electron');
const path = require('path');
const { fork, spawn } = require('child_process');
const http = require('http');
const { AppUpdater } = require('./updater');

// ─── Configuration ──────────────────────────────────────────
const SERVER_PORT = 3001;
const APP_TITLE = 'RMPG Flex — CAD/RMS';
const DEV_MODE = process.argv.includes('--dev');
const UPDATE_SERVER_URL = DEV_MODE
  ? `http://localhost:${SERVER_PORT}`
  : 'github';

let mainWindow = null;
let splashWindow = null;
let tray = null;
let serverProcess = null;
let isQuitting = false;
const appUpdater = new AppUpdater();

// ─── Resolve Paths ──────────────────────────────────────────
function getServerDir() {
  return DEV_MODE
    ? path.join(__dirname, '..', 'server')
    : path.join(process.resourcesPath, 'server');
}

/**
 * In production, C:\Program Files is read-only on Windows.
 * Store writable data (SQLite DB, uploads) in the user's AppData directory.
 * In dev mode, keep using the project-local server/data and server/uploads.
 */
function getUserDataDir() {
  if (DEV_MODE) {
    return path.join(__dirname, '..', 'server', 'data');
  }
  return path.join(app.getPath('userData'), 'data');
}

function getUserUploadsDir() {
  if (DEV_MODE) {
    return path.join(__dirname, '..', 'server', 'uploads');
  }
  return path.join(app.getPath('userData'), 'uploads');
}

function getClientDistDir() {
  return DEV_MODE
    ? path.join(__dirname, '..', 'client', 'dist')
    : path.join(process.resourcesPath, 'client', 'dist');
}

function getIconPath() {
  return DEV_MODE
    ? path.join(__dirname, '..', 'client', 'public', 'favicon.png')
    : path.join(process.resourcesPath, 'icon.png');
}

// ─── Splash Screen ──────────────────────────────────────────
function createSplashWindow() {
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
          border: 3px solid #c41e1e;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 20px;
        }
        .logo-text {
          font-size: 28px;
          font-weight: 900;
          color: #c41e1e;
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
          border-top: 3px solid #c41e1e;
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
      <p class="status" id="status">Starting server...</p>
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

// ─── Server Management ─────────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    const serverDir = getServerDir();
    const serverEntry = path.join(serverDir, 'src', 'index.ts');
    const isWin = process.platform === 'win32';

    // Use writable user-data directory (avoids EPERM on C:\Program Files)
    const dataDir = getUserDataDir();
    const uploadsDir = getUserUploadsDir();
    const fs = require('fs');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log('[SERVER] Created data directory:', dataDir);
    }
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      console.log('[SERVER] Created uploads directory:', uploadsDir);
    }

    // Resolve tsx binary — works in both dev and production
    const tsxBin = path.join(serverDir, 'node_modules', '.bin', isWin ? 'tsx.cmd' : 'tsx');

    console.log('[SERVER] Starting from:', serverDir);
    console.log('[SERVER] Entry:', serverEntry);
    console.log('[SERVER] tsx bin:', tsxBin);
    console.log('[SERVER] tsx exists:', fs.existsSync(tsxBin));
    console.log('[SERVER] Entry exists:', fs.existsSync(serverEntry));
    console.log('[SERVER] Platform:', process.platform, process.arch);
    console.log('[SERVER] Data dir:', dataDir);
    console.log('[SERVER] Uploads dir:', uploadsDir);

    // Collect stderr for error reporting
    let stderrOutput = '';

    // On Windows, spawn with shell: true concatenates args unquoted, so paths
    // containing spaces (e.g. "C:\Program Files\RMPG Flex\...") break.
    // Fix: quote the paths explicitly when using shell mode on Windows.
    const serverEnv = {
      ...process.env,
      NODE_ENV: DEV_MODE ? 'development' : 'production',
      PORT: String(SERVER_PORT),
      HOST: '0.0.0.0',
      CORS_ORIGINS: `http://localhost:${SERVER_PORT},http://127.0.0.1:${SERVER_PORT},http://localhost:5173`,
      RMPG_DATA_DIR: dataDir,
      RMPG_UPLOADS_DIR: uploadsDir,
    };

    if (isWin) {
      // Windows: run cmd.exe /c "tsx.cmd" "serverEntry" with windowsVerbatimArguments
      // This ensures paths with spaces are preserved correctly
      serverProcess = spawn('cmd.exe', ['/c', `"${tsxBin}" "${serverEntry}"`], {
        cwd: serverDir,
        env: serverEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsVerbatimArguments: true,
      });
    } else {
      // macOS / Linux: no quoting issues, spawn directly
      serverProcess = spawn(tsxBin, [serverEntry], {
        cwd: serverDir,
        env: serverEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

    let resolved = false;

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[SERVER]', output.trim());
      if (!resolved && output.includes('RMPG Flex CAD/RMS Server')) {
        resolved = true;
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      stderrOutput += output + '\n';
      // dotenv warnings are normal, don't log as errors
      if (output.includes('[dotenv@') || output.includes('ExperimentalWarning')) {
        console.log('[SERVER]', output);
      } else {
        console.error('[SERVER ERR]', output);
      }
    });

    serverProcess.on('error', (err) => {
      console.error('[SERVER] Failed to spawn:', err);
      if (!resolved) {
        resolved = true;
        reject(new Error(`Failed to start server process: ${err.message}\n\ntsx binary: ${tsxBin}\nServer dir: ${serverDir}`));
      }
    });

    serverProcess.on('exit', (code) => {
      console.log(`[SERVER] Exited with code ${code}`);
      serverProcess = null;
      if (!resolved) {
        resolved = true;
        // Include stderr in error message for debugging
        const errDetail = stderrOutput
          ? `\n\nServer output:\n${stderrOutput.slice(-2000)}`
          : '';
        reject(new Error(`Server exited with code ${code}${errDetail}`));
      }
    });

    // Fallback: poll for server readiness
    let attempts = 0;
    const maxAttempts = 30;
    const pollInterval = setInterval(() => {
      attempts++;
      http.get(`http://localhost:${SERVER_PORT}/api/health`, (res) => {
        if (res.statusCode === 200 && !resolved) {
          clearInterval(pollInterval);
          resolved = true;
          resolve();
        }
      }).on('error', () => {
        if (attempts >= maxAttempts && !resolved) {
          clearInterval(pollInterval);
          resolved = true;
          const errDetail = stderrOutput
            ? `\n\nServer output:\n${stderrOutput.slice(-2000)}`
            : '';
          reject(new Error(`Server failed to start within 30 seconds${errDetail}`));
        }
      });
    }, 1000);
  });
}

function stopServer() {
  if (serverProcess) {
    console.log('[SERVER] Stopping...');
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(serverProcess.pid), '/f', '/t']);
    } else {
      serverProcess.kill('SIGTERM');
      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (serverProcess) {
          try { serverProcess.kill('SIGKILL'); } catch {}
        }
      }, 5000);
    }
    serverProcess = null;
  }
}

// ─── Window Creation ────────────────────────────────────────
function createMainWindow() {
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

  // Load the app
  mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);

  // Show window when ready, close splash
  mainWindow.once('ready-to-show', () => {
    closeSplash();
    mainWindow.show();
    mainWindow.focus();
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http') && !url.includes(`localhost:${SERVER_PORT}`)) {
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
  console.log('[APP] Starting RMPG Flex...');
  console.log('[APP] Mode:', DEV_MODE ? 'development' : 'production');
  console.log('[APP] Platform:', process.platform, process.arch);

  // Show splash screen while server starts
  createSplashWindow();

  try {
    // Check if server is already running (dev mode)
    const serverRunning = await new Promise((resolve) => {
      http.get(`http://localhost:${SERVER_PORT}/api/health`, (res) => {
        resolve(res.statusCode === 200);
      }).on('error', () => resolve(false));
    });

    if (!serverRunning) {
      console.log('[APP] Starting embedded server...');
      await startServer();
      console.log('[APP] Server started successfully');
    } else {
      console.log('[APP] Server already running on port', SERVER_PORT);
    }

    createMenu();
    createMainWindow();
    createTray();

    // Initialize auto-updater after everything is ready
    // In dev mode, checks localhost; in production, checks rmpgutah.us (or UPDATE_SERVER_URL)
    console.log('[APP] Initializing auto-updater with:', UPDATE_SERVER_URL);
    appUpdater.init(UPDATE_SERVER_URL);
  } catch (err) {
    console.error('[APP] Failed to start:', err);
    closeSplash();
    dialog.showErrorBox(
      'RMPG Flex — Startup Error',
      `Failed to start the server.\n\n${err.message}\n\nMake sure port ${SERVER_PORT} is available and try again.`
    );
    app.quit();
  }
});

app.on('activate', () => {
  // macOS: re-create window when dock icon is clicked
  if (mainWindow === null) {
    createMainWindow();
  } else {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  appUpdater.destroy();
  stopServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    isQuitting = true;
    app.quit();
  }
});
