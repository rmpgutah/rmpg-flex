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

// ─── Lazy-load native modules ─────────────────────────────────
// better-sqlite3 is a native (C++) add-on that must be compiled for
// the exact Electron ABI + architecture. If the rebuild failed or the
// binary is missing (common on first macOS launch after a bad build),
// eagerly requiring it crashes the entire app before the splash even
// shows. Load lazily so the app can start with offline support
// gracefully disabled.
let initLocalDb, getLocalDb, closeLocalDb, getConfig, setConfig, getQueueDepth, getSyncMeta;
try {
  ({ initLocalDb, getLocalDb, closeLocalDb, getConfig, setConfig, getQueueDepth, getSyncMeta } = require('./localDb'));
} catch (err) {
  console.error('[APP] Failed to load localDb (better-sqlite3 native module):', err.message);
  console.error('[APP] Offline support will be disabled this session.');
  // Provide no-op stubs so the rest of main.js doesn't crash on calls
  initLocalDb = () => { console.warn('[LOCAL-DB] Unavailable — native module failed to load'); };
  getLocalDb = () => null;
  closeLocalDb = () => {};
  getConfig = () => null;
  setConfig = () => {};
  getQueueDepth = () => 0;
  getSyncMeta = () => null;
}

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

// ─── Last-resort error guards ────────────────────────────────
// Without these, an unhandled rejection (e.g. loadURL rejecting
// with net::ERR_CONNECTION_CLOSED when nginx RSTs an in-flight
// connection during a `systemctl restart rmpg-flex`) crashes the
// whole desktop app and shows the Electron error dialog.
//
// TODO(you): implement isTransientNetworkError() below. Decide:
//   - swallow `net::*` codes (most are transient — server restart,
//     flaky WiFi, captive portal redirects) so dispatchers stay up
//   - re-throw everything else so real bugs (null deref, type
//     errors) still surface in dev/staging instead of rotting
// Reference: Chromium net error list — net::ERR_CONNECTION_CLOSED,
// net::ERR_NETWORK_CHANGED, net::ERR_INTERNET_DISCONNECTED, etc.
// All have message strings starting with "net::ERR_".
// Chromium net errors that indicate a real misconfiguration or
// active threat — dispatchers MUST be told about these, never swallow.
// (Expired/invalid certs could be a MITM; auth failures suggest the
// VPS is misconfigured after a deploy.)
const NON_TRANSIENT_NET_CODES = [
  'CERT_',           // any cert error: AUTHORITY_INVALID, DATE_INVALID, COMMON_NAME_INVALID, REVOKED, etc.
  'SSL_',            // SSL_PROTOCOL_ERROR, SSL_VERSION_OR_CIPHER_MISMATCH
  'BAD_SSL_',
  'INSECURE_RESPONSE',
  'BLOCKED_BY_',     // BLOCKED_BY_CLIENT (extension/firewall) — surface so operator knows
];

function isTransientNetworkError(err) {
  const msg = err && (err.message || String(err)) || '';
  if (!msg.includes('net::ERR_')) return false;
  for (const bad of NON_TRANSIENT_NET_CODES) {
    if (msg.includes(`net::ERR_${bad}`)) return false;
  }
  return true;
}

process.on('unhandledRejection', (reason) => {
  if (isTransientNetworkError(reason)) {
    console.warn('[APP] Swallowed transient network error:', reason && reason.message);
    return;
  }
  console.error('[APP] Unhandled rejection:', reason);
  throw reason;
});

process.on('uncaughtException', (err) => {
  if (isTransientNetworkError(err)) {
    console.warn('[APP] Swallowed transient network error:', err && err.message);
    return;
  }
  console.error('[APP] Uncaught exception:', err);
  // Re-throw on next tick so Electron's default crash dialog still
  // fires for real bugs, but our log line lands first.
  setImmediate(() => { throw err; });
});
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
function getSplashLogoDataUri() {
  try {
    const fs = require('fs');
    const candidates = DEV_MODE
      ? [
          path.join(__dirname, '..', 'client', 'public', 'rmpg flex.png'),
          path.join(__dirname, '..', 'client', 'public', 'RMPG Logo Dark.png'),
          path.join(__dirname, '..', 'client', 'public', 'rmpg-logo.png'),
        ]
      : [
          path.join(process.resourcesPath, 'rmpg flex.png'),
          path.join(process.resourcesPath, 'RMPG Logo Dark.png'),
          path.join(process.resourcesPath, 'icon.png'),
        ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const ext = path.extname(p).slice(1).toLowerCase() || 'png';
        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        const b64 = fs.readFileSync(p).toString('base64');
        return `data:${mime};base64,${b64}`;
      }
    }
  } catch (err) {
    console.warn('[SPLASH] logo load failed:', err && err.message);
  }
  return ''; // Fall back to text logo if image unavailable
}

function createSplashWindow() {
  if (!app.isReady()) { console.warn('[APP] createSplashWindow called before ready — skipping'); return; }
  splashWindow = new BrowserWindow({
    width: 480,
    height: 380,
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

  const logoUri = getSplashLogoDataUri();
  const logoMarkup = logoUri
    ? `<img src="${logoUri}" alt="RMPG Flex" class="logo-img" draggable="false" />`
    : `<div class="logo-fallback"><span>RMPG</span></div>`;

  const splashHTML = `data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          color: #e6e6e6;
          height: 100vh;
          overflow: hidden;
          -webkit-app-region: drag;
          position: relative;
          /* Two-layer background: soft gold radial + charcoal base, framed */
          background:
            radial-gradient(ellipse at center, rgba(212,160,23,0.10) 0%, rgba(0,0,0,0) 65%),
            linear-gradient(180deg, #0a0a0a 0%, #050505 100%);
          border: 1px solid #1a1a1a;
          border-radius: 6px;
          box-shadow:
            inset 0 0 0 1px rgba(212,160,23,0.18),
            0 0 0 1px rgba(0,0,0,0.5),
            0 18px 40px rgba(0,0,0,0.6);
        }
        /* Subtle drifting grid */
        body::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            linear-gradient(rgba(212,160,23,0.045) 1px, transparent 1px) 0 0 / 32px 32px,
            linear-gradient(90deg, rgba(212,160,23,0.045) 1px, transparent 1px) 0 0 / 32px 32px;
          mask-image: radial-gradient(ellipse at center, black 30%, transparent 80%);
          -webkit-mask-image: radial-gradient(ellipse at center, black 30%, transparent 80%);
          pointer-events: none;
          animation: grid-drift 22s linear infinite;
        }
        @keyframes grid-drift {
          0%   { background-position: 0 0, 0 0; }
          100% { background-position: 32px 32px, 32px 32px; }
        }
        /* HUD corner brackets */
        .corner {
          position: absolute;
          width: 18px;
          height: 18px;
          pointer-events: none;
          opacity: 0.85;
          animation: corner-pulse 3.6s ease-in-out infinite;
        }
        .corner::before, .corner::after {
          content: '';
          position: absolute;
          background: #d4a017;
          box-shadow: 0 0 6px rgba(212,160,23,0.5);
        }
        .corner::before { top: 0; left: 0; width: 12px; height: 1.5px; }
        .corner::after  { top: 0; left: 0; width: 1.5px; height: 12px; }
        .corner.tl { top: 10px; left: 10px; }
        .corner.tr { top: 10px; right: 10px; transform: scaleX(-1); }
        .corner.bl { bottom: 10px; left: 10px; transform: scaleY(-1); }
        .corner.br { bottom: 10px; right: 10px; transform: scale(-1); }
        @keyframes corner-pulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
        /* Layout */
        .stage {
          position: relative;
          z-index: 1;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 28px 24px 20px;
        }
        /* Logo block with rotating ring + pulse aura */
        .logo-wrap {
          position: relative;
          width: 132px;
          height: 132px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 18px;
        }
        .logo-wrap::before {
          /* Pulse aura behind logo */
          content: '';
          position: absolute;
          inset: -8px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(212,160,23,0.35) 0%, rgba(212,160,23,0) 65%);
          filter: blur(4px);
          animation: aura-pulse 2.6s ease-in-out infinite;
        }
        .logo-wrap::after {
          /* Rotating gold arc ring */
          content: '';
          position: absolute;
          inset: -2px;
          border-radius: 50%;
          background: conic-gradient(from 0deg,
            rgba(212,160,23,0) 0deg,
            rgba(212,160,23,0.05) 30deg,
            rgba(212,160,23,0.95) 70deg,
            rgba(212,160,23,0.05) 110deg,
            rgba(212,160,23,0) 140deg,
            rgba(212,160,23,0) 360deg);
          mask: radial-gradient(circle, transparent 62%, black 64%, black 70%, transparent 72%);
          -webkit-mask: radial-gradient(circle, transparent 62%, black 64%, black 70%, transparent 72%);
          animation: ring-spin 2.8s linear infinite;
        }
        @keyframes aura-pulse {
          0%, 100% { opacity: 0.5; transform: scale(0.95); }
          50%      { opacity: 1;   transform: scale(1.08); }
        }
        @keyframes ring-spin {
          to { transform: rotate(360deg); }
        }
        .logo-img {
          position: relative;
          z-index: 2;
          width: 96px;
          height: 96px;
          object-fit: contain;
          filter: drop-shadow(0 0 12px rgba(212,160,23,0.45));
          animation: logo-float 6s ease-in-out infinite;
        }
        .logo-fallback {
          position: relative;
          z-index: 2;
          width: 96px;
          height: 96px;
          border: 2px solid #d4a017;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .logo-fallback span {
          font-size: 26px;
          font-weight: 900;
          letter-spacing: 2px;
          color: #d4a017;
        }
        @keyframes logo-float {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-3px); }
        }
        /* Title block */
        h1 {
          font-size: 18px;
          font-weight: 800;
          letter-spacing: 6px;
          text-transform: uppercase;
          color: #f0f0f0;
          margin-bottom: 5px;
          text-shadow: 0 0 12px rgba(212,160,23,0.25);
        }
        .subtitle {
          font-size: 9px;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 4px;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .subtitle::before, .subtitle::after {
          content: '';
          height: 1px;
          width: 22px;
          background: linear-gradient(90deg, transparent, #d4a017, transparent);
        }
        /* Indeterminate progress bar */
        .progress-track {
          position: relative;
          width: 240px;
          height: 3px;
          background: rgba(212,160,23,0.10);
          border-radius: 1px;
          overflow: hidden;
          margin-bottom: 14px;
          box-shadow: inset 0 0 0 1px rgba(212,160,23,0.18);
        }
        .progress-bar {
          position: absolute;
          top: 0;
          left: -40%;
          width: 40%;
          height: 100%;
          background: linear-gradient(90deg,
            rgba(212,160,23,0) 0%,
            rgba(212,160,23,0.5) 35%,
            rgba(212,160,23,1) 50%,
            rgba(212,160,23,0.5) 65%,
            rgba(212,160,23,0) 100%);
          box-shadow: 0 0 8px rgba(212,160,23,0.6);
          animation: progress-slide 1.6s ease-in-out infinite;
        }
        @keyframes progress-slide {
          0%   { left: -40%; }
          100% { left: 100%; }
        }
        /* Status line */
        .status {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 9px;
          color: #b8924a;
          text-transform: uppercase;
          letter-spacing: 2.5px;
        }
        .status .dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #d4a017;
          box-shadow: 0 0 6px #d4a017;
          animation: status-blink 1.6s ease-in-out infinite;
        }
        @keyframes status-blink {
          0%, 100% { opacity: 0.3; }
          50%      { opacity: 1; }
        }
        .status .ellipsis::after {
          content: '';
          display: inline-block;
          width: 12px;
          text-align: left;
          animation: ellipsis 1.4s steps(4, end) infinite;
        }
        @keyframes ellipsis {
          0%   { content: ''; }
          25%  { content: '.'; }
          50%  { content: '..'; }
          75%  { content: '...'; }
          100% { content: ''; }
        }
        /* Version badge bottom */
        .version {
          position: absolute;
          bottom: 12px;
          right: 14px;
          font-size: 8px;
          letter-spacing: 2px;
          color: rgba(212,160,23,0.55);
          text-transform: uppercase;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .build-tag {
          position: absolute;
          bottom: 12px;
          left: 14px;
          font-size: 8px;
          letter-spacing: 2px;
          color: rgba(255,255,255,0.25);
          text-transform: uppercase;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
      </style>
    </head>
    <body>
      <div class="corner tl"></div>
      <div class="corner tr"></div>
      <div class="corner bl"></div>
      <div class="corner br"></div>

      <div class="stage">
        <div class="logo-wrap">
          ${logoMarkup}
        </div>
        <h1>RMPG Flex</h1>
        <p class="subtitle">CAD &middot; RMS Dispatch System</p>

        <div class="progress-track">
          <div class="progress-bar"></div>
        </div>

        <div class="status">
          <span class="dot"></span>
          <span>Establishing Secure Uplink<span class="ellipsis"></span></span>
        </div>
      </div>

      <div class="build-tag">RMPG-PRIMARY</div>
      <div class="version">v${app.getVersion ? app.getVersion() : '5.8.2'}</div>
    </body>
    </html>
  `)}`;

  splashWindow.loadURL(splashHTML).catch((err) => {
    console.warn('[SPLASH] loadURL failed:', err && err.message);
  });
}

let splashTimeout = null;

function closeSplash() {
  if (splashTimeout) {
    clearTimeout(splashTimeout);
    splashTimeout = null;
  }
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

/**
 * Start a safety timer that closes the splash screen after maxMs even
 * if ready-to-show never fires (server hangs, loadURL stalls, etc.).
 * Without this, macOS users see the splash forever with no way to
 * interact with the app.
 */
function startSplashTimeout(maxMs = 15000) {
  splashTimeout = setTimeout(() => {
    console.warn(`[SPLASH] Timed out after ${maxMs}ms — force-closing`);
    closeSplash();
    // If the main window exists but isn't visible yet, show it now
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, maxMs);
}

// ─── Server Connectivity Check ──────────────────────────────
/**
 * Verify that the remote RMPG Flex server is reachable.
 * Retries a few times with short delays before giving up.
 */
function checkServerConnectivity() {
  return new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = 3; // 3 × 2s = 6s max; reduced from 5 (10s) to prevent long startup delays
    const delayMs = 2000;
    let resolved = false;

    function tryConnect() {
      if (resolved) return;
      attempts++;
      console.log(`[APP] Connectivity check attempt ${attempts}/${maxAttempts}: ${REMOTE_SERVER_URL}/api/health`);

      const request = net.request(`${REMOTE_SERVER_URL}/api/health`);

      // Per-request timeout — prevent hung TCP handshakes from stalling startup
      const reqTimeout = setTimeout(() => {
        try { request.abort(); } catch { /* ignore */ }
        if (!resolved && attempts < maxAttempts) {
          setTimeout(tryConnect, delayMs);
        } else if (!resolved) {
          resolved = true;
          resolve(false);
        }
      }, 5000);

      request.on('response', (response) => {
        clearTimeout(reqTimeout);
        // Consume body to prevent memory leak
        response.on('data', () => {});
        response.on('end', () => {});
        if (!resolved && response.statusCode === 200) {
          resolved = true;
          console.log('[APP] Server is reachable');
          resolve(true);
        } else if (!resolved && attempts < maxAttempts) {
          setTimeout(tryConnect, delayMs);
        } else if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });

      request.on('error', (err) => {
        clearTimeout(reqTimeout);
        console.log(`[APP] Connection attempt ${attempts} failed:`, err.message);
        if (!resolved && attempts < maxAttempts) {
          setTimeout(tryConnect, delayMs);
        } else if (!resolved) {
          resolved = true;
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
  // Wrap in a race with a timeout so a macOS-specific hang in clearCache
  // or clearStorageData doesn't block startup forever.
  try {
    await Promise.race([
      (async () => {
        await mainWindow.webContents.session.clearCache();
        console.log('[APP] HTTP cache cleared');
        // Unregister stale service workers so the latest version installs fresh
        await mainWindow.webContents.session.clearStorageData({ storages: ['serviceworkers'] });
        console.log('[APP] Service workers cleared');
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Cache/ServiceWorker clear timed out after 5000ms')), 5000)),
    ]);
  } catch (err) {
    console.warn('[APP] Cache/SW clear timed out or failed — continuing:', err && err.message);
  }

  // Load the remote web application
  console.log('[APP] Loading:', REMOTE_SERVER_URL);
  // Promise rejection here is handled by the did-fail-load listener
  // below, which shows the offline page. Catch so the rejection
  // doesn't escape to the global unhandledRejection guard.
  mainWindow.loadURL(REMOTE_SERVER_URL).catch((err) => {
    console.warn('[APP] loadURL failed (did-fail-load will recover):', err && err.message);
  });

  // Show window when ready, close splash
  mainWindow.once('ready-to-show', () => {
    closeSplash();
    mainWindow.show();
    mainWindow.focus();
  });

  // Backup: if ready-to-show never fires (happens on macOS when the page
  // HTML loads but first paint is delayed by large JS bundles), close the
  // splash once the page finishes loading and show the window.
  mainWindow.webContents.once('did-finish-load', () => {
    console.log('[APP] did-finish-load fired');
    if (splashWindow && !splashWindow.isDestroyed()) {
      // 500ms grace period: ready-to-show (the preferred event) fires at
      // first paint. If it hasn't fired yet, this backup ensures the splash
      // closes. If ready-to-show fires during the 500ms, closeSplash() is
      // a no-op the second time (it checks splashWindow existence).
      setTimeout(() => {
        closeSplash();
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
          mainWindow.show();
          mainWindow.focus();
        }
      }, 500);
    }
  });

  // Handle page load failures (server down, network error)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`[APP] Page load failed: ${errorDescription} (code ${errorCode})`);
    // Close splash so the user can see (and interact with) the offline page
    closeSplash();
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    // Show the offline page with a retry button
    mainWindow.loadURL(getOfflineHTML()).catch((err) => {
      console.warn('[APP] Offline page loadURL failed:', err && err.message);
    });
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
      // Escape backslashes BEFORE double quotes so a literal '\' in the
      // input cannot pair with the escape we add (e.g. an attacker-supplied
      // `\` would otherwise turn our `\"` into `\\"`, re-opening the
      // AppleScript string). Single-pass callback handles both characters.
      const appleScript = `tell application "Terminal" to do script "${cmd.replace(/[\\"]/g, (c) => '\\' + c)}"`;
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
    const fs = require('fs');
    const dir = path.join(home, 'recon-connect');
    // Probe on the Node side so we never pass the wrong filename through
    // shell quoting. Both candidate names are literal — no user input.
    const entry = ['hackingtool.py', 'recon connect.py'].find((f) => fs.existsSync(path.join(dir, f)));
    if (!entry) {
      // Bail with a clear shell-side message instead of silently crashing
      const script = `echo "error: no hackingtool.py or 'recon connect.py' in ${dir}. Reinstall via the Install button."; exit 1`;
      return { shell: 'bash', args: ['-c', script] };
    }
    // Single-quote the filename so spaces (in 'recon connect.py') survive bash parsing
    const entryQuoted = `'${entry.replace(/'/g, "'\\''")}'`;
    const script = `cd "${dir}" && source venv/bin/activate && exec python3 ${entryQuoted}`;
    return { shell: 'bash', args: ['-c', script] };
  }
  if (platform === 'win32') {
    const fs = require('fs');
    const dir = path.join(home, 'recon-connect');
    const entry = ['hackingtool.py', 'recon connect.py'].find((f) => fs.existsSync(path.join(dir, f)));
    if (!entry) return { shell: 'cmd.exe', args: ['/c', `echo No Python entry file in ${dir} & exit /b 1`] };
    const script = `cd /d "${dir}" && call venv\\Scripts\\activate && python "${entry}"`;
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
    // Shell mode — auto-probe the target's wildcard response length before
    // running gobuster, and pass --exclude-length so SPAs (which return 200
    // for every path) don't derail the scan.
    shell: true,
    command: 'bash',
    buildArgs: ({ url }) => {
      const fs = require('fs');
      if (!/^https?:\/\/[a-zA-Z0-9][a-zA-Z0-9._-]*(:\d+)?(\/[^\s]*)?$/.test(url || '')) {
        throw new Error('URL must be http(s)://hostname[:port][/path].');
      }
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
      // URL already regex-validated above, wordlist path from hardcoded list.
      // Single-quote both inside the bash command to defend against any
      // character the regex somehow let through.
      const safeUrl = url.replace(/'/g, "'\\''");
      // Auto-fallback: if user typed https:// but the host only serves HTTP,
      // swap to http:// for both the probe and gobuster.
      const httpUrl = url.replace(/^https:\/\//i, 'http://');
      const safeHttpUrl = httpUrl.replace(/'/g, "'\\''");
      const probePath = '/nonexistent-gobuster-probe-12345';
      return ['-c',
        `URL='${safeUrl}' ; HTTP_URL='${safeHttpUrl}' ; ` +
        // Probe with TLS; if it gives TLS errors or 0 bytes, retry with HTTP
        `PROBE=$(curl -sk -o /dev/null -w '%{http_code} %{size_download}' --connect-timeout 5 --max-time 10 "\${URL%/}${probePath}" 2>/dev/null) ; ` +
        `echo "[pre-probe HTTPS] $PROBE" ; ` +
        `WC_LEN=$(echo "$PROBE" | awk '{print $2}') ; ` +
        `HTTP_CODE=$(echo "$PROBE" | awk '{print $1}') ; ` +
        `if [ "$HTTP_CODE" = "000" ] || [ "$HTTP_CODE" = "0" ] || [ -z "$HTTP_CODE" ]; then ` +
          `PROBE2=$(curl -sk -o /dev/null -w '%{http_code} %{size_download}' --connect-timeout 5 --max-time 10 "\${HTTP_URL%/}${probePath}" 2>/dev/null) ; ` +
          `echo "[pre-probe HTTP fallback] $PROBE2" ; ` +
          `WC_LEN=$(echo "$PROBE2" | awk '{print $2}') ; ` +
          `HTTP_CODE=$(echo "$PROBE2" | awk '{print $1}') ; ` +
          `URL="$HTTP_URL" ; ` +
        `fi ; ` +
        `if [ "$HTTP_CODE" = "000" ] || [ "$HTTP_CODE" = "0" ] || [ -z "$HTTP_CODE" ]; then ` +
          `echo "[error] Could not reach target via HTTPS or HTTP. Check URL, network, or try a full URL with port." ; ` +
          `exit 1 ; ` +
        `fi ; ` +
        `echo "[ok] Scanning $URL (wildcard response: status=$HTTP_CODE, length=$WC_LEN)" ; ` +
        `if [ -n "$WC_LEN" ] && [ "$WC_LEN" -gt 0 ] 2>/dev/null ; then ` +
          `gobuster dir -u "$URL" -w '${wordlist}' --no-color -t 20 --timeout 10s -k --exclude-length "$WC_LEN" ; ` +
        `else ` +
          `gobuster dir -u "$URL" -w '${wordlist}' --no-color -t 20 --timeout 10s -k --force ; ` +
        `fi`
      ];
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
      // Unique unguessable directory — avoids predictable-temp-file races
      // (an attacker watching os.tmpdir() can't pre-create or symlink the
      // path because mkdtempSync returns a fresh randomized suffix).
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmpg-john-'));
      const f = path.join(dir, 'input.hash');
      fs.writeFileSync(f, hash + '\n', { mode: 0o600 });
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

// Check whether a binary is on PATH — used by the renderer to show
// INSTALLED/NOT INSTALLED badges and skip the run if pre-flight fails.
ipcMain.handle('recon:check-binary', async (_event, { binary } = {}) => {
  if (!binary || !/^[a-zA-Z0-9._+-]+$/.test(binary)) return { installed: false, error: 'Invalid binary name' };
  const { spawnSync } = require('child_process');
  const pathParts = [
    '/opt/homebrew/bin', '/opt/homebrew/sbin',
    '/opt/homebrew/opt/python@3.12/bin',
    '/opt/homebrew/opt/ruby/bin',
    '/opt/homebrew/opt/go/libexec/bin',
    require('os').homedir() + '/.local/bin',
    require('os').homedir() + '/go/bin',
    '/usr/local/bin', '/usr/local/sbin',
    '/usr/bin', '/bin',
    process.env.PATH || '',
  ].filter(Boolean);
  const r = spawnSync('command', ['-v', binary], {
    shell: 'bash',
    env: { ...process.env, PATH: pathParts.join(':') },
  });
  const stdout = (r.stdout || '').toString().trim();
  if (r.status === 0 && stdout) return { installed: true, path: stdout };
  // Also probe known paths directly in case `command -v` wasn't available
  const fs = require('fs');
  for (const dir of pathParts) {
    if (dir && fs.existsSync(`${dir}/${binary}`)) return { installed: true, path: `${dir}/${binary}` };
  }
  return { installed: false };
});

// Run a registered RECON_TOOLS tool in a visible Terminal window — same
// command, same args, but with a TTY so sudo prompts, interactive CLI
// tools, or color-aware outputs that require a terminal work properly.
ipcMain.handle('recon:tool-terminal', async (_event, { toolId, args = {} } = {}) => {
  const { spawn } = require('child_process');
  const tool = RECON_TOOLS[toolId];
  if (!tool) return { ok: false, error: `Unknown tool: ${toolId}` };
  let argv;
  try { argv = tool.buildArgs(args); } catch (err) { return { ok: false, error: err.message || 'Invalid args' }; }

  // Reassemble an interactive shell command that mirrors what the embedded
  // spawn would run. Quote each argv element for shell safety.
  const shellQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  const fullCmd = `${shellQuote(tool.command)} ${argv.map(shellQuote).join(' ')}`;

  if (process.platform === 'darwin') {
    const script = `echo "${tool.title}"; echo; ${fullCmd}; echo; echo "[done — press enter to close]"; read`;
    const appleScript = `tell application "Terminal" to do script "${script.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    spawn('osascript', ['-e', appleScript], { detached: true, stdio: 'ignore' }).unref();
    spawn('osascript', ['-e', 'tell application "Terminal" to activate'], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  }
  if (process.platform === 'linux') {
    const term = process.env.TERMINAL || 'x-terminal-emulator';
    spawn(term, ['-e', 'bash', '-c', `${fullCmd}; echo; read -p "Press enter to close"`], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  }
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', fullCmd], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  }
  return { ok: false, error: `Unsupported platform: ${process.platform}` };
});

// Open Terminal.app with a catalog command that needs interactive sudo.
// The command is resolved from the bundled catalog by (category, className, kind, index),
// same guardrails as recon:catalog-run.
ipcMain.handle('recon:catalog-terminal', async (_event, { category, className, kind, index } = {}) => {
  const fs = require('fs');
  const { spawn } = require('child_process');
  try {
    const catalog = JSON.parse(fs.readFileSync(require('path').join(__dirname, 'originalCatalog.json'), 'utf8'));
    const entries = catalog[category] || [];
    const tool = entries.find((t) => t.className === className);
    if (!tool) return { ok: false, error: `Tool "${className}" not found.` };
    const cmdList = kind === 'install' ? (tool.install || []) : (tool.run || []);
    const cmd = cmdList[index];
    if (!cmd) return { ok: false, error: `No ${kind}[${index}] command.` };
    // Run in ~/recon-connect so relative paths resolve like in the CLI
    const cwd = require('os').homedir() + '/recon-connect';
    const fullCmd = `cd "${cwd}" && ${cmd}`;
    if (process.platform === 'darwin') {
      const appleScript = `tell application "Terminal" to do script "${fullCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      spawn('osascript', ['-e', appleScript], { detached: true, stdio: 'ignore' }).unref();
      // Also activate Terminal.app so it comes forward
      spawn('osascript', ['-e', 'tell application "Terminal" to activate'], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true };
    }
    if (process.platform === 'linux') {
      const term = process.env.TERMINAL || 'x-terminal-emulator';
      spawn(term, ['-e', 'bash', '-c', `${fullCmd}; echo; echo "Press enter to close."; read`], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true };
    }
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', fullCmd], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true };
    }
    return { ok: false, error: `Unsupported platform: ${process.platform}` };
  } catch (err) {
    return { ok: false, error: err.message || 'Failed to open terminal' };
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
    // Optional extraArgs from the UI — appended to the command verbatim.
    // The renderer is trusted (same origin + context isolated) but we still
    // ban shell metacharacters that would allow command chaining.
    const extraArgs = arguments[0]?.extraArgs;
    if (extraArgs && typeof extraArgs === 'string' && extraArgs.trim()) {
      if (/[;&|`$<>]/.test(extraArgs)) {
        return { ok: false, error: 'Extra args may not contain ; & | ` $ < or >' };
      }
      cmd = `${cmd} ${extraArgs.trim()}`;
    }
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
        // pip → python3.12 -m pip (avoids the broken 3.14 pyexpat on this machine)
        .replace(/\bsudo\s+pip3?\s+install\b/g, 'python3.12 -m pip install --user')
        .replace(/\bpip3?\s+install\b/g, 'python3.12 -m pip install')
        // python setup.py install with sudo → user-local install
        .replace(/\bsudo\s+python3?\s+setup\.py\s+install\b/g, 'python3 setup.py install --user')
        // ./configure && make && sudo make install → install to user prefix
        .replace(/\bsudo\s+make\s+install\b/g, 'make install PREFIX="$HOME/.local"')
        // gem install with sudo → user-local via ~/.gem
        .replace(/\bsudo\s+gem\s+install\b/g, 'gem install --user-install')
        // go get / go install don't need sudo on macOS
        .replace(/\bsudo\s+go\s+(install|get)\b/g, 'go $1')
        // Strip sudo for all the rest — macOS user owns /opt/homebrew and home
        // dir, so user-land installs don't need it. If a tool genuinely needs
        // root (kernel modules, system services), it'll fail with a clear
        // error pointing to the specific operation.
        .replace(/\bsudo\s+/g, '');
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

// Detailed Recon Connect install state (path + whether hackingtool.py is present)
ipcMain.handle('recon:install-state', async () => {
  const os = require('os');
  const fs = require('fs');
  const home = os.homedir();
  if (process.platform === 'linux') {
    const linuxBin = fs.existsSync('/usr/bin/hackingtool') ? '/usr/bin/hackingtool'
      : fs.existsSync('/usr/local/bin/hackingtool') ? '/usr/local/bin/hackingtool' : null;
    return { installed: !!linuxBin, path: linuxBin, repoDir: linuxBin ? null : undefined };
  }
  const dir = path.join(home, 'recon-connect');
  const dotGit = path.join(dir, '.git');
  const entry = ['hackingtool.py', 'recon connect.py'].find((f) => fs.existsSync(path.join(dir, f)));
  return {
    installed: Boolean(entry),
    path: entry ? path.join(dir, entry) : null,
    repoDir: fs.existsSync(dotGit) ? dir : null,
    entry: entry || null,
  };
});

// Pull latest changes from the Recon Connect repo
ipcMain.handle('recon:update', async (event) => {
  const { spawn } = require('child_process');
  const crypto = require('crypto');
  const os = require('os');
  const fs = require('fs');
  const dir = path.join(os.homedir(), 'recon-connect');
  if (!fs.existsSync(path.join(dir, '.git'))) {
    return { ok: false, error: 'Recon Connect is not a git checkout — cannot update.' };
  }
  const child = spawn('bash', ['-c', `cd "${dir}" && git pull --ff-only --no-rebase`], {
    env: { ...process.env, PATH: ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', process.env.PATH || ''].filter(Boolean).join(':') },
  });
  const sessionId = crypto.randomUUID();
  toolSessions.set(sessionId, child);
  child.stdout.on('data', (b) => event.sender.isDestroyed() || event.sender.send('recon:term-data', { sessionId, data: b.toString('utf8') }));
  child.stderr.on('data', (b) => event.sender.isDestroyed() || event.sender.send('recon:term-data', { sessionId, data: b.toString('utf8') }));
  child.on('exit', (code) => {
    toolSessions.delete(sessionId);
    if (!event.sender.isDestroyed()) event.sender.send('recon:term-exit', { sessionId, code });
  });
  return { ok: true, sessionId };
});

// Emergency kill-all — stops every child process this module has spawned
ipcMain.handle('recon:kill-all', async () => {
  let killed = 0;
  for (const [, child] of toolSessions) {
    try { child.kill('SIGTERM'); killed++; } catch { /* ignore */ }
  }
  toolSessions.clear();
  for (const [, child] of reconSessions) {
    try { child.kill('SIGTERM'); killed++; } catch { /* ignore */ }
  }
  reconSessions.clear();
  return { ok: true, killed };
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
      // Single-pass escape of backslashes and double quotes for embedding
      // inside the AppleScript string literal. The previous chained-replace
      // approach double-escaped its own output (escape `"` -> `\"`, then
      // escape `\` -> `\\` re-escapes the just-added backslash) and then
      // tried to undo the damage with a third replace — fragile and
      // incomplete for inputs that already contain `\`. One callback
      // visits each char exactly once, so neither character can be
      // re-escaped after it's been escaped.
      const appleScript = `tell application "Terminal" to do script "${script.replace(/[\\"]/g, (c) => '\\' + c)}"`;
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
  // Safety timeout: close splash after 15s even if ready-to-show never fires
  // (prevents macOS users from getting stuck on an unresponsive splash)
  startSplashTimeout(15000);

  try {
    // Initialize local database for offline support (non-fatal if it fails)
    try {
      initLocalDb();
    } catch (dbErr) {
      console.error('[APP] Local DB init failed — offline support disabled:', dbErr.message);
    }

    // Start connectivity check in parallel with window creation.
    // Old behaviour blocked on 5 × 2s retries before createMainWindow(),
    // leaving macOS users staring at the splash for up to 10s before
    // the window even began loading. Now the window starts immediately
    // and the connectivity result is used only to seed the monitor.
    const connectivityPromise = checkServerConnectivity();

    createMenu();
    await createMainWindow();
    createTray();

    // Await connectivity (usually already resolved by now)
    const isReachable = await connectivityPromise;
    if (!isReachable) {
      console.warn('[APP] Server unreachable at startup');
    }

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
