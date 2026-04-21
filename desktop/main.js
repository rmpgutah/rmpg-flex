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
          background: #000000;
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
          border: 3px solid #5a5a5a;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 20px;
        }
        .logo-text {
          font-size: 28px;
          font-weight: 900;
          color: #d7d7d7;
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
          border-top: 3px solid #d7d7d7;
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
          background: #000000;
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
          background: #2a2a2a;
          color: #fff;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        button:hover { background: #3a3a3a; }
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
    backgroundColor: '#000000',
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
      const allowed = ['geolocation', 'notifications', 'media'];
      return allowed.includes(permission);
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

// ─── Recon Connect launcher ───────────────────────────────
// Spawns the locally-installed toolkit in a detached terminal window. The
// Python CLI lives outside Flex; we only hand off — no stdio piping, no
// privilege delegation. Returns { ok, error? } so the renderer can show
// a copy-command fallback if the binary isn't installed.
ipcMain.handle('recon:launch', async () => {
  const os = require('os');
  const { spawn } = require('child_process');
  const fs = require('fs');
  const platform = process.platform;
  const home = os.homedir();
  try {
    if (platform === 'linux') {
      if (!fs.existsSync('/usr/bin/hackingtool') && !fs.existsSync('/usr/local/bin/hackingtool')) {
        return { ok: false, error: 'Recon Connect is not installed. Run the install command shown on the page.' };
      }
      const term = process.env.TERMINAL || 'x-terminal-emulator';
      spawn(term, ['-e', 'hackingtool'], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true };
    }
    if (platform === 'darwin') {
      const dir = path.join(home, 'recon-connect');
      if (!fs.existsSync(dir)) {
        return { ok: false, error: `Recon Connect is not installed at ${dir}.` };
      }
      const cmd = `cd "${dir}" && source venv/bin/activate && python3 "$(ls hackingtool.py 'recon connect.py' 2>/dev/null | head -1)"`;
      const appleScript = `tell application "Terminal" to do script "${cmd.replace(/"/g, '\\"')}"`;
      spawn('osascript', ['-e', appleScript], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true };
    }
    if (platform === 'win32') {
      const dir = path.join(home, 'recon-connect');
      if (!fs.existsSync(dir)) {
        return { ok: false, error: `Recon Connect is not installed at ${dir}.` };
      }
      const cmd = `cd /d "${dir}" && venv\\Scripts\\activate && (if exist hackingtool.py (python hackingtool.py) else (python "recon connect.py"))`;
      spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', cmd], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true };
    }
    return { ok: false, error: `Unsupported platform: ${platform}` };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'Launch failed' };
  }
});

// ─── In-app terminal bridge (xterm.js ↔ child_process) ───
// Streams stdout/stderr back to the renderer and forwards keystrokes as
// stdin. Not a full PTY — arrow keys, tab completion, and colored output
// may be limited — but sufficient for menu-driven Python CLIs.
const reconSessions = new Map(); // sessionId -> child process

function reconShellCommand(mode) {
  const os = require('os');
  const home = os.homedir();
  const platform = process.platform;
  if (mode === 'install') {
    if (platform === 'linux') {
      return { shell: 'bash', args: ['-c', 'curl -sSL https://raw.githubusercontent.com/Z4nzu/hackingtool/master/install.sh | sudo bash; echo "[install finished]"'] };
    }
    if (platform === 'darwin') {
      const dir = path.join(home, 'recon-connect');
      const script = `
set -e
echo "[1/7] Checking Homebrew..."
if ! command -v brew >/dev/null; then echo "ERROR: Homebrew required — install from https://brew.sh"; exit 1; fi
echo "      ✓ brew found: $(brew --version | head -1)"

echo "[2/7] Ensuring Python 3.12 (hackingtool requires 3.10+ and 3.14 has known issues)..."
if [ -x /opt/homebrew/opt/python@3.12/bin/python3.12 ]; then
  echo "      ✓ python3.12 ready"
else
  echo "      → brew install python@3.12 (1-2 min)"
  brew install python@3.12
fi
PYBIN=/opt/homebrew/opt/python@3.12/bin/python3.12
echo "      using: $($PYBIN --version)"

echo "[3/7] Ensuring git..."
if command -v git >/dev/null; then
  echo "      ✓ git ready: $(git --version)"
else
  echo "      → brew install git"
  brew install git
fi

echo "[4/7] Cloning repository..."
if [ -d "${dir}/.git" ]; then
  echo "      ✓ already cloned at ${dir}"
else
  git clone --progress https://github.com/Z4nzu/hackingtool.git "${dir}"
fi
cd "${dir}"

echo "[5/7] Creating venv with Python 3.12..."
VENV_PY=""
if [ -x venv/bin/python3 ]; then
  VENV_PY=$(venv/bin/python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "")
fi
if [ "$VENV_PY" = "3.12" ] || [ "$VENV_PY" = "3.13" ]; then
  echo "      ✓ venv already uses Python $VENV_PY"
else
  [ -d venv ] && echo "      → rebuilding venv (was Python $VENV_PY)" && rm -rf venv
  $PYBIN -m venv venv
fi
source venv/bin/activate

echo "[6/7] Upgrading pip..."
python -m pip install --upgrade pip

echo "[7/7] Installing requirements (this is the slowest step — 2-5 min)..."
pip install --progress-bar=on -r requirements.txt

echo ""
echo "==================================================="
echo "✓ Recon Connect installed at ${dir}"
echo "  Click 'Run Recon Connect' to launch."
echo "==================================================="
`.trim();
      return { shell: 'bash', args: ['-c', script] };
    }
    if (platform === 'win32') {
      const dir = path.join(home, 'recon-connect');
      const script = [
        `where git >nul 2>nul || (echo Git for Windows required & exit /b 1)`,
        `where python >nul 2>nul || (echo Python 3.10+ required & exit /b 1)`,
        `if not exist "${dir}" git clone https://github.com/Z4nzu/hackingtool.git "${dir}"`,
        `cd /d "${dir}"`,
        `if not exist venv python -m venv venv`,
        `call venv\\Scripts\\activate`,
        `python -m pip install --upgrade pip`,
        `pip install -r requirements.txt`,
        `echo [installed at ${dir}]`,
      ].join(' && ');
      return { shell: 'cmd.exe', args: ['/c', script] };
    }
  }
  // launch
  if (platform === 'linux') {
    return { shell: 'hackingtool', args: [] };
  }
  if (platform === 'darwin') {
    const dir = path.join(home, 'recon-connect');
    const script = `cd "${dir}" && source venv/bin/activate && exec python3 "$(ls hackingtool.py 'recon connect.py' 2>/dev/null | head -1)"`;
    return { shell: 'bash', args: ['-c', script] };
  }
  if (platform === 'win32') {
    const dir = path.join(home, 'recon-connect');
    const script = `cd /d "${dir}" && call venv\\Scripts\\activate && (if exist hackingtool.py (python hackingtool.py) else (python "recon connect.py"))`;
    return { shell: 'cmd.exe', args: ['/c', script] };
  }
  return null;
}

ipcMain.handle('recon:term-spawn', async (event, { mode } = {}) => {
  const { spawn } = require('child_process');
  const crypto = require('crypto');
  const fs = require('fs');
  const os = require('os');
  const platform = process.platform;

  if (mode === 'launch') {
    const dir = path.join(os.homedir(), 'recon-connect');
    const linuxInstalled = platform === 'linux' && (fs.existsSync('/usr/bin/hackingtool') || fs.existsSync('/usr/local/bin/hackingtool'));
    const darwinOrWin = (platform === 'darwin' || platform === 'win32') && fs.existsSync(dir);
    if (!linuxInstalled && !darwinOrWin) {
      return { ok: false, error: `Recon Connect is not installed. Click "Install" first.` };
    }
  }

  const cmd = reconShellCommand(mode);
  if (!cmd) return { ok: false, error: `Unsupported platform: ${platform}` };

  try {
    // Electron apps launched from /Applications inherit a minimal PATH
    // that excludes Homebrew. Prepend the common dev-tool locations so
    // `brew`, `python3.12`, `git`, etc. resolve without the user having
    // to configure a login shell.
    const pathParts = [
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/opt/homebrew/opt/python@3.12/bin',
      '/usr/local/bin',
      '/usr/local/sbin',
      process.env.PATH || '',
    ].filter(Boolean);
    const child = spawn(cmd.shell, cmd.args, {
      env: {
        ...process.env,
        PATH: pathParts.join(':'),
        PYTHONUNBUFFERED: '1',
        PIP_NO_INPUT: '1',
        PIP_DISABLE_PIP_VERSION_CHECK: '1',
        HOMEBREW_NO_AUTO_UPDATE: '1',
        HOMEBREW_NO_INSTALL_CLEANUP: '1',
        TERM: 'xterm-256color',
        FORCE_COLOR: '1',
      },
      cwd: os.homedir(),
    });
    const sessionId = crypto.randomUUID();
    reconSessions.set(sessionId, child);
    const send = (data) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) {
        event.sender.send('recon:term-data', { sessionId, data });
      }
    };
    child.stdout.on('data', (b) => send(b.toString('utf8')));
    child.stderr.on('data', (b) => send(b.toString('utf8')));
    child.on('exit', (code) => {
      reconSessions.delete(sessionId);
      if (!event.sender.isDestroyed()) {
        event.sender.send('recon:term-exit', { sessionId, code });
      }
    });
    child.on('error', (err) => {
      send(`\r\n[spawn error] ${err.message}\r\n`);
    });
    return { ok: true, sessionId };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'Spawn failed' };
  }
});

ipcMain.on('recon:term-input', (_event, { sessionId, data }) => {
  const child = reconSessions.get(sessionId);
  if (child && !child.killed) {
    try { child.stdin.write(data); } catch { /* pipe closed */ }
  }
});

ipcMain.on('recon:term-resize', (_event, _payload) => {
  // No-op without a PTY — size is cosmetic for piped stdio.
});

// ─── Tool registry (Wireless Attacks pilot) ──────────────
// toolId → { command, buildArgs(formArgs) } so the renderer never
// interpolates arbitrary strings into a shell. Everything goes through
// spawn() with an argv array, no shell:true.
const RECON_TOOLS = {
  // macOS-native: list nearby wifi networks via Apple's airport utility
  'wifi-scan': {
    title: 'Nearby WiFi Networks',
    command: '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport',
    buildArgs: () => ['-s'],
    platform: ['darwin'],
  },
  // Current connected WiFi details
  'wifi-info': {
    title: 'Current WiFi Network',
    command: 'networksetup',
    buildArgs: () => ['-getairportnetwork', 'en0'],
    platform: ['darwin'],
  },
  // Bluetooth inventory
  'bluetooth-scan': {
    title: 'Bluetooth Devices',
    command: 'system_profiler',
    buildArgs: () => ['SPBluetoothDataType'],
    platform: ['darwin'],
  },
  // Local subnet host discovery via arp cache (no root needed)
  'local-network': {
    title: 'Local Network Hosts (ARP)',
    command: 'arp',
    buildArgs: () => ['-an'],
    platform: ['darwin', 'linux'],
  },
  // Port scan — uses nmap if installed, requires explicit target
  'port-scan': {
    title: 'Port Scan (nmap)',
    command: 'nmap',
    buildArgs: ({ target }) => {
      if (!target || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(target) && !/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(target)) {
        throw new Error('Target must be a hostname or IP/CIDR (no shell metacharacters).');
      }
      return ['-sT', '-Pn', '-T4', '--top-ports', '100', target];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'nmap',
  },

  // ─── Exploitation category ──────────────────────────
  // Pure read-only vulnerability identification — no payload execution.
  'cve-lookup': {
    title: 'CVE Lookup (NVD)',
    command: 'curl',
    buildArgs: ({ cve }) => {
      if (!/^CVE-\d{4}-\d{4,}$/i.test(cve || '')) {
        throw new Error('Enter a CVE ID like CVE-2024-3094.');
      }
      return ['-sfL', '-H', 'Accept: application/json', `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${cve.toUpperCase()}`];
    },
    platform: ['darwin', 'linux', 'win32'],
  },
  'cve-search': {
    title: 'CVE Keyword Search',
    command: 'curl',
    buildArgs: ({ keyword }) => {
      if (!/^[a-zA-Z0-9 .+_-]{2,64}$/.test(keyword || '')) {
        throw new Error('Keyword must be 2-64 chars: letters, digits, spaces, .+_-');
      }
      const q = encodeURIComponent(keyword);
      return ['-sfL', '-H', 'Accept: application/json', `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${q}&resultsPerPage=20`];
    },
    platform: ['darwin', 'linux', 'win32'],
  },
  'searchsploit': {
    title: 'SearchSploit',
    command: 'searchsploit',
    buildArgs: ({ query }) => {
      if (!/^[a-zA-Z0-9 ._+-]{1,128}$/.test(query || '')) {
        throw new Error('Query must be 1-128 chars: letters, digits, spaces, ._+-');
      }
      // split on whitespace so each term is its own argv entry
      return ['--no-color', ...query.split(/\s+/).filter(Boolean)];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'exploitdb',
  },
  'nmap-vuln': {
    title: 'Nmap Vulnerability Scan',
    command: 'nmap',
    buildArgs: ({ target }) => {
      const hostRe = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
      const ipRe = /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/;
      if (!target || (!hostRe.test(target) && !ipRe.test(target))) {
        throw new Error('Target must be a hostname or IP/CIDR.');
      }
      return ['-sV', '--script', 'vuln', '-Pn', '-T4', target];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'nmap',
  },
  'nikto-scan': {
    title: 'Nikto Web Scan',
    command: 'nikto',
    buildArgs: ({ url }) => {
      if (!/^https?:\/\/[a-zA-Z0-9][a-zA-Z0-9._-]*(:\d+)?(\/[^\s]*)?$/.test(url || '')) {
        throw new Error('URL must be http(s)://hostname[:port][/path], no shell metacharacters.');
      }
      return ['-h', url, '-ask', 'no'];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'nikto',
  },
  'httpx-fingerprint': {
    title: 'HTTPX Fingerprint',
    command: 'httpx',
    buildArgs: ({ url }) => {
      if (!/^https?:\/\/[a-zA-Z0-9][a-zA-Z0-9._-]*(:\d+)?(\/[^\s]*)?$/.test(url || '')) {
        throw new Error('URL must be http(s)://hostname[:port][/path], no shell metacharacters.');
      }
      return ['-u', url, '-title', '-tech-detect', '-status-code', '-server', '-no-color'];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'httpx',
  },
  'sqlmap': {
    title: 'SQLMap',
    command: 'sqlmap',
    buildArgs: ({ url }) => {
      if (!/^https?:\/\/[a-zA-Z0-9][a-zA-Z0-9._-]*(:\d+)?(\/[^\s?=&+.,%/-]*)?(\?[a-zA-Z0-9_=&%.+-]+)?$/.test(url || '')) {
        throw new Error('URL must be http(s)://hostname[/path][?param=value], no shell metacharacters.');
      }
      return ['-u', url, '--batch', '--level=1', '--risk=1'];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'sqlmap',
  },
  'gobuster-dir': {
    title: 'Gobuster Directory Brute',
    command: 'gobuster',
    buildArgs: ({ url }) => {
      const fs = require('fs');
      if (!/^https?:\/\/[a-zA-Z0-9][a-zA-Z0-9._-]*(:\d+)?(\/[^\s]*)?$/.test(url || '')) {
        throw new Error('URL must be http(s)://hostname[:port][/path].');
      }
      // Try multiple known wordlist locations; fall back to seclists install hint
      const candidates = [
        '/opt/homebrew/share/seclists/Discovery/Web-Content/common.txt',
        '/opt/homebrew/share/seclists/Discovery/Web-Content/directory-list-2.3-small.txt',
        '/opt/homebrew/share/dirb/wordlists/common.txt',
        '/usr/share/seclists/Discovery/Web-Content/common.txt',
        '/usr/share/dirb/wordlists/common.txt',
        '/usr/share/wordlists/dirb/common.txt',
      ];
      const wordlist = candidates.find((p) => fs.existsSync(p));
      if (!wordlist) {
        throw new Error('No wordlist found. Click Install to fetch seclists (brew install seclists).');
      }
      // --wildcard: modern SPAs serve 200 for all paths; allow gobuster
      //             to proceed and surface real paths by unique length.
      return ['dir', '-u', url, '-w', wordlist, '--no-color', '-t', '20', '--timeout', '10s', '--wildcard'];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'seclists',
  },
  'sslscan': {
    title: 'SSL/TLS Scan',
    command: 'sslscan',
    buildArgs: ({ target }) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*(:\d+)?$/.test(target || '')) {
        throw new Error('Target must be hostname[:port].');
      }
      return ['--no-colour', target];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'sslscan',
  },
  'testssl': {
    title: 'testssl.sh',
    command: 'testssl',
    buildArgs: ({ target }) => {
      if (!/^([a-zA-Z0-9][a-zA-Z0-9._-]*(:\d+)?|https?:\/\/[a-zA-Z0-9][a-zA-Z0-9._-]*(:\d+)?(\/[^\s]*)?)$/.test(target || '')) {
        throw new Error('Target must be hostname[:port] or https URL.');
      }
      return ['--color', '0', '--quiet', target];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'testssl',
  },
  // ─── OSINT ──────────────────────────────────────────
  'whois': {
    title: 'WHOIS Lookup',
    command: 'whois',
    buildArgs: ({ target }) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(target || '') && !/^\d{1,3}(\.\d{1,3}){3}$/.test(target || '')) {
        throw new Error('Target must be a domain or IP.');
      }
      return [target];
    },
    platform: ['darwin', 'linux'],
  },
  'dig-dns': {
    title: 'DNS Records (dig)',
    command: 'dig',
    buildArgs: ({ target }) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(target || '')) throw new Error('Target must be a domain.');
      return ['+noall', '+answer', 'ANY', target];
    },
    platform: ['darwin', 'linux'],
  },
  'sherlock': {
    title: 'Sherlock (Username Search)',
    command: 'sherlock',
    buildArgs: ({ username }) => {
      if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username || '')) throw new Error('Username: 1-64 chars letters/digits/._-');
      return ['--no-color', '--print-found', '--timeout', '10', username];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'sherlock',
  },
  'theharvester': {
    title: 'theHarvester (Email/Subdomain)',
    command: 'theHarvester',
    buildArgs: ({ domain }) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(domain || '')) throw new Error('Domain required.');
      return ['-d', domain, '-l', '100', '-b', 'crtsh,duckduckgo,bing'];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'theharvester',
  },
  'holehe': {
    title: 'Holehe (Email → Accounts)',
    command: 'holehe',
    buildArgs: ({ email }) => {
      if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email || '')) throw new Error('Valid email required.');
      return ['--only-used', '--no-color', email];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'holehe',
  },

  // ─── Web Recon ─────────────────────────────────────
  'subfinder': {
    title: 'Subfinder (Subdomain Enum)',
    command: 'subfinder',
    buildArgs: ({ domain }) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(domain || '')) throw new Error('Domain required.');
      return ['-d', domain, '-silent', '-no-color'];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'subfinder',
  },
  'nuclei': {
    title: 'Nuclei (Vuln Templates)',
    command: 'nuclei',
    buildArgs: ({ url }) => {
      if (!/^https?:\/\/[a-zA-Z0-9][a-zA-Z0-9._-]*(:\d+)?(\/[^\s]*)?$/.test(url || '')) throw new Error('Valid URL required.');
      return ['-u', url, '-silent', '-no-color', '-severity', 'medium,high,critical'];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'nuclei',
  },
  'wafw00f': {
    title: 'WAFW00F (WAF Detection)',
    command: 'wafw00f',
    buildArgs: ({ url }) => {
      if (!/^https?:\/\/[a-zA-Z0-9][a-zA-Z0-9._-]*(:\d+)?(\/[^\s]*)?$/.test(url || '')) throw new Error('Valid URL required.');
      return ['-a', url];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'wafw00f',
  },
  'ffuf': {
    title: 'ffuf (Web Fuzzer)',
    command: 'ffuf',
    buildArgs: ({ url }) => {
      const fs = require('fs');
      if (!/^https?:\/\/[a-zA-Z0-9][a-zA-Z0-9._-]*(:\d+)?\/.*FUZZ/i.test(url || '')) {
        throw new Error('URL must contain FUZZ placeholder, e.g. https://example.com/FUZZ');
      }
      const wordlist = [
        '/opt/homebrew/share/seclists/Discovery/Web-Content/common.txt',
        '/usr/share/seclists/Discovery/Web-Content/common.txt',
      ].find((p) => fs.existsSync(p));
      if (!wordlist) throw new Error('Install seclists wordlists first.');
      return ['-u', url, '-w', wordlist, '-mc', '200,204,301,302,307', '-noninteractive'];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'ffuf',
  },

  // ─── Network Scanning ──────────────────────────────
  'nmap-quick': {
    title: 'Nmap Quick Scan (Top 100 Ports)',
    command: 'nmap',
    buildArgs: ({ target }) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*(\/\d{1,2})?$/.test(target || '') && !/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(target || '')) {
        throw new Error('Target must be hostname or IP/CIDR.');
      }
      return ['-sT', '-Pn', '-T4', '--top-ports', '100', target];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'nmap',
  },
  'nmap-full': {
    title: 'Nmap Full Scan (All TCP + Service Detection)',
    command: 'nmap',
    buildArgs: ({ target }) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(target || '') && !/^\d{1,3}(\.\d{1,3}){3}$/.test(target || '')) {
        throw new Error('Target must be hostname or IP.');
      }
      return ['-sT', '-sV', '-p-', '-Pn', '-T4', target];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'nmap',
  },
  'masscan': {
    title: 'masscan (High-Speed Port Scan)',
    command: 'masscan',
    buildArgs: ({ target, ports }) => {
      if (!/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(target || '')) throw new Error('Target must be IP/CIDR.');
      const p = ports && /^[\d,-]+$/.test(ports) ? ports : '1-1000';
      return ['-p', p, '--rate', '1000', target];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'masscan',
  },
  'naabu': {
    title: 'naabu (Fast Port Scan)',
    command: 'naabu',
    buildArgs: ({ target }) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(target || '') && !/^\d{1,3}(\.\d{1,3}){3}$/.test(target || '')) {
        throw new Error('Target must be hostname or IP.');
      }
      return ['-host', target, '-silent', '-no-color'];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'naabu',
  },

  // ─── Password Tools ────────────────────────────────
  'hash-identifier': {
    title: 'Hash Identifier',
    command: 'hashid',
    buildArgs: ({ hash }) => {
      if (!/^[a-fA-F0-9$./:]{8,512}$/.test(hash || '')) throw new Error('Hash must be hex/base64 chars only.');
      return [hash];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'hashid',
  },
  'john-show': {
    title: 'John the Ripper (Hash Crack)',
    command: 'john',
    buildArgs: ({ hash }) => {
      if (!/^[a-fA-F0-9$./:]{8,512}$/.test(hash || '')) throw new Error('Hash must be hex/base64 chars only.');
      // Write hash to a temp file, then crack
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const f = path.join(os.tmpdir(), `john-${Date.now()}.hash`);
      fs.writeFileSync(f, hash + '\n');
      return ['--format=raw-md5', f];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'john',
  },
  'crunch': {
    title: 'crunch (Wordlist Generator)',
    command: 'crunch',
    buildArgs: ({ min, max, charset }) => {
      if (!/^\d+$/.test(min || '') || !/^\d+$/.test(max || '')) throw new Error('Min and max must be integers.');
      if (parseInt(max) > 12) throw new Error('Max length capped at 12 to prevent runaway generation.');
      const args = [min, max];
      if (charset && /^[a-zA-Z0-9]{1,62}$/.test(charset)) args.push(charset);
      return args;
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'crunch',
  },
  'cewl': {
    title: 'CeWL (Custom Wordlist from URL)',
    command: 'cewl',
    buildArgs: ({ url }) => {
      if (!/^https?:\/\/[a-zA-Z0-9][a-zA-Z0-9._-]*(:\d+)?(\/[^\s]*)?$/.test(url || '')) throw new Error('Valid URL required.');
      return ['-d', '2', '-m', '5', url];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'cewl',
  },

  // ─── Active Directory ──────────────────────────────
  'ldapsearch': {
    title: 'LDAP Anonymous Bind',
    command: 'ldapsearch',
    buildArgs: ({ host, base }) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*(:\d+)?$/.test(host || '')) throw new Error('Host required (host or host:port).');
      if (base && !/^[a-zA-Z0-9,=. -]*$/.test(base)) throw new Error('Base DN has invalid characters.');
      return ['-x', '-H', `ldap://${host}`, '-b', base || '', '-s', 'base', 'namingContexts'];
    },
    platform: ['darwin', 'linux'],
  },
  'smbclient-list': {
    title: 'SMB Share Enumeration',
    command: 'smbclient',
    buildArgs: ({ host }) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(host || '') && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host || '')) {
        throw new Error('Host required.');
      }
      return ['-L', host, '-N'];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'samba',
  },

  // ─── Cloud Security ────────────────────────────────
  'aws-whoami': {
    title: 'AWS Caller Identity',
    command: 'aws',
    buildArgs: () => ['sts', 'get-caller-identity'],
    platform: ['darwin', 'linux', 'win32'],
    requiresInstall: 'awscli',
  },
  'trivy-config': {
    title: 'Trivy (Config Misconfig Scan)',
    command: 'trivy',
    buildArgs: ({ target }) => {
      if (!/^[a-zA-Z0-9._/-]{1,256}$/.test(target || '')) throw new Error('Target must be a local path.');
      return ['config', '--no-progress', target];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'trivy',
  },

  // ─── Mobile Security ───────────────────────────────
  'apktool-info': {
    title: 'APKTool (Decode APK)',
    command: 'apktool',
    buildArgs: ({ apkPath }) => {
      if (!/^[a-zA-Z0-9._/ -]{1,256}\.apk$/.test(apkPath || '')) throw new Error('Path must end in .apk with no shell metacharacters.');
      return ['d', '-f', '-o', '/tmp/apktool-out', apkPath];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'apktool',
  },
  'strings-apk': {
    title: 'Strings (APK/binary)',
    command: 'strings',
    buildArgs: ({ path: p }) => {
      if (!/^[a-zA-Z0-9._/ -]{1,256}$/.test(p || '')) throw new Error('Path has invalid characters.');
      return ['-a', '-n', '6', p];
    },
    platform: ['darwin', 'linux'],
  },

  // ─── Forensics ─────────────────────────────────────
  'exiftool': {
    title: 'ExifTool (Metadata Extract)',
    command: 'exiftool',
    buildArgs: ({ path: p }) => {
      if (!/^[a-zA-Z0-9._/ -]{1,256}$/.test(p || '')) throw new Error('Path has invalid characters.');
      return ['-a', '-u', '-g1', p];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'exiftool',
  },
  'binwalk': {
    title: 'Binwalk (Firmware Analysis)',
    command: 'binwalk',
    buildArgs: ({ path: p }) => {
      if (!/^[a-zA-Z0-9._/ -]{1,256}$/.test(p || '')) throw new Error('Path has invalid characters.');
      return [p];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'binwalk',
  },
  'file-identify': {
    title: 'File Type Identification',
    command: 'file',
    buildArgs: ({ path: p }) => {
      if (!/^[a-zA-Z0-9._/ -]{1,256}$/.test(p || '')) throw new Error('Path has invalid characters.');
      return ['-b', p];
    },
    platform: ['darwin', 'linux'],
  },
  'hexdump': {
    title: 'Hexdump (First 512 bytes)',
    command: 'hexdump',
    buildArgs: ({ path: p }) => {
      if (!/^[a-zA-Z0-9._/ -]{1,256}$/.test(p || '')) throw new Error('Path has invalid characters.');
      return ['-C', '-n', '512', p];
    },
    platform: ['darwin', 'linux'],
  },

  // ─── Anonymity ─────────────────────────────────────
  'tor-check': {
    title: 'Tor Status Check',
    command: 'curl',
    buildArgs: () => ['-sSfL', '--socks5', '127.0.0.1:9050', 'https://check.torproject.org/api/ip'],
    platform: ['darwin', 'linux'],
  },
  'public-ip': {
    title: 'Current Public IP',
    command: 'curl',
    buildArgs: () => ['-sfL', 'https://api.ipify.org?format=json'],
    platform: ['darwin', 'linux', 'win32'],
  },

  // ─── Reverse Engineering ───────────────────────────
  'objdump-disasm': {
    title: 'objdump Disassembly',
    command: 'objdump',
    buildArgs: ({ path: p }) => {
      if (!/^[a-zA-Z0-9._/ -]{1,256}$/.test(p || '')) throw new Error('Path has invalid characters.');
      return ['-d', p];
    },
    platform: ['darwin', 'linux'],
  },
  'r2-info': {
    title: 'radare2 Binary Info',
    command: 'r2',
    buildArgs: ({ path: p }) => {
      if (!/^[a-zA-Z0-9._/ -]{1,256}$/.test(p || '')) throw new Error('Path has invalid characters.');
      return ['-A', '-q', '-c', 'iI', p];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'radare2',
  },

  // ─── Social Engineering (defensive: recon only) ────
  'mx-records': {
    title: 'MX Records (Email Validation)',
    command: 'dig',
    buildArgs: ({ domain }) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(domain || '')) throw new Error('Domain required.');
      return ['+short', 'MX', domain];
    },
    platform: ['darwin', 'linux'],
  },
  'spf-records': {
    title: 'SPF/DMARC Check',
    command: 'dig',
    buildArgs: ({ domain }) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(domain || '')) throw new Error('Domain required.');
      return ['+short', 'TXT', domain];
    },
    platform: ['darwin', 'linux'],
  },

  'wpscan': {
    title: 'WPScan (WordPress)',
    command: 'wpscan',
    buildArgs: ({ url }) => {
      if (!/^https?:\/\/[a-zA-Z0-9][a-zA-Z0-9._-]*(:\d+)?(\/[^\s]*)?$/.test(url || '')) {
        throw new Error('URL must be http(s)://hostname[:port][/path].');
      }
      return ['--url', url, '--no-banner', '--no-update', '--random-user-agent'];
    },
    platform: ['darwin', 'linux'],
    requiresInstall: 'wpscan',
  },
};

// One-click brew install for a known package
ipcMain.handle('recon:tool-install', async (event, { pkg } = {}) => {
  const { spawn } = require('child_process');
  const crypto = require('crypto');
  // Whitelist to prevent arbitrary brew package installs via IPC
  const ALLOWED = new Set([
    // Exploits
    'nmap', 'nikto', 'exploitdb', 'httpx', 'sqlmap', 'gobuster',
    'sslscan', 'testssl', 'wpscan', 'seclists',
    // OSINT
    'sherlock', 'theharvester', 'holehe',
    // Web Recon
    'subfinder', 'nuclei', 'wafw00f', 'ffuf',
    // Network Scanning
    'masscan', 'naabu',
    // Password Tools
    'hashid', 'john', 'crunch', 'cewl',
    // Active Directory
    'samba',
    // Cloud Security
    'awscli', 'trivy',
    // Mobile Security
    'apktool',
    // Forensics
    'exiftool', 'binwalk',
    // RE
    'radare2',
    // Infrastructure
    'python@3.12', 'git',
  ]);
  if (!ALLOWED.has(pkg)) {
    return { ok: false, error: `Package "${pkg}" is not in the allow-list.` };
  }
  const brewPath = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find((p) => require('fs').existsSync(p));
  if (!brewPath) {
    return { ok: false, error: 'Homebrew is not installed. Install from https://brew.sh' };
  }
  try {
    const child = spawn(brewPath, ['install', pkg], {
      env: {
        ...process.env,
        PATH: ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].filter(Boolean).join(':'),
        HOMEBREW_NO_AUTO_UPDATE: '1',
        HOMEBREW_NO_INSTALL_CLEANUP: '1',
        HOMEBREW_NO_ENV_HINTS: '1',
      },
    });
    const sessionId = crypto.randomUUID();
    toolSessions.set(sessionId, child);
    const send = (kind, data) => {
      if (!event.sender.isDestroyed()) event.sender.send('recon:tool-data', { sessionId, kind, data });
    };
    child.stdout.on('data', (b) => send('stdout', b.toString('utf8')));
    child.stderr.on('data', (b) => send('stderr', b.toString('utf8')));
    child.on('exit', (code) => {
      toolSessions.delete(sessionId);
      if (!event.sender.isDestroyed()) event.sender.send('recon:tool-exit', { sessionId, code });
    });
    return { ok: true, sessionId, title: `brew install ${pkg}` };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'Install failed' };
  }
});

const toolSessions = new Map();

ipcMain.handle('recon:tool-spawn', async (event, { toolId, args = {} } = {}) => {
  const { spawn } = require('child_process');
  const crypto = require('crypto');
  const fs = require('fs');
  const tool = RECON_TOOLS[toolId];
  if (!tool) return { ok: false, error: `Unknown tool: ${toolId}` };
  if (!tool.platform.includes(process.platform)) {
    return { ok: false, error: `${tool.title} is not supported on ${process.platform}.` };
  }
  let argv;
  try {
    argv = tool.buildArgs(args);
  } catch (err) {
    return { ok: false, error: err.message || 'Invalid arguments' };
  }
  // Confirm binary exists — give users a clear "install X" message
  if (tool.requiresInstall) {
    const pathDirs = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
    const found = pathDirs.some((d) => fs.existsSync(`${d}/${tool.command}`));
    if (!found) {
      return { ok: false, error: `${tool.command} is not installed. Run: brew install ${tool.requiresInstall}` };
    }
  }
  try {
    const pathParts = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources', process.env.PATH || ''].filter(Boolean);
    const child = spawn(tool.command, argv, {
      env: { ...process.env, PATH: pathParts.join(':') },
    });
    const sessionId = crypto.randomUUID();
    toolSessions.set(sessionId, child);
    const send = (kind, data) => {
      if (!event.sender.isDestroyed()) event.sender.send('recon:tool-data', { sessionId, kind, data });
    };
    child.stdout.on('data', (b) => send('stdout', b.toString('utf8')));
    child.stderr.on('data', (b) => send('stderr', b.toString('utf8')));
    child.on('exit', (code) => {
      toolSessions.delete(sessionId);
      if (!event.sender.isDestroyed()) event.sender.send('recon:tool-exit', { sessionId, code });
    });
    child.on('error', (err) => send('stderr', `[spawn error] ${err.message}\n`));
    return { ok: true, sessionId, title: tool.title };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'Spawn failed' };
  }
});

ipcMain.handle('recon:tool-kill', async (_event, { sessionId }) => {
  const child = toolSessions.get(sessionId);
  if (!child) return { ok: true };
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
  toolSessions.delete(sessionId);
  return { ok: true };
});

// Run a shell command from the shipped original catalog. The renderer only
// passes (categoryId, toolClassName, kind='install'|'run', index) — the main
// process looks up the actual commands from the bundled catalog JSON,
// preventing arbitrary shell execution via IPC.
ipcMain.handle('recon:catalog-run', async (event, { category, className, kind, index } = {}) => {
  const { spawn } = require('child_process');
  const crypto = require('crypto');
  const fs = require('fs');
  const os = require('os');
  try {
    // Bundled alongside main.js — electron-builder ships it inside app.asar,
    // and Electron's fs transparently reads through the asar.
    let catalog;
    try {
      catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'originalCatalog.json'), 'utf8'));
    } catch (err) {
      return { ok: false, error: `Catalog not found: ${err.message}` };
    }
    const entries = catalog[category] || [];
    const tool = entries.find((t) => t.className === className);
    if (!tool) return { ok: false, error: `Tool "${className}" not in category "${category}".` };
    const cmdList = kind === 'install' ? (tool.install || []) : (tool.run || []);
    let cmd = cmdList[index];
    if (typeof cmd !== 'string' || !cmd.trim()) {
      return { ok: false, error: `No ${kind} command at index ${index} for ${tool.title}.` };
    }

    // macOS-adapt the original Linux-oriented commands so Install links actually work.
    // Most hackingtool originals assume Debian (apt, /usr/share writes, sudo). On macOS
    // users install to their home dir via brew/git/pip without root.
    if (process.platform === 'darwin') {
      cmd = cmd
        // apt → brew translations (common prefixes)
        .replace(/\bsudo\s+apt(?:-get)?\s+update(\s+(?:-y|--yes))?/g, 'brew update')
        .replace(/\bsudo\s+apt(?:-get)?\s+upgrade(\s+(?:-y|--yes))?/g, 'brew upgrade')
        .replace(/\bsudo\s+apt(?:-get)?\s+install(\s+(?:-y|--yes))?/g, 'brew install')
        .replace(/\bapt(?:-get)?\s+install(\s+(?:-y|--yes))?/g, 'brew install')
        // pip → pip3 (macOS brew python ships pip3)
        .replace(/\bsudo\s+pip3?\s+install\b/g, 'pip3 install --user')
        .replace(/\bpip\s+install\b/g, 'pip3 install')
        // Strip standalone sudo for git/chmod/mkdir/cp (user home is writable)
        .replace(/\bsudo\s+(git|chmod|mkdir|cp|mv|rm|ln|curl|wget|unzip|tar)\b/g, '$1')
        // ./configure && make && sudo make install → install to user prefix
        .replace(/\bsudo\s+make\s+install\b/g, 'make install PREFIX="$HOME/.local"');
    }

    const pathParts = [
      '/opt/homebrew/bin', '/opt/homebrew/sbin',
      '/opt/homebrew/opt/python@3.12/bin',
      '/opt/homebrew/opt/ruby/bin',
      '/opt/homebrew/opt/go/libexec/bin',
      path.join(os.homedir(), '.local', 'bin'),
      path.join(os.homedir(), 'go', 'bin'),
      '/usr/local/bin', '/usr/local/sbin',
      '/usr/bin', '/bin',
      process.env.PATH || '',
    ].filter(Boolean);

    // Run inside ~/recon-connect so relative `cd foo`/`./tool` paths from
    // the original hackingtool Install/Run commands resolve as they would
    // in the upstream CLI.
    const cwd = path.join(os.homedir(), 'recon-connect');
    try { fs.mkdirSync(cwd, { recursive: true }); } catch { /* ignore */ }

    const child = spawn('bash', ['-c', cmd], {
      cwd,
      env: {
        ...process.env,
        PATH: pathParts.join(':'),
        PYTHONUNBUFFERED: '1',
        HOMEBREW_NO_AUTO_UPDATE: '1',
        HOMEBREW_NO_INSTALL_CLEANUP: '1',
        HOMEBREW_NO_ENV_HINTS: '1',
        TERM: 'xterm-256color',
      },
    });
    const sessionId = crypto.randomUUID();
    toolSessions.set(sessionId, child);
    const send = (kindStream, data) => {
      if (!event.sender.isDestroyed()) event.sender.send('recon:tool-data', { sessionId, kind: kindStream, data });
    };
    child.stdout.on('data', (b) => send('stdout', b.toString('utf8')));
    child.stderr.on('data', (b) => send('stderr', b.toString('utf8')));
    child.on('exit', (code) => {
      toolSessions.delete(sessionId);
      if (!event.sender.isDestroyed()) event.sender.send('recon:tool-exit', { sessionId, code });
    });
    child.on('error', (err) => send('stderr', `[spawn error] ${err.message}\n`));
    return { ok: true, sessionId, title: `${tool.title} — ${kind}[${index}]` };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'Catalog run failed' };
  }
});

ipcMain.handle('recon:term-kill', async (_event, { sessionId }) => {
  const child = reconSessions.get(sessionId);
  if (!child) return { ok: true };
  try {
    child.kill('SIGTERM');
    setTimeout(() => { if (!child.killed) { try { child.kill('SIGKILL'); } catch { /* ignore */ } } }, 1500);
  } catch { /* ignore */ }
  reconSessions.delete(sessionId);
  return { ok: true };
});

// Quick install-state check so the UI can show the right button.
ipcMain.handle('recon:check', async () => {
  const os = require('os');
  const fs = require('fs');
  const home = os.homedir();
  if (process.platform === 'linux') {
    const p = fs.existsSync('/usr/bin/hackingtool') ? '/usr/bin/hackingtool'
            : fs.existsSync('/usr/local/bin/hackingtool') ? '/usr/local/bin/hackingtool' : null;
    return { installed: !!p, path: p || undefined };
  }
  const dir = path.join(home, 'recon-connect');
  return { installed: fs.existsSync(dir), path: fs.existsSync(dir) ? dir : undefined };
});

// Run the install in a visible terminal so the user can enter sudo/brew
// prompts, watch git clone / pip install progress, and see any errors.
ipcMain.handle('recon:install', async () => {
  const os = require('os');
  const { spawn } = require('child_process');
  const platform = process.platform;
  const home = os.homedir();
  try {
    if (platform === 'linux') {
      const installCmd = 'curl -sSL https://raw.githubusercontent.com/Z4nzu/hackingtool/master/install.sh | sudo bash';
      const term = process.env.TERMINAL || 'x-terminal-emulator';
      spawn(term, ['-e', 'bash', '-c', `${installCmd}; echo; echo "Install finished — press enter to close."; read`], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true };
    }
    if (platform === 'darwin') {
      const dir = path.join(home, 'recon-connect');
      const script = [
        `cd "${home}"`,
        `if ! command -v brew >/dev/null; then echo "Homebrew is required. Install from https://brew.sh then retry."; exit 1; fi`,
        `brew list python >/dev/null 2>&1 || brew install python`,
        `brew list git >/dev/null 2>&1 || brew install git`,
        `if [ ! -d "${dir}" ]; then git clone https://github.com/Z4nzu/hackingtool.git "${dir}"; fi`,
        `cd "${dir}"`,
        `if [ ! -d venv ]; then python3 -m venv venv; fi`,
        `source venv/bin/activate`,
        `pip install --upgrade pip`,
        `pip install -r requirements.txt`,
        `echo`,
        `echo "✓ Recon Connect installed at ${dir}"`,
        `echo "You can close this window."`,
      ].join(' && ');
      const appleScript = `tell application "Terminal" to do script "${script.replace(/"/g, '\\"').replace(/\\/g, '\\\\').replace(/\\\\"/g, '\\"')}"`;
      spawn('osascript', ['-e', appleScript], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true };
    }
    if (platform === 'win32') {
      const dir = path.join(home, 'recon-connect');
      const cmd = [
        `cd /d "${home}"`,
        `where git >nul 2>nul || (echo Git for Windows is required. Install from https://git-scm.com then retry. ^& pause ^& exit /b 1)`,
        `where python >nul 2>nul || (echo Python 3.10+ is required. Install from https://python.org then retry. ^& pause ^& exit /b 1)`,
        `if not exist "${dir}" git clone https://github.com/Z4nzu/hackingtool.git "${dir}"`,
        `cd /d "${dir}"`,
        `if not exist venv python -m venv venv`,
        `call venv\\Scripts\\activate`,
        `python -m pip install --upgrade pip`,
        `pip install -r requirements.txt`,
        `echo.`,
        `echo Recon Connect installed at ${dir}`,
        `pause`,
      ].join(' && ');
      spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', cmd], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true };
    }
    return { ok: false, error: `Unsupported platform: ${platform}` };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'Install failed' };
  }
});

// Force clear all caches and reload — called by web app update banner
ipcMain.handle('app:force-refresh', async () => {
  if (mainWindow) {
    await mainWindow.webContents.session.clearCache();
    await mainWindow.webContents.session.clearStorageData({
      storages: ['serviceworkers', 'cachestorage', 'appcache', 'filesystem'],
    });
    await mainWindow.webContents.executeJavaScript(`
      if ('caches' in window) { caches.keys().then(keys => keys.forEach(k => caches.delete(k))); }
      if (navigator.serviceWorker) { navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister())); }
    `).catch(() => {});
    mainWindow.webContents.reload();
  }
  return { success: true };
});

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
              await mainWindow.webContents.session.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
              mainWindow.webContents.reload();
            }
          },
        },
        {
          label: 'Full Reset & Reload',
          accelerator: 'CmdOrCtrl+Shift+F5',
          click: async () => {
            if (mainWindow) {
              // Nuclear option: clear everything except cookies (preserves login)
              await mainWindow.webContents.session.clearCache();
              await mainWindow.webContents.session.clearStorageData({
                storages: ['serviceworkers', 'cachestorage', 'appcache', 'filesystem'],
              });
              // Also clear via JS in the page
              await mainWindow.webContents.executeJavaScript(`
                if ('caches' in window) { caches.keys().then(keys => keys.forEach(k => caches.delete(k))); }
                if (navigator.serviceWorker) { navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister())); }
              `).catch(() => {});
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
