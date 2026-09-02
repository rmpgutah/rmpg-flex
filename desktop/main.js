// ============================================================
// RMPG Flex — Electron Main Process (Thin Client)
// Loads the RMPG Flex web application from the remote server.
// All data, authentication, and business logic live on the VPS.
// The desktop app provides: native window, system tray, and
// automatic updates via electron-updater.
// ============================================================

const { app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage, ipcMain, net, powerSaveBlocker, safeStorage, powerMonitor, screen, globalShortcut, clipboard } = require('electron');
const path = require('path');
const { AppUpdater } = require('./updater');
const { createIpcGuards, createLocalFileIpcGuards, sanitizeReconToolArgs, validatePinInput, validateUserIdInput, validateFilePathInput, validateGlobalShortcutAccelerator, createRateLimiter, requireOfflineAuthForSensitiveIpc, auditIpcHandlerRegistry, validateKioskEscapeCredentials } = require('./security/ipcGuard');
const { installContentSecurityPolicy, isPermissionAllowed, shouldAllowNavigation, shouldAllowNewWindow, hardenWebPreferencesDefaults, assertSecureElectronDefaults, shouldExposeDevToolsMenuItem, createCertificateVerifyProc, resolveTrustedPreloadPath } = require('./security/sessionHardening');
const { hardenGuestWebPreferences, shouldAllowGuestNavigation, isCompanyBrowserRoleAllowed } = require('./security/webviewHardening');
const { decryptPasswordHashOrFallback, decryptSecretForStorage, encryptDiagnosticsBundleOnExport, validateBackupFileBeforeImport } = require('./security/secretsStore');
const { isJwtExpiredLocally, extractSessionIdentity, getOrCreateDeviceId, isPinSessionBoundToDevice, pruneOldPinAttempts, invalidateAllActivePinSessions, isReconLaunchAuthorized, detectClockSkew, looksLikeSecretValue, assertWebPreferencesNotWeaker } = require('./security/sessionAuth');
const { buildSandboxedChildEnv, scheduleChildProcessTimeout, resolveChildProcessTimeoutMs, DEFAULT_CHILD_PROCESS_TIMEOUT_MS, isAtConcurrencyLimit, MAX_CONCURRENT_TOOLS, isAllowedBinaryName, isAllowedApiHost, parseIpLocateResponse, withRequestTimeout, DEFAULT_IPC_REQUEST_TIMEOUT_MS, OFFLINE_TRIGGER_SYNC_TIMEOUT_MS, formatSecurityAuditLine, appendSecurityAuditLog, evaluateInsecureElectronFlagsEscalation, runHardeningSelfTest } = require('./security/childProcessGuard');
const { getDiskBytes, getDiskFreeBytes, formatSystemInfo, getCpuUsagePercent, appendToLogFile, tailLogFile, getLogsDirectory, buildDiagnosticsBundleText, listCrashReports, evaluateDiskSpace, formatNetworkInterfaces, parsePmsetBatteryOutput } = require('./systemInfo');
const { createFaceAuth } = require('./faceAuth');
const { CameraScanner } = require('./cameraScanner');
const {
  parseWindowsBatteryOutput, parseWindowsDockOutput, parseWindowsWwanOutput,
  parseWindowsTpmOutput, classifyKeystrokeBurst, filterPrintableKeydown,
  parseWindowsThermalOutput, parseWindowsSmartCardOutput, parseWindowsFingerprintOutput,
  parseWindowsWwanSignalOutput, parseBodyCamHidReport,
} = require('./hardwareFz55');
const { buildSaveDialogOptions, buildOpenDialogOptions, resolveAllowedRoots, isLocalDbPath, formatPrinters, isKnownPrinterName, encodeBackupForExport, decodeBackupForImport, swapInLocalDbWithRollback } = require('./fileOps');
const { formatSerialPorts, parseSystemProfilerBluetoothOutput, classifyGpsPresence, formatDisplays } = require('./deviceInfo');
const { buildSecondaryWindowUrl, coerceBadgeCount, isValidTrayStatus, formatTrayTooltip, restoreWindowBounds, saveWindowBounds } = require('./windowManager');
const { buildShellRegistryValue, MAX_BOOT_FAILURES, resetBootAttemptState, nextBootAttemptState, shouldSelfRevert, KIOSK_ESCAPE_ACCELERATORS, selectEscapeAccelerator, shouldUseKioskChrome, shouldRelaunchOnAllWindowsClosed, validateEscapeLoginResponse, validateFlexOsLoginResponse } = require('./kioskShell');
const { isRecoverableCrashReason, shouldAutoRecover, recordRecoveryAttempt } = require('./crashRecovery');
const { runRfScan } = require('./rfScanner');
const { parseNetshScanNetworks, parseNetshListProfiles, parseNetshGetDetail } = require('./wifiInfo');
const fs = require('fs');

// ─── Lazy-load native modules ─────────────────────────────────
// better-sqlite3 is a native (C++) add-on that must be compiled for
// the exact Electron ABI + architecture. If the rebuild failed or the
// binary is missing (common on first macOS launch after a bad build),
// eagerly requiring it crashes the entire app before the splash even
// shows. Load lazily so the app can start with offline support
// gracefully disabled.
let initLocalDb, getLocalDb, closeLocalDb, getLocalDbPath, getConfig, setConfig, getQueueDepth, getSyncMeta, getSyncQueueDetail, retrySyncQueueItem, clearFailedSyncItems, getLastSyncError, getLocalCacheStats, clearLocalCache;
try {
  ({ initLocalDb, getLocalDb, closeLocalDb, getLocalDbPath, getConfig, setConfig, getQueueDepth, getSyncMeta, getSyncQueueDetail, retrySyncQueueItem, clearFailedSyncItems, getLastSyncError, getLocalCacheStats, clearLocalCache } = require('./localDb'));
} catch (err) {
  console.error('[APP] Failed to load localDb (better-sqlite3 native module):', err.message);
  console.error('[APP] Offline support will be disabled this session.');
  // Provide no-op stubs so the rest of main.js doesn't crash on calls
  initLocalDb = () => { console.warn('[LOCAL-DB] Unavailable — native module failed to load'); };
  getLocalDb = () => null;
  closeLocalDb = () => {};
  getLocalDbPath = () => null;
  getConfig = () => null;
  setConfig = () => {};
  getQueueDepth = () => 0;
  getSyncMeta = () => null;
  getSyncQueueDetail = () => [];
  retrySyncQueueItem = () => ({ ok: false, error: 'local DB unavailable' });
  clearFailedSyncItems = () => ({ cleared: 0 });
  getLastSyncError = () => null;
  getLocalCacheStats = () => [];
  clearLocalCache = () => ({ ok: false, error: 'local DB unavailable' });
}

const { ConnectivityMonitor } = require('./connectivityMonitor');
const { InternalGps, findGpsPort, listSerialPorts, probeGpsPortOpen } = require('./internalGps');

// ─── Chromium Geolocation ────────────────────────────────────
// Chromium's Network Location Provider requires a Google API key to resolve
// WiFi/IP-based positions via navigator.geolocation. Set GOOGLE_API_KEY in
// the environment before launching if WiFi geolocation is needed. GPS hardware
// runs independently through InternalGps and is unaffected when this is unset.
// (Key removed from source — set via environment variable instead.)

// ─── Configuration ──────────────────────────────────────────
const APP_TITLE = 'RMPG Flex — CAD/RMS';
const DEV_MODE = process.argv.includes('--dev');
const KIOSK_SHELL_ARGV = process.argv.includes('--kiosk-shell');

// Remote server URL — the single source of truth for the app shell this
// window loads.
// In dev mode, points at the local Vite client dev server (`cd client &&
// npm run dev`, port 5173 per CLAUDE.md) — NOT localhost:3001, which was
// the retired VPS-era Express server's port. That server (and the rest of
// legacy/server-vps/) was deleted outright in the 2026-07-16 repo cleanup,
// so --dev pointing at :3001 meant `npm start` in this directory loaded a
// dead endpoint (ERR_CONNECTION_REFUSED on every asset) for anyone who ran
// it after that cleanup. The client's own API calls (apiFetch) already
// separately target localhost:8787 (`npm run dev` in the repo root,
// `wrangler dev`) in dev mode — this URL only controls the page shell.
// In production, points at the live Cloudflare Pages app.
const REMOTE_SERVER_URL = DEV_MODE
  ? 'http://localhost:5173'
  : (process.env.UPDATE_SERVER_URL || 'https://rmpgutah.us');
const UPDATE_SERVER_URL = DEV_MODE
  ? 'http://localhost:3001'
  : 'github';

// API server used ONLY by the kiosk escape hatch's live login check — this
// intentionally does NOT reuse REMOTE_SERVER_URL (the app-shell host); the
// escape hatch calls the API directly since the renderer/app-shell may be
// unresponsive when this is needed.
const KIOSK_ESCAPE_API_BASE = DEV_MODE
  ? 'http://localhost:8787'
  : 'https://api.rmpgutah.us';

// Regression guard (see isAllowedApiHost's doc comment in childProcessGuard.js
// and GEO_IP_LOCATE_ALLOWED_HOSTS further down for the same rationale) for the
// escape hatch's outbound login request — KIOSK_ESCAPE_API_BASE is a
// hardcoded/env-derived constant today, not renderer-influenced, so this
// doesn't close an active vulnerability; it's a tripwire against a future
// accidental change to the request URL. Computed once at module load, fails
// closed to `null` (which isAllowedApiHost never matches) if unparseable.
let KIOSK_ESCAPE_API_HOSTNAME;
try {
  KIOSK_ESCAPE_API_HOSTNAME = new URL(KIOSK_ESCAPE_API_BASE).hostname;
} catch {
  KIOSK_ESCAPE_API_HOSTNAME = null;
}

// ─── Trusted host (shared by window-open filtering and IPC sender validation) ───
let TRUSTED_HOST;
try {
  TRUSTED_HOST = new URL(REMOTE_SERVER_URL).host;
} catch {
  TRUSTED_HOST = 'rmpgutah.us';
}

// Hostname-only (no port) form of REMOTE_SERVER_URL, computed once at module
// load, used by isAllowedApiHost() to pin main-process net.request calls that
// target the remote server (e.g. the startup connectivity health check below).
// Regression-guard framing, same as GEO_IP_LOCATE_ALLOWED_HOSTS further down:
// REMOTE_SERVER_URL is a const/env-derived value, never renderer-influenced,
// so this doesn't close an active vulnerability — it's a tripwire against a
// future accidental change to the request URL. Fails closed to `null` (which
// isAllowedApiHost never matches) if REMOTE_SERVER_URL is somehow unparseable.
let REMOTE_SERVER_HOSTNAME;
try {
  REMOTE_SERVER_HOSTNAME = new URL(REMOTE_SERVER_URL).hostname;
} catch {
  REMOTE_SERVER_HOSTNAME = null;
}

// Health checks go DIRECTLY to the API Worker's /api/health endpoint, which
// has a Cloudflare WAF skip rule that bypasses the managed challenge. The old
// approach (REMOTE_SERVER_URL/api/health = rmpgutah.us/api/health) went through
// the strangler proxy and hit the managed challenge — net.request can't solve
// that challenge (no JS execution), so every cold boot reported the server as
// unreachable until the BrowserWindow solved the challenge 10-30s later.
const HEALTH_CHECK_URL = DEV_MODE
  ? `${REMOTE_SERVER_URL}/api/health`
  : 'https://api.rmpgutah.us/api/health';

let HEALTH_CHECK_HOSTNAME;
try {
  HEALTH_CHECK_HOSTNAME = new URL(HEALTH_CHECK_URL).hostname;
} catch {
  HEALTH_CHECK_HOSTNAME = null;
}

const LOG_FILE_PATH = path.join(app.getPath('userData'), 'rmpg-flex.log');

// Task 8 (childProcessGuard.js): a dedicated audit trail for the small
// set of security-relevant IPC channels (PIN generation, recon tool
// spawn, DB backup import/export, global shortcut registration) — kept
// separate from the general-purpose LOG_FILE_PATH so it stays pure
// single-line JSON (see formatSecurityAuditLine's doc comment for why
// that rules out reusing systemInfo.js's appendToLogFile, which prefixes
// its own timestamp ahead of the message).
const SECURITY_AUDIT_LOG_PATH = path.join(app.getPath('userData'), 'rmpg-flex-security-audit.log');

/**
 * Formats and appends one security-relevant IPC audit event to
 * SECURITY_AUDIT_LOG_PATH. Never throws — a logging failure (e.g. a full
 * disk) must not break the IPC handler that called it; any fs error is
 * caught and reported via console.error only.
 */
function logSecurityAuditEvent(channel, outcome, detail) {
  try {
    const line = formatSecurityAuditLine({
      channel,
      userId: getConfig('current_user_id') || null,
      outcome,
      detail,
    });
    appendSecurityAuditLog(line, require('fs'), SECURITY_AUDIT_LOG_PATH);
  } catch (err) {
    console.error('[SECURITY-AUDIT] Failed to write audit log entry:', err && err.message);
  }
}

const { guardedHandle, guardedOn } = createIpcGuards(ipcMain, TRUSTED_HOST);

// Shared per-channel call-rate limiter for the recon spawn/catalog and
// offline-sync-trigger channels — these kick off child processes or network
// calls, so a compromised/misbehaving renderer shouldn't be able to hammer
// them.
const { checkRateLimit } = createRateLimiter(10, 60_000); // 10 calls/min per channel

let mainWindow = null;
let splashWindow = null;
let tray = null;
let isQuitting = false;
let appReady = false;
let faceAuth = null; // initialized after localDb is ready
let cameraScanner = null;

// Rolling-window crash-recovery timestamps for the main window's renderer
// and GPU-process crashes — see crashRecovery.js. Kept at module scope
// (not per-window) so the cap holds across a window recreated mid-session.
let rendererRecoveryTimestamps = [];

// ─── Kiosk-shell auto-relaunch bookkeeping ────────────────────
// See docs/superpowers/specs/2026-07-21-desktop-kiosk-shell-mode-design.md,
// Component 3: on a graceful quit while this instance is running AS the
// Windows shell (isKioskShell/useKioskChrome in createMainWindow), the app
// must relaunch itself rather than actually exit — a normal shell
// (explorer.exe) is always expected to be present, and exiting for good
// would leave the machine on a black screen with the escape hotkey
// unregistered and no way back in.
// isRunningAsKioskShell is set once per createMainWindow() call (i.e. once
// per boot/relaunch), so it composes correctly with the self-revert boot
// counter in createMainWindow — it never bypasses or races that counter.
let isRunningAsKioskShell = false;
let kioskBootStabilityTimer = null;
// kioskDeliberatelyReverting is set just before the registry is reverted to
// explorer.exe via an intentional admin action (disabling Kiosk Mode from
// Settings, or the Ctrl+Alt+Shift+F12 escape hatch) so that a subsequent
// window-all-closed during that deliberate revert-and-restart doesn't loop
// back into relaunching as the kiosk shell.
let kioskDeliberatelyReverting = false;

// Debounce timer for the main window's 'resize'/'move' listeners below —
// those events fire continuously (every pixel) during a drag/resize
// gesture, so writing to the local DB on every single one would be
// wasteful and could add jank to the gesture itself. See createMainWindow().
let boundsSaveDebounceTimer = null;
const BOUNDS_SAVE_DEBOUNCE_MS = 500;

// Cached Windows account info for the startup lock screen.
// undefined = not yet fetched; null = fetched but unavailable (non-win32 or error).
let cachedWindowsAccountInfo = undefined;

// Tracks whether the splash window's did-finish-load has fired.
// The Promise.all phase transition may resolve before the page finishes
// loading; this flag lets the transition queue itself until the page is ready.
let splashLoaded = false;
let splashPhasePending = null;

// Secondary (non-main) windows opened via 'window:open-secondary', keyed by
// a server-generated UUID so the renderer never handles a raw BrowserWindow
// reference. Entries are removed on the window's own 'closed' event so this
// map never accumulates references to destroyed windows.
const secondaryWindows = new Map();

// ─── Last-resort error guards ────────────────────────────────
// Without these, an unhandled rejection (e.g. loadURL rejecting
// with net::ERR_CONNECTION_CLOSED when nginx RSTs an in-flight
// connection during a `systemctl restart rmpg-flex`) crashes the
// whole desktop app and shows the Electron error dialog.
//
// isTransientNetworkError() decides whether to swallow the error
// (keep the dispatcher connected) or re-throw (surface real bugs).
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
  try {
    appendToLogFile(`Unhandled rejection: ${reason && reason.message}`, LOG_FILE_PATH, require('fs'));
  } catch { /* logging must never crash the crash handler */ }
  throw reason;
});

process.on('uncaughtException', (err) => {
  if (isTransientNetworkError(err)) {
    console.warn('[APP] Swallowed transient network error:', err && err.message);
    return;
  }
  console.error('[APP] Uncaught exception:', err);
  try {
    appendToLogFile(`Uncaught exception: ${err && err.message}`, LOG_FILE_PATH, require('fs'));
  } catch { /* logging must never crash the crash handler */ }
  // Re-throw on next tick so Electron's default crash dialog still
  // fires for real bugs, but our log line lands first.
  setImmediate(() => { throw err; });
});
const appUpdater = new AppUpdater();
let connectivityMonitor = null;

// ── WWAN live push ────────────────────────────────────────────
let _lastWwanState = null;
const WWAN_PUSH_INTERVAL = 30_000;
function pushWwanIfChanged() {
  if (process.platform !== 'win32') return;
  const { execFile } = require('child_process');
  execFile(
    'powershell.exe',
    ['-NoProfile', '-Command',
      "Get-NetAdapter | Where-Object {$_.InterfaceDescription -match 'Sierra|EM74|EM75|EM91'} | Select-Object Name, Status | ConvertTo-Json"],
    { timeout: 3000 },
    (err, stdout) => {
      if (err) return;
      const state = parseWindowsWwanOutput(stdout);
      const changed = !_lastWwanState ||
        state.present !== _lastWwanState.present ||
        state.connected !== _lastWwanState.connected;
      if (changed) {
        _lastWwanState = state;
        mainWindow?.webContents.send('hardware:wwan-changed', state);
      }
    }
  );
}
let _wwanPushTimer = null;
function startWwanPush() {
  if (_wwanPushTimer) return;
  pushWwanIfChanged();
  _wwanPushTimer = setInterval(pushWwanIfChanged, WWAN_PUSH_INTERVAL);
}

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
          // Last resort if extraResources were stripped (e.g. unpacked run)
          path.join(__dirname, '..', 'client', 'public', 'rmpg flex.png'),
        ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const ext = path.extname(p).slice(1).toLowerCase() || 'png';
        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        const b64 = fs.readFileSync(p).toString('base64');
        console.log('[SPLASH] logo loaded from', p);
        return `data:${mime};base64,${b64}`;
      }
    }
    console.warn('[SPLASH] no logo file found — using text fallback');
  } catch (err) {
    console.warn('[SPLASH] logo load failed:', err && err.message);
  }
  return ''; // Fall back to text logo if image unavailable
}

function createSplashWindow() {
  if (!app.isReady()) { console.warn('[APP] createSplashWindow called before ready — skipping'); return; }

  const splashPreloadPath = resolveTrustedPreloadPath(
    path.join(__dirname, 'splashPreload.js'),
    path.join(__dirname, 'splashPreload.js')
  );

  // Full-screen on Windows (kiosk shell context); standard splash size elsewhere.
  const isWin = process.platform === 'win32';
  const { width: screenW, height: screenH } = isWin
    ? screen.getPrimaryDisplay().bounds
    : { width: 520, height: 400 };

  splashWindow = new BrowserWindow({
    width: screenW,
    height: screenH,
    x: 0,
    y: 0,
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    center: !isWin,
    skipTaskbar: true,
    hasShadow: false,
    thickFrame: false,
    backgroundColor: '#000000',
    webPreferences: hardenWebPreferencesDefaults({
      preload: splashPreloadPath,
    }),
  });

  splashWindow.loadFile(SPLASH_PAGE_PATH).catch((err) => {
    console.warn('[SPLASH] loadFile failed:', err && err.message);
  });

  // Inject the RMPG logo into the boot phase once the page is ready.
  // Also flush any phase message that was queued before did-finish-load fired.
  splashLoaded = false;
  splashPhasePending = null;
  splashWindow.webContents.once('did-finish-load', () => {
    splashLoaded = true;
    const logoUri = getSplashLogoDataUri();
    if (logoUri && splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.executeJavaScript(
        `(function(){
          var img = document.getElementById('boot-logo');
          var fallback = document.getElementById('boot-logo-fallback');
          if (img) { img.src = ${JSON.stringify(logoUri)}; img.style.display = ''; }
          if (fallback) { fallback.style.display = 'none'; }
          document.documentElement.style.setProperty('--rmpg-logo-url', 'url(' + ${JSON.stringify(logoUri)} + ')');
        })();`
      ).catch(() => {});
    }
    // Deliver any phase message that was queued before this event fired.
    if (splashPhasePending && splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('splash:phase', splashPhasePending);
      splashPhasePending = null;
    }
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

/**
 * Reads the signed-in Windows account name and profile picture for display
 * on the startup lock screen. Runs once at boot; result cached in
 * cachedWindowsAccountInfo. Returns null on non-win32 or any error.
 */
async function getWindowsAccountInfo() {
  if (cachedWindowsAccountInfo !== undefined) return cachedWindowsAccountInfo;
  if (process.platform !== 'win32') {
    cachedWindowsAccountInfo = null;
    return null;
  }

  const { promisify } = require('util');
  const execFileAsync = promisify(require('child_process').execFile);
  const os = require('os');
  const fsMod = require('fs');
  const pathMod = require('path');

  let name = os.userInfo().username;
  let fullName = null;
  let avatarDataUri = null;

  // 1. Get full name from Get-LocalUser (3s timeout — WMI starts during boot)
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command',
        'Get-LocalUser $env:USERNAME | Select-Object Name,FullName | ConvertTo-Json'],
      { timeout: 3000, windowsHide: true }
    );
    const parsed = JSON.parse(stdout.trim());
    if (parsed && typeof parsed.Name === 'string' && parsed.Name) name = parsed.Name;
    if (parsed && typeof parsed.FullName === 'string' && parsed.FullName.trim()) {
      fullName = parsed.FullName.trim();
    }
  } catch (err) {
    console.warn('[ACCOUNT] Get-LocalUser failed:', err.message);
  }

  // 2. Find account picture — pick the largest PNG/JPG by file size
  try {
    const picDir = pathMod.join(
      process.env.USERPROFILE || os.homedir(),
      'AppData', 'Roaming', 'Microsoft', 'Windows', 'AccountPictures'
    );
    if (fsMod.existsSync(picDir)) {
      const files = fsMod.readdirSync(picDir)
        .filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
        .map((f) => {
          const full = pathMod.join(picDir, f);
          return { full, size: fsMod.statSync(full).size };
        })
        .sort((a, b) => b.size - a.size);
      if (files.length > 0) {
        const best = files[0].full;
        const ext = pathMod.extname(best).slice(1).toLowerCase();
        const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'image/png';
        const b64 = fsMod.readFileSync(best).toString('base64');
        avatarDataUri = `data:${mime};base64,${b64}`;
      }
    }
  } catch (err) {
    console.warn('[ACCOUNT] Avatar lookup failed:', err.message);
  }

  cachedWindowsAccountInfo = { name, fullName, avatarDataUri };
  return cachedWindowsAccountInfo;
}

// ─── Server Connectivity Check ──────────────────────────────
/**
 * Verify that the remote RMPG Flex server is reachable.
 * Retries a few times with short delays before giving up.
 */
function checkServerConnectivity(opts) {
  return new Promise((resolve) => {
    let attempts = 0;
    // In kiosk shell mode, Windows starts this app before the network stack
    // is fully up. Give it more time: 8 × 3s = 24s max. In normal mode,
    // 3 × 2s = 6s is plenty (and a hung connectivity check stalls the splash).
    const maxAttempts = (opts && opts.kioskShell) ? 8 : 3;
    const delayMs = (opts && opts.kioskShell) ? 3000 : 2000;
    let resolved = false;

    function tryConnect() {
      if (resolved) return;
      attempts++;
      console.log(`[APP] Connectivity check attempt ${attempts}/${maxAttempts}: ${HEALTH_CHECK_URL}`);

      if (!isAllowedApiHost(HEALTH_CHECK_URL, [REMOTE_SERVER_HOSTNAME, HEALTH_CHECK_HOSTNAME].filter(Boolean))) {
        console.error('[APP] Connectivity check blocked: URL host not allowlisted');
        resolved = true;
        resolve(false);
        return;
      }

      const request = net.request(HEALTH_CHECK_URL);

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
 * Auto-retries every 5 seconds with a countdown, and reloads
 * instantly when the Electron connectivity monitor fires.
 * Blue & Silver themed to match the app.
 */
function getOfflineHTML() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: Arial, sans-serif;
          background: #172a3f;
          color: #f0f4f9;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          text-align: center;
          padding: 40px;
        }
        .card {
          background: #1e3550;
          border: 1px solid #2a4a6b;
          border-radius: 2px;
          padding: 40px 36px;
          max-width: 440px;
        }
        .icon {
          width: 56px; height: 56px; margin: 0 auto 20px;
          opacity: 0.7;
        }
        .icon svg {
          width: 100%; height: 100%;
          stroke: #c3ccd6; fill: none;
          stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round;
        }
        h1 {
          font-size: 20px;
          font-weight: 700;
          margin-bottom: 10px;
          color: #f0f4f9;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        p {
          font-size: 13px;
          color: #8fa3b8;
          max-width: 380px;
          line-height: 1.6;
          margin-bottom: 24px;
        }
        .retry-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          margin-bottom: 16px;
        }
        button {
          padding: 10px 28px;
          font-size: 12px;
          font-weight: 700;
          background: #2a4a6b;
          color: #f0f4f9;
          border: 1px solid #3b6a9a;
          border-radius: 2px;
          cursor: pointer;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-family: Arial, sans-serif;
          transition: background 0.15s;
        }
        button:hover { background: #3b6a9a; }
        .countdown {
          font-size: 11px;
          color: #8fa3b8;
          font-family: Arial, sans-serif;
          min-width: 120px;
        }
        .server-url {
          margin-top: 16px;
          font-size: 10px;
          color: #4a6a8a;
          font-family: Arial, sans-serif;
        }
        .status-dot {
          display: inline-block;
          width: 8px; height: 8px;
          border-radius: 50%;
          background: #ef4444;
          margin-right: 6px;
          animation: pulse-dot 2s ease-in-out infinite;
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .reconnecting .status-dot {
          background: #f59e0b;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">
          <svg viewBox="0 0 24 24">
            <line x1="1" y1="1" x2="23" y2="23"/>
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
            <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
            <line x1="12" y1="20" x2="12.01" y2="20"/>
          </svg>
        </div>
        <h1><span class="status-dot"></span>Connection Lost</h1>
        <p>Unable to connect to the RMPG Flex server. Please check your internet connection and try again.</p>
        <div class="retry-row">
          <button onclick="attemptRetry()" id="retryBtn">Retry Connection</button>
          <span class="countdown" id="countdown">Retrying in 5s...</span>
        </div>
        <div class="server-url">${REMOTE_SERVER_URL}</div>
      </div>
      <script>
        var RETRY_INTERVAL = 5;
        var remaining = RETRY_INTERVAL;
        var timer = null;
        var countdownEl = document.getElementById('countdown');
        var retryBtn = document.getElementById('retryBtn');
        var cardEl = document.querySelector('.card');

        function attemptRetry() {
          countdownEl.textContent = 'Connecting...';
          retryBtn.disabled = true;
          cardEl.classList.add('reconnecting');
          if (timer) { clearInterval(timer); timer = null; }
          window.location.href = '${REMOTE_SERVER_URL}';
        }

        function tick() {
          remaining--;
          if (remaining <= 0) {
            attemptRetry();
          } else {
            countdownEl.textContent = 'Retrying in ' + remaining + 's...';
          }
        }

        function startCountdown() {
          remaining = RETRY_INTERVAL;
          countdownEl.textContent = 'Retrying in ' + remaining + 's...';
          if (timer) clearInterval(timer);
          timer = setInterval(tick, 1000);
        }

        startCountdown();
      </script>
    </body>
    </html>
  `)}`;
}

// ─── Crash Recovery — Repeated Crash Page ──────────────────
/**
 * Shown when the renderer/GPU has crashed and auto-recovered more than
 * crashRecovery.MAX_RENDERER_RECOVERIES times within the rolling window —
 * a genuinely failing unit, not a one-off transient loss. Auto-reloading
 * past this point would just crash-loop silently with no console access in
 * the field to show why, so this is a terminal, static screen instead.
 */
function getCrashLoopHTML() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: Arial, sans-serif;
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
        .icon { font-size: 64px; margin-bottom: 24px; opacity: 0.6; }
        h1 { font-size: 22px; font-weight: 600; margin-bottom: 12px; color: #e0e0e0; }
        p { font-size: 14px; color: #888; max-width: 440px; line-height: 1.6; margin-bottom: 8px; }
        .hint { font-size: 12px; color: #666; margin-top: 24px; }
      </style>
    </head>
    <body>
      <div class="icon">&#9888;&#65039;</div>
      <h1>RMPG Flex Needs a Restart</h1>
      <p>The app has crashed and recovered several times in a row. This usually means a display driver or hardware problem on this unit.</p>
      <p>Please fully close and reopen RMPG Flex. If this keeps happening, contact IT/Fleet support.</p>
      <div class="hint">Automatic recovery paused to avoid repeating the crash.</div>
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

  // Reset WWAN state so the first comparison after window recreation
  // doesn't produce a stale "changed" event from the previous session.
  _lastWwanState = null;

  // Restore the window's last-saved position/size, if any is on record AND
  // it still lands on a currently-connected display (see
  // boundsIntersectSomeDisplay in windowManager.js — a bounds saved from a
  // second monitor that's since been unplugged is discarded here rather
  // than restored off-screen with no way to drag it back).
  const restoredBounds = restoreWindowBounds(getConfig, screen.getAllDisplays);

  // ─── Kiosk boot detection + self-revert safety net ───────────
  // See docs/superpowers/specs/2026-07-21-desktop-kiosk-shell-mode-design.md.
  // Every boot while the shell registry key points at this app counts as a
  // "kiosk boot attempt" — if MAX_BOOT_FAILURES consecutive boots reach this
  // point without a successful ready-to-show (see the counter reset below),
  // the shell key is reverted back to explorer.exe so the machine never
  // gets stuck showing a black kiosk screen with no way back in.
  // Detect kiosk mode from either: (1) the config flag set by in-app Settings,
  // or (2) the --kiosk-shell argument passed by the Winlogon registry launch.
  const isKioskShell = process.platform === 'win32' && (getConfig('kiosk_shell_enabled') === true || KIOSK_SHELL_ARGV);
  // If launched with --kiosk-shell but config not yet set, persist it now so
  // subsequent boots and renderer queries see the correct state.
  if (isKioskShell && getConfig('kiosk_shell_enabled') !== true) {
    setConfig('kiosk_shell_enabled', true);
    console.log('[KIOSK] Detected --kiosk-shell argv — enabling kiosk_shell_enabled config');
  }
  // Module-level flag consulted by the 'window-all-closed' handler below.
  // Set from isKioskShell — "did Windows launch this process as the login
  // shell" — and NOT from useKioskChrome, which answers a different question
  // (see shouldUseKioskChrome / shouldRelaunchOnAllWindowsClosed in
  // kioskShell.js). Tying it to useKioskChrome meant every path that fell
  // back to a normal window while the registry still pointed here — a failed
  // self-revert, an unavailable escape accelerator — also silently opted out
  // of relaunch-on-close, i.e. exited and left the session with no shell.
  isRunningAsKioskShell = isKioskShell;
  // Terminate Windows 11 shell host processes so the Start Menu, Win key, and
  // Windows taskbar cannot appear over FlexOS when it is running as the shell.
  // Fire-and-forget — startup must not block waiting for taskkill to finish.
  if (isKioskShell) suppressWindowsShellProcesses();
  let kioskBootState = null;
  let kioskRevertSucceeded = false;
  if (isKioskShell) {
    kioskBootState = nextBootAttemptState(getConfig('kiosk_boot_attempts'));
    setConfig('kiosk_boot_attempts', kioskBootState);
    if (shouldSelfRevert(kioskBootState)) {
      console.error(`[KIOSK] ${MAX_BOOT_FAILURES} consecutive failed boots — self-reverting shell to explorer.exe`);
      const revert = await deleteHkcuShell();
      kioskRevertSucceeded = revert.ok;
      if (revert.ok) {
        setConfig('kiosk_shell_enabled', false);
        setConfig('kiosk_boot_attempts', resetBootAttemptState());
        dialog.showErrorBox(
          'RMPG Flex Kiosk Mode Disabled',
          `Kiosk Mode failed to start ${MAX_BOOT_FAILURES} times in a row and has been automatically disabled. Windows will use its normal desktop from now on.`
        );
      } else {
        // The HKCU Shell delete failed unexpectedly (permissions issue or
        // locked registry hive). The Winlogon shell key still points at this
        // app, so kiosk_shell_enabled and the boot counter are deliberately
        // left ALONE: clearing them here would tell the next boot "kiosk is
        // off" while Windows still starts us as the shell, which drops the
        // escape hotkey and turns the next window close into a black screen.
        // Leaving the counter above the limit means the next boot retries.
        console.error('[KIOSK] self-revert failed, shell key unchanged:', revert.error);
        dialog.showErrorBox(
          'RMPG Flex Kiosk Mode Could Not Be Disabled',
          `Kiosk Mode failed to start ${MAX_BOOT_FAILURES} times in a row, but the Windows shell setting could not be restored (${revert.error}).\n\n`
            + `This computer is still set to start RMPG Flex instead of the normal desktop. Press ${KIOSK_ESCAPE_ACCELERATORS[0]} to exit Kiosk Mode, `
            + 'or contact IT support for a manual registry revert.'
        );
      }
      // Fall through to a window either way — do not exit, so the operator
      // still gets a usable app window this run.
    }
  }

  // Fallback: if ready-to-show never fires (renderer crash, GPU hang, load
  // timeout), reset the boot counter after 60 s of the process staying alive.
  // This prevents transient startup hiccups from accumulating across reboots
  // and eventually self-reverting a machine that IS recovering each time.
  if (isKioskShell && !kioskRevertSucceeded) {
    kioskBootStabilityTimer = setTimeout(() => {
      kioskBootStabilityTimer = null;
      setConfig('kiosk_boot_attempts', resetBootAttemptState());
      console.log('[KIOSK] boot stability timer elapsed — counter reset');
    }, 60_000);
  }

  // ─── Escape hatch shortcut (registered BEFORE entering kiosk chrome) ──
  // Ordering matters: never enter a mode the operator cannot leave. If no
  // accelerator can be claimed, useKioskChrome below stays false and this
  // launch renders as a normal window instead of a frameless kiosk with no
  // way out. globalShortcut.register returns false when another process
  // already owns the combination — the return value was previously ignored.
  let kioskEscapeAccelerator = null;
  if (isKioskShell && !kioskRevertSucceeded) {
    kioskEscapeAccelerator = selectEscapeAccelerator(
      KIOSK_ESCAPE_ACCELERATORS,
      (accelerator) => globalShortcut.register(accelerator, () => openKioskEscapeWindow())
    );
    if (kioskEscapeAccelerator) {
      console.log(`[KIOSK] escape hatch bound to ${kioskEscapeAccelerator}`);
    } else {
      console.error('[KIOSK] no escape accelerator available — refusing to enter kiosk chrome');
      dialog.showErrorBox(
        'RMPG Flex Kiosk Mode Not Started',
        'Kiosk Mode could not reserve a keyboard shortcut for its exit prompt, because another program on this computer is already using all of them:\n\n'
          + `${KIOSK_ESCAPE_ACCELERATORS.join('\n')}\n\n`
          + 'RMPG Flex has started in a normal window instead so you are not locked in. Close the other program and restart, or disable Kiosk Mode in Settings.'
      );
    }
  }

  const useKioskChrome = shouldUseKioskChrome({
    isKioskShell,
    revertSucceeded: kioskRevertSucceeded,
    escapeAcceleratorRegistered: kioskEscapeAccelerator !== null,
  });

  mainWindow = new BrowserWindow({
    ...(useKioskChrome
      ? { kiosk: true, frame: false, fullscreen: true, autoHideMenuBar: true }
      : {
          fullscreen: process.platform === 'win32',
          width: 1440,
          height: 900,
          ...(restoredBounds ? { x: restoredBounds.x, y: restoredBounds.y, width: restoredBounds.width, height: restoredBounds.height } : {}),
          minWidth: 1024,
          minHeight: 700,
        }),
    title: APP_TITLE,
    backgroundColor: '#000000',
    show: false,
    webPreferences: hardenWebPreferencesDefaults({
      preload: resolveTrustedPreloadPath(path.join(__dirname, 'preload.js'), path.join(__dirname, 'preload.js')),
      // Keep the renderer running at full rate when the window is minimized,
      // occluded, or otherwise not focused. Chromium throttles background
      // windows by default — setInterval clamped to ~1/min, rAF paused — which
      // slowed the nav trip engine's 15s route-upload + 30s auto-end checks to
      // a crawl whenever the officer switched away from the CAD. The GPS NMEA
      // reader lives in the main process (never throttled), but the detection +
      // upload logic runs here in the renderer, so it must not be throttled for
      // navigation to keep calculating + recording movement off-screen.
      backgroundThrottling: false,
      // webviewTag is required for the in-app Company Browser (CompanyBrowserPage).
      // This is an enterprise-only, locked-down Toughbook — the session permission
      // handler, CSP, and webview hardening (security/webviewHardening.js) collectively
      // gate what the <webview> guest can load and navigate to.
      webviewTag: true,
    }),
    // macOS titlebar
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 12, y: 12 },
  });
  if (useKioskChrome) Menu.setApplicationMenu(null);

  // ── Grant geolocation permission automatically ──────────
  // Electron denies geolocation by default. For RMPG Flex, GPS
  // tracking is mandatory for all logged-in users — auto-grant it.
  mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      let requestingHost;
      try {
        requestingHost = new URL(webContents.getURL()).host;
      } catch {
        requestingHost = '';
      }
      callback(isPermissionAllowed(requestingHost, TRUSTED_HOST, permission));
    }
  );

  // Also handle the newer permission-check API (Electron 20+)
  mainWindow.webContents.session.setPermissionCheckHandler(
    (webContents, permission) => {
      let requestingHost;
      try {
        requestingHost = new URL(webContents.getURL()).host;
      } catch {
        requestingHost = '';
      }
      return isPermissionAllowed(requestingHost, TRUSTED_HOST, permission);
    }
  );

  installContentSecurityPolicy(mainWindow.webContents.session);

  mainWindow.webContents.session.setCertificateVerifyProc(
    createCertificateVerifyProc([TRUSTED_HOST, 'api.rmpgutah.us'], (msg) => console.warn(msg))
  );

  // Clear Chromium HTTP cache before loading — ensures deploys propagate
  // immediately without requiring a manual hard-refresh in the desktop app.
  // Service workers are NOT cleared — they handle their own versioning via
  // skipWaiting() + clients.claim() + the auto-stamped CACHE_NAME, and
  // clearing them destroys offline capability (the SW cache is the only
  // fallback when network fails on cold boot).
  // Wrap in a race with a timeout so a macOS-specific hang in clearCache
  // doesn't block startup forever.
  try {
    await Promise.race([
      (async () => {
        await mainWindow.webContents.session.clearCache();
        console.log('[APP] HTTP cache cleared (SW registrations preserved)');
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Cache clear timed out after 5000ms')), 5000)),
    ]);
  } catch (err) {
    console.warn('[APP] Cache clear timed out or failed — continuing:', err && err.message);
  }

  // ── WWAN live push timer ──────────────────────────────────
  startWwanPush();

  // ── USB hot-plug GPS re-detect ────────────────────────────
  try {
    const usbDetect = require('usb-detection');
    usbDetect.startMonitoring();
    usbDetect.on('add', async () => {
      // Any USB insertion — re-probe for GPS
      setTimeout(async () => {
        const found = await findGpsPort();
        if (found) {
          mainWindow?.webContents.send('hardware:gps-plugged', found);
          // If GPS reader is not currently active, auto-start via the shared
          // helper so this wires the same channels/geofence hookup as the
          // renderer-initiated start path (see startInternalGpsReader).
          if (!internalGpsReader) {
            await startInternalGpsReader(found.path);
          }
        }
      }, 1500); // brief delay for device driver init
    });
    app.on('before-quit', () => usbDetect.stopMonitoring());
  } catch (err) {
    console.warn('[APP] usb-detection unavailable:', err.message);
  }

  // Load the remote web application
  console.log('[APP] Loading:', REMOTE_SERVER_URL);
  // Promise rejection here is handled by the did-fail-load listener
  // below, which shows the offline page. Catch so the rejection
  // doesn't escape to the global unhandledRejection guard.
  mainWindow.loadURL(REMOTE_SERVER_URL).catch((err) => {
    console.warn('[APP] loadURL failed (did-fail-load will recover):', err && err.message);
  });

  // ─── Load stall watchdog ──────────────────────────────────
  // If 'did-finish-load' never fires within 45s (WAF hung, mid-load network
  // drop that doesn't produce did-fail-load, etc.) show the offline page so
  // the officer isn't staring at a blank window with no feedback.
  // Cleared by both did-finish-load AND did-fail-load so it never double-fires.
  let _loadStallTimer = setTimeout(() => {
    _loadStallTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const url = mainWindow.webContents.getURL();
    if (url && !url.startsWith('data:') && url !== REMOTE_SERVER_URL && url !== '') return; // already navigated away
    console.warn('[APP] Load stall: did-finish-load not received within 45s — showing offline page');
    mainWindow.loadURL(getOfflineHTML()).catch(() => {});
  }, 45_000);

  mainWindow.webContents.once('did-finish-load', () => {
    if (_loadStallTimer) { clearTimeout(_loadStallTimer); _loadStallTimer = null; }
  });
  mainWindow.webContents.once('did-fail-load', () => {
    if (_loadStallTimer) { clearTimeout(_loadStallTimer); _loadStallTimer = null; }
  });

  // Show window when ready, close splash
  mainWindow.once('ready-to-show', () => {
    // In kiosk shell mode the splash drives show/focus via the splash:auth flow.
    // Do not close the splash here — it must stay up for the lock screen.
    // In all other contexts (dev, non-kiosk Windows, macOS) close and show directly.
    if (!isKioskShell) {
      closeSplash();
      mainWindow.show();
      mainWindow.focus();
    }
    if (isKioskShell && !kioskRevertSucceeded) {
      setConfig('kiosk_boot_attempts', resetBootAttemptState());
      if (kioskBootStabilityTimer) { clearTimeout(kioskBootStabilityTimer); kioskBootStabilityTimer = null; }
    }
  });

  // Handle page load failures (server down, network error).
  //
  // IMPORTANT: did-fail-load fires for a LOT of false positives:
  //   - errorCode -3 (ERR_ABORTED) every time a JS-driven navigation
  //     replaces an in-flight one. Cloudflare's challenge page does
  //     exactly this when it solves and redirects. Treating -3 as
  //     "server unreachable" makes the desktop app unusable any time
  //     CF re-issues a challenge.
  //   - Sub-frame failures (e.g., a failed iframe widget). The desktop
  //     shell should only react to MAIN-frame nav failures.
  //
  // Policy: only show the offline page for KNOWN-fatal main-frame failures.
  // Chromium net::Error codes:
  //   -2   FAILED                       (generic; treat as fatal)
  //   -100 CONNECTION_CLOSED
  //   -101 CONNECTION_RESET
  //   -102 CONNECTION_REFUSED
  //   -103 CONNECTION_ABORTED           (NOT -3; this is a real socket abort)
  //   -105 NAME_NOT_RESOLVED            (DNS)
  //   -106 INTERNET_DISCONNECTED
  //   -109 ADDRESS_UNREACHABLE
  //   -118 CONNECTION_TIMED_OUT
  //   -130 PROXY_CONNECTION_FAILED
  //   -137 NAME_RESOLUTION_FAILED
  //   -201 CERT_DATE_INVALID            (TLS clock/cert problems are fatal here)
  //   -202 CERT_AUTHORITY_INVALID
  //   -203 CERT_CONTAINS_ERRORS
  //   -207 CERT_REVOKED
  //   -208 CERT_INVALID
  // Deliberately excluded:
  //   -3   ABORTED          — fires every time a JS-driven nav replaces an
  //                           in-flight one (Cloudflare challenge solving,
  //                           OAuth redirects, etc.). Source of false positives.
  //   -21  NETWORK_CHANGED  — transient on roaming/VPN reconnects; the next
  //                           nav usually succeeds without showing offline UI.
  const FATAL_NET_ERRORS = new Set([
    -2, -100, -101, -102, -103, -105, -106, -109, -118, -130, -137,
    -201, -202, -203, -207, -208,
  ]);
  function isFatalNavFailure(errorCode, isMainFrame /* , validatedURL */) {
    return isMainFrame === true && FATAL_NET_ERRORS.has(errorCode);
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error(`[APP] did-fail-load: ${errorDescription} (code ${errorCode}, mainFrame=${isMainFrame}, url=${validatedURL})`);
    if (!isFatalNavFailure(errorCode, isMainFrame, validatedURL)) {
      console.log('[APP] did-fail-load: non-fatal, ignoring');
      return;
    }
    // Show the offline page with a retry button
    mainWindow.loadURL(getOfflineHTML()).catch((err) => {
      console.warn('[APP] Offline page loadURL failed:', err && err.message);
    });
  });

  // Renderer/GPU crash recovery — see the module-level recoverMainWindow()
  // and its `child-process-gone` listener defined near the bottom of this
  // file. Re-registered per webContents (unlike the app-level GPU listener,
  // which is registered exactly once) since a new window gets a new
  // webContents each time createMainWindow() runs.
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    recoverMainWindow('renderer', details && details.reason);
  });

  // ─── Frozen renderer detection ────────────────────────────
  // 'unresponsive' fires when the renderer process is alive but has not
  // processed an event within ~10s — a JS hang, tight loop, or memory
  // pressure. This is distinct from a crash: render-process-gone does NOT
  // fire for a frozen renderer, so recoverMainWindow() is never called.
  // Without this handler a frozen window stays dead until a manual app
  // restart. Strategy: wait UNRESPONSIVE_RELOAD_DELAY_MS to give Chromium
  // time to recover on its own (it sometimes does for transient jank), then
  // force-reload if the renderer hasn't come back yet.
  // 2026-08-23: increased from 30s to 60s — Toughbooks under memory pressure
  // (field apps, multiple tabs, GPS/radio polling) can be slow but eventually
  // recover; 30s caused unnecessary reloads that looked like random restarts.
  const UNRESPONSIVE_RELOAD_DELAY_MS = 60_000;
  let _unresponsiveTimer = null;
  mainWindow.webContents.on('unresponsive', () => {
    console.warn(`[APP] Renderer unresponsive — will reload in ${UNRESPONSIVE_RELOAD_DELAY_MS / 1000}s if not recovered`);
    if (_unresponsiveTimer) return; // already counting down
    _unresponsiveTimer = setTimeout(() => {
      _unresponsiveTimer = null;
      if (!mainWindow || mainWindow.isDestroyed()) return;
      console.error('[APP] Renderer still unresponsive after 60s — force-reloading');
      mainWindow.loadURL(REMOTE_SERVER_URL).catch((err) => {
        console.warn('[APP] Unresponsive-recovery loadURL failed:', err && err.message);
      });
    }, UNRESPONSIVE_RELOAD_DELAY_MS);
  });
  mainWindow.webContents.on('responsive', () => {
    if (_unresponsiveTimer) {
      clearTimeout(_unresponsiveTimer);
      _unresponsiveTimer = null;
      console.log('[APP] Renderer recovered responsiveness — cancelled reload timer');
    }
  });

  // Server hostname for link filtering — derived once at module scope (TRUSTED_HOST)
  const serverHost = TRUSTED_HOST;

  // Open external links in default browser; deny anything that isn't http(s)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const decision = shouldAllowNewWindow(url, serverHost);
    if (decision.action === 'external') {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return decision.action === 'allow' ? { action: 'allow' } : { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!shouldAllowNavigation(url, TRUSTED_HOST)) {
      console.warn('[SECURITY] Blocked navigation to untrusted URL:', url);
      event.preventDefault();
    }
  });

  // ─── Barcode scanner (FZ-VBR551M xPAK) ──────────────────────
  // The barcode module is a USB HID keyboard-wedge — it "types" the scanned
  // payload followed by Enter far faster than any human. Buffer keydowns per
  // window and classify the burst on every Enter; a 200ms trailing gap with
  // no Enter resets the buffer so a human pause doesn't get misread later.
  let barcodeBuffer = [];
  let barcodeBufferResetTimer = null;

  function resetBarcodeBuffer() {
    barcodeBuffer = [];
    if (barcodeBufferResetTimer) {
      clearTimeout(barcodeBufferResetTimer);
      barcodeBufferResetTimer = null;
    }
  }

  // ⚠️ PRIVACY/SECURITY TRADEOFF (accepted, not an oversight): this handler
  // buffers up to 200ms of every keystroke typed anywhere in the main
  // window — including password/PIN entry on the login screen — in this
  // main-process array. It is never sent to the renderer or anywhere else
  // unless `classifyKeystrokeBurst` flags the burst as a barcode scan,
  // which requires uniform sub-30ms inter-key gaps that normal human
  // typing essentially never produces (see BARCODE_MAX_GAP_MS in
  // hardwareFz55.js). Left as a future improvement: suspending the buffer
  // while a password-type input has focus, rather than relying solely on
  // the speed heuristic to keep plaintext keystrokes out of the payload.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    // Only buffer printable characters and the Enter terminator. Electron
    // fires a separate keyDown for modifier/non-printable keys (input.key
    // = 'Shift', 'Control', 'Alt', 'Dead', ...); pushing those corrupts an
    // uppercase scan payload (a scanner sends Shift before each uppercase
    // letter) and must not reset the trailing-gap timer either — a Shift
    // press mid-scan should not restart the classification window.
    if (!filterPrintableKeydown(input.key)) return;

    barcodeBuffer.push({ char: input.key, timestampMs: Date.now() });
    if (barcodeBufferResetTimer) clearTimeout(barcodeBufferResetTimer);
    barcodeBufferResetTimer = setTimeout(resetBarcodeBuffer, 200);

    if (input.key === 'Enter') {
      const result = classifyKeystrokeBurst(barcodeBuffer);
      resetBarcodeBuffer();
      if (result.isScan) {
        mainWindow.webContents.send('hardware:barcode-scan', { payload: result.payload, source: 'xpak' });
      }
    }
  });

  // Prevent closing — minimize to tray instead
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      // One-time event (not a rapid-fire stream like resize/move below), so
      // save synchronously/directly rather than through the debounce.
      saveWindowBounds(mainWindow, setConfig);
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    // Kill any orphaned recon tool sessions when the renderer is destroyed.
    // Without this, long-running tools (nmap, sqlmap, etc.) continue as
    // detached OS processes consuming resources indefinitely.
    for (const [sessionId, child] of toolSessions) {
      try {
        if (child && !child.killed) {
          child.kill();
          logSecurityAuditEvent('recon:tool-killed', 'cleanup', { sessionId });
        }
      } catch { /* process already exited */ }
    }
    toolSessions.clear();
    mainWindow = null;
  });

  mainWindow.on('focus', () => {
    mainWindow.flashFrame(false);
  });

  // 'resize'/'move' fire continuously (every pixel) during a drag/resize
  // gesture — debounce the actual persistence write so we're not hitting
  // the local DB dozens of times per second while the user drags the
  // window. BOUNDS_SAVE_DEBOUNCE_MS (500ms) is reset on every event, so the
  // write only happens once the gesture has been idle for that long.
  const debouncedSaveWindowBounds = () => {
    if (boundsSaveDebounceTimer) clearTimeout(boundsSaveDebounceTimer);
    boundsSaveDebounceTimer = setTimeout(() => {
      boundsSaveDebounceTimer = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        saveWindowBounds(mainWindow, setConfig);
      }
    }, BOUNDS_SAVE_DEBOUNCE_MS);
  };
  mainWindow.on('resize', debouncedSaveWindowBounds);
  mainWindow.on('move', debouncedSaveWindowBounds);

  // NOTE: the kiosk escape-hatch global shortcut is registered near the TOP
  // of this function, before the BrowserWindow is constructed — its success
  // is a precondition for useKioskChrome, so it cannot be deferred to here.
}

// ─── IPC Handlers ───────────────────────────────────────────
guardedOn('window:minimize', () => mainWindow?.minimize());
guardedOn('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
guardedOn('window:close', () => mainWindow?.close());
guardedHandle('window:toggle-fullscreen', () => { mainWindow?.setFullScreen(!mainWindow.isFullScreen()); });

// Opens a secondary BrowserWindow loading an in-app route (never a
// renderer-supplied arbitrary URL — see buildSecondaryWindowUrl in
// windowManager.js). routePath is resolved against the SAME trusted
// REMOTE_SERVER_URL base the main window itself loads, and the window
// gets the same hardened webPreferences (contextIsolation, no node
// integration, trusted preload) createMainWindow() uses.
guardedHandle('window:open-secondary', (event, routePath, opts) => {
  const built = buildSecondaryWindowUrl(REMOTE_SERVER_URL, routePath);
  if (typeof built !== 'string') {
    return { ok: false, error: built && built.error ? built.error : 'invalid routePath' };
  }
  const candidateWebPreferences = hardenWebPreferencesDefaults({
    preload: resolveTrustedPreloadPath(path.join(__dirname, 'preload.js'), path.join(__dirname, 'preload.js')),
  });
  // Self-check: guard against a future regression weakening this window's
  // webPreferences relative to the app's own hardened defaults. Should
  // always pass today since candidateWebPreferences is itself built from
  // hardenWebPreferencesDefaults() — this exists to catch drift later.
  const secureCheck = assertWebPreferencesNotWeaker(candidateWebPreferences, hardenWebPreferencesDefaults());
  if (!secureCheck.ok) {
    return { ok: false, error: secureCheck.error };
  }
  const win = new BrowserWindow({
    width: (opts && opts.width) || 1024,
    height: (opts && opts.height) || 768,
    title: APP_TITLE,
    webPreferences: candidateWebPreferences,
  });
  const { randomUUID } = require('crypto');
  const id = randomUUID();
  secondaryWindows.set(id, win);
  win.on('closed', () => secondaryWindows.delete(id));
  win.loadURL(built).catch((err) => {
    console.warn('[APP] Secondary window loadURL failed:', err && err.message);
  });
  return { id };
});

guardedHandle('window:close-secondary', (event, id) => {
  const win = secondaryWindows.get(id);
  if (win && !win.isDestroyed()) win.close();
});

// Opens the Company Browser: a dedicated BrowserWindow with webviewTag
// enabled, used ONLY for this feature. webviewTag stays false on every
// other window this app creates (see hardenWebPreferencesDefaults) —
// this is the single, intentional, narrowly-scoped exception, which is
// why this handler builds its own webPreferences object rather than
// reusing assertWebPreferencesNotWeaker (that assertion would always
// fail here, since it exists specifically to catch an ACCIDENTAL
// weakening relative to the secure default, and enabling webviewTag is
// a deliberate one). Every guest <webview> opened inside this window is
// re-hardened individually via the 'will-attach-webview' handler below,
// which is what actually keeps this safe.
let companyBrowserWindow = null;
guardedHandle('window:open-company-browser', (event, role) => {
  if (!isCompanyBrowserRoleAllowed(role)) {
    return { ok: false, error: 'forbidden' };
  }
  if (companyBrowserWindow && !companyBrowserWindow.isDestroyed()) {
    companyBrowserWindow.focus();
    return { ok: true };
  }
  const built = buildSecondaryWindowUrl(REMOTE_SERVER_URL, '/desktop-company-browser');
  if (typeof built !== 'string') {
    return { ok: false, error: built && built.error ? built.error : 'invalid route' };
  }
  companyBrowserWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    title: 'Company Browser — RMPG Flex',
    webPreferences: hardenWebPreferencesDefaults({
      webviewTag: true,
      preload: resolveTrustedPreloadPath(path.join(__dirname, 'preload.js'), path.join(__dirname, 'preload.js')),
    }),
  });
  companyBrowserWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    Object.assign(webPreferences, hardenGuestWebPreferences(webPreferences));
    if (!shouldAllowGuestNavigation(params.src)) {
      event.preventDefault();
    }
  });
  // will-attach-webview only gates the INITIAL src — it fires once, before
  // the guest even attaches. Later navigation (address-bar entry, an
  // in-page redirect to file:/javascript:/chrome:, etc.) is a completely
  // separate event and is never gated by the block above. did-attach-webview
  // hands us the actual guest webContents once attached, which does emit
  // its own cancelable 'will-navigate' for every subsequent navigation —
  // unlike the <webview> DOM element's own 'will-navigate' event (wired up
  // client-side in CompanyBrowserPage.tsx for its OBSERVATIONAL events
  // only), which cannot preventDefault(). This is the only place capable of
  // actually blocking a later non-http(s) navigation.
  companyBrowserWindow.webContents.on('did-attach-webview', (event, guestWebContents) => {
    guestWebContents.on('will-navigate', (navEvent, url) => {
      if (!shouldAllowGuestNavigation(url)) {
        console.warn('[SECURITY] Blocked Company Browser guest navigation to disallowed scheme:', url);
        navEvent.preventDefault();
      }
    });
  });
  companyBrowserWindow.on('closed', () => { companyBrowserWindow = null; });
  companyBrowserWindow.loadURL(built).catch((err) => {
    console.warn('[APP] Company Browser loadURL failed:', err && err.message);
  });
  return { ok: true };
});

// Sets the dock/taskbar badge count (unread alerts, active calls, etc).
// app.setBadgeCount only exists on Linux/macOS — guard its presence and
// no-op on unsupported platforms (same "gracefully degrade" pattern as
// getBatteryStatus returning null on non-macOS).
guardedHandle('notify:dock-badge', (event, count) => {
  const n = coerceBadgeCount(count);
  if (app.setBadgeCount) app.setBadgeCount(n);
});

guardedHandle('notify:flash-frame', () => {
  mainWindow?.flashFrame(true);
});

// Reflects the officer's shift state in the tray icon's tooltip text.
// There is no per-status icon asset shipped for the tray (createTray() uses
// a single static icon via getIconPath()), so this is tooltip-text-only —
// not icon-swapping. Silently no-ops on an invalid state or if the tray
// hasn't been created yet (same fail-safe pattern as fs:reveal's
// validation-failure handling) — void return per spec.
guardedHandle('notify:tray-status', (event, state) => {
  if (!isValidTrayStatus(state)) return;
  if (tray) tray.setToolTip(formatTrayTooltip(state));
});

// Reads a currently-stored offline-secret config value, decrypting it via
// safeStorage — same decrypt-with-fallback pattern as pinManager.js's
// readSecretConfig(): a decrypt failure means "wasn't our ciphertext yet"
// (e.g. pre-migration plaintext), so the raw value is used as-is rather
// than treated as a crash. Returns null for an unset key.
function readOfflineSecretConfig(key) {
  const raw = getConfig(key);
  if (!raw) return null;
  try {
    return decryptSecretForStorage(raw, safeStorage);
  } catch {
    return raw;
  }
}

// Plain clipboard read wrapper (no secret content originates from a read).
guardedHandle('clipboard:get', () => clipboard.readText());

// clipboard:set guards against writing a currently-known secret value to
// the OS clipboard (disableClipboardAutoSyncOfSecrets, Group I task 7) —
// wires Group E's plain passthrough (see git history) up to
// sessionAuth.looksLikeSecretValue. Secret values are read, compared, and
// discarded within this handler's call stack only — never cached in a
// module-level variable — matching the decrypt-compare-discard lifetime
// pinManager.js already uses for these same config keys.
guardedHandle('clipboard:set', (event, text) => {
  const candidate = String(text);
  const knownSecrets = [
    readOfflineSecretConfig('admin_offline_secret'),
    readOfflineSecretConfig('my_offline_secret'),
    readOfflineSecretConfig('all_user_secrets'),
    getConfig('auth_token'),
  ].filter((value) => typeof value === 'string' && value.length > 0);

  if (looksLikeSecretValue(candidate, knownSecrets)) {
    return { ok: false, error: 'cannot copy secret values to the clipboard' };
  }

  clipboard.writeText(candidate);
});

guardedHandle('app:version', () => app.getVersion());
guardedHandle('sys:info', () => {
  const os = require('os');
  const fs = require('fs');
  let freeBytes;
  try {
    freeBytes = getDiskFreeBytes(app.getPath('userData'), fs);
  } catch (err) {
    console.error('[SYS:INFO] Disk space check failed:', err.message);
    freeBytes = null;
  }
  return formatSystemInfo(os, freeBytes);
});
guardedHandle('sys:cpu-usage', () => getCpuUsagePercent(require('os')));
guardedHandle('sys:logs', (_event, lines = 500) => {
  return tailLogFile(LOG_FILE_PATH, lines, require('fs'));
});
guardedHandle('sys:open-logs-folder', () => {
  shell.openPath(getLogsDirectory(LOG_FILE_PATH, path));
});
guardedHandle('sys:crash-reports', () => {
  return listCrashReports(app.getPath('crashDumps'), require('fs'));
});
guardedHandle('sys:disk-space', () => {
  let freeBytes, totalBytes;
  try {
    ({ freeBytes, totalBytes } = getDiskBytes(app.getPath('userData'), require('fs')));
  } catch (err) {
    console.error('[SYS:DISK-SPACE] Disk space check failed:', err.message);
    return { freeBytes: null, totalBytes: null, warn: false };
  }
  return evaluateDiskSpace(freeBytes, totalBytes);
});
guardedHandle('sys:network-interfaces', () => {
  return formatNetworkInterfaces(require('os').networkInterfaces());
});
guardedHandle('sys:battery', async () => {
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('pmset', ['-g', 'batt'], { timeout: 3000 });
      return parsePmsetBatteryOutput(stdout);
    } catch (err) {
      console.error('[SYS:BATTERY] pmset failed:', err.message);
      return null;
    }
  }

  if (process.platform === 'win32') {
    // When running as the Windows shell (Winlogon), WMI (winmgmt) may not be
    // ready yet at boot — use a longer timeout and retry before falling back.
    const isShellContext = getConfig('kiosk_shell_enabled') === true || KIOSK_SHELL_ARGV;
    const cimTimeout = isShellContext ? 8000 : 3000;
    const maxAttempts = isShellContext ? 2 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { stdout } = await execFileAsync(
          'powershell.exe',
          ['-NoProfile', '-Command', 'Get-CimInstance -ClassName Win32_Battery | Select-Object DeviceID, EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json'],
          { timeout: cimTimeout }
        );
        const raw = parseWindowsBatteryOutput(stdout.trim());
        if (raw) {
          return { percent: raw.overallPercent, charging: raw.charging };
        }
      } catch (err) {
        console.warn(`[SYS:BATTERY] CimInstance attempt ${attempt}/${maxAttempts} failed:`, err.message);
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Fallback: WMIC uses DCOM instead of CIM-XML and is available earlier at boot.
    try {
      const { stdout: wmicOut } = await execFileAsync(
        'wmic',
        ['path', 'Win32_Battery', 'get', 'EstimatedChargeRemaining,BatteryStatus', '/format:csv'],
        { timeout: 5000, windowsHide: true }
      );
      const lines = wmicOut.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      // CSV layout: Node,BatteryStatus,EstimatedChargeRemaining (header is always first)
      if (lines.length >= 2) {
        const headers = lines[0].split(',').map((h) => h.trim());
        const percentIdx = headers.indexOf('EstimatedChargeRemaining');
        const statusIdx = headers.indexOf('BatteryStatus');
        let totalPercent = 0, charging = false, count = 0;
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map((v) => v.trim());
          const pct = parseInt(cols[percentIdx], 10);
          const status = parseInt(cols[statusIdx], 10);
          if (!isNaN(pct)) { totalPercent += pct; charging = charging || (status === 2); count++; }
        }
        if (count > 0) {
          return { percent: Math.round(totalPercent / count), charging };
        }
      }
    } catch (wmicErr) {
      console.warn('[SYS:BATTERY] WMIC fallback failed:', wmicErr.message);
    }

    return null;
  }

  return null;
});
const BODY_CAM_VIDS = new Map([
  [0x2B0E, 'Axon'],     // Axon Body 3/4
  [0x22B8, 'Motorola'], // Motorola Si500
]);
let bodyCamHidDevice = null;

function detectBodyCam() {
  if (process.platform !== 'win32') return null;
  try {
    const HID = require('node-hid');
    const devices = HID.devices();
    for (const [vid, vendor] of BODY_CAM_VIDS) {
      const d = devices.find((dev) => dev.vendorId === vid);
      if (d) return { present: true, vendor, model: d.product || null, vid, path: d.path };
    }
  } catch (err) {
    console.warn('[BODY-CAM] HID enumeration failed:', err.message);
  }
  return null;
}

guardedHandle('sys:body-cam-status', () => {
  const cam = detectBodyCam();
  if (!cam) return { present: false, vendor: null, model: null, batteryPct: null };
  // Attempt to read HID state
  let batteryPct = null;
  try {
    const HID = require('node-hid');
    const dev = new HID.HID(cam.path);
    const report = dev.readTimeout(200);
    dev.close();
    const parsed = parseBodyCamHidReport(Buffer.from(report));
    batteryPct = parsed.batteryPct;
  } catch { /* HID read failed — return presence only */ }
  return { present: true, vendor: cam.vendor, model: cam.model, batteryPct };
});

guardedHandle('sys:body-cam-start', () => {
  const cam = detectBodyCam();
  if (!cam) return { ok: false, reason: 'no_camera' };
  try {
    const HID = require('node-hid');
    bodyCamHidDevice = new HID.HID(cam.path);
    // Axon record command: write report [0x01, 0x01] (report ID 1, flag record=1)
    bodyCamHidDevice.write([0x01, 0x01]);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

guardedHandle('sys:body-cam-stop', () => {
  if (!bodyCamHidDevice) return { ok: false, reason: 'not_started' };
  try {
    bodyCamHidDevice.write([0x01, 0x00]); // clear recording flag
    bodyCamHidDevice.close();
    bodyCamHidDevice = null;
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});
guardedHandle('sys:tpm-status', async () => {
  if (process.platform !== 'win32') return null;
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', 'Get-Tpm | Select-Object TpmPresent, TpmReady, TpmEnabled | ConvertTo-Json'],
      { timeout: 3000 }
    );
    return parseWindowsTpmOutput(stdout);
  } catch (err) {
    console.error('[SYS:TPM-STATUS] Get-Tpm failed:', err.message);
    return null;
  }
});
guardedHandle('sys:thermal-status', async () => {
  if (process.platform !== 'win32') return null;
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command',
        'Get-WmiObject -Namespace root/WMI -Class MSAcpi_ThermalZoneTemperature | Select-Object CurrentTemperature | ConvertTo-Json'],
      { timeout: 5000 }
    );
    const result = parseWindowsThermalOutput(stdout);
    if (result && result.maxTempF > 185) {
      mainWindow?.webContents.send('hardware:thermal-alert', result);
    }
    return result;
  } catch (err) {
    console.error('[SYS:THERMAL-STATUS]', err.message);
    return null;
  }
});
guardedHandle('device:smartcard-status', async () => {
  if (process.platform !== 'win32') return { present: false, cardInserted: false, atr: null };
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command',
        'Get-PnpDevice -Class SmartCard | Select-Object FriendlyName, Status, ATR | ConvertTo-Json'],
      { timeout: 3000 }
    );
    return parseWindowsSmartCardOutput(stdout);
  } catch (err) {
    console.error('[DEVICE:SMARTCARD-STATUS]', err.message);
    return { present: false, cardInserted: false, atr: null };
  }
});
guardedHandle('device:fingerprint-status', async () => {
  if (process.platform !== 'win32') return { present: false, ready: false };
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command',
        'Get-PnpDevice -Class Biometric | Select-Object FriendlyName, Status | ConvertTo-Json'],
      { timeout: 3000 }
    );
    return parseWindowsFingerprintOutput(stdout);
  } catch (err) {
    console.error('[DEVICE:FINGERPRINT-STATUS]', err.message);
    return { present: false, ready: false };
  }
});
guardedHandle('sys:battery-detail', async () => {
  if (process.platform !== 'win32') return null;
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command',
        'Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining, BatteryStatus, EstimatedRunTime | ConvertTo-Json'],
      { timeout: 3000 }
    );
    return parseWindowsBatteryOutput(stdout);
  } catch (err) {
    console.error('[SYS:BATTERY-DETAIL]', err.message);
    return null;
  }
});
guardedHandle('device:wwan-signal', async () => {
  if (process.platform !== 'win32') return { rssi: null, bars: 0 };
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'netsh.exe',
      ['mbn', 'show', 'signal', 'interface=*'],
      { timeout: 3000 }
    );
    return parseWindowsWwanSignalOutput(stdout);
  } catch (err) {
    console.error('[DEVICE:WWAN-SIGNAL]', err.message);
    return { rssi: null, bars: 0 };
  }
});
guardedHandle('device:wwan-carrier', async () => {
  if (process.platform !== 'win32') return { carrier: null, apn: null };
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'netsh.exe',
      ['mbn', 'show', 'connection', 'interface=*'],
      { timeout: 3000 }
    );
    const carrierMatch = stdout.match(/Provider Name\s*:\s*(.+)/i);
    const apnMatch = stdout.match(/Access String\s*:\s*(.+)/i);
    return {
      carrier: carrierMatch ? carrierMatch[1].trim() : null,
      apn: apnMatch ? apnMatch[1].trim() : null,
    };
  } catch (err) {
    console.error('[DEVICE:WWAN-CARRIER]', err.message);
    return { carrier: null, apn: null };
  }
});
guardedHandle('device:usb-devices', async () => {
  if (process.platform !== 'win32') return [];
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command',
        "Get-PnpDevice | Where-Object {$_.Class -eq 'USB'} | Select-Object FriendlyName, Status | ConvertTo-Json"],
      { timeout: 5000 }
    );
    let parsed;
    try { parsed = JSON.parse(stdout); } catch { return []; }
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries.filter(Boolean).map((e) => ({ name: e.FriendlyName || '', status: e.Status || '' }));
  } catch (err) {
    console.error('[DEVICE:USB-DEVICES]', err.message);
    return [];
  }
});
guardedHandle('sys:idle-time', () => {
  return powerMonitor.getSystemIdleTime();
});
guardedHandle('sys:export-diagnostics', async () => {
  const os = require('os');
  const fs = require('fs');
  let freeBytes;
  try {
    freeBytes = getDiskFreeBytes(app.getPath('userData'), fs);
  } catch {
    freeBytes = null;
  }
  const info = formatSystemInfo(os, freeBytes);
  const logTail = tailLogFile(LOG_FILE_PATH, 500, fs);
  const bundleText = buildDiagnosticsBundleText(info, logTail);
  let encrypted;
  try {
    encrypted = encryptDiagnosticsBundleOnExport(bundleText, safeStorage);
  } catch (err) {
    return { ok: false, error: `Diagnostics encryption failed: ${err.message}` };
  }
  const outPath = path.join(app.getPath('temp'), `rmpg-flex-diagnostics-${Date.now()}.enc`);
  try {
    fs.writeFileSync(outPath, encrypted, 'utf8');
  } catch (err) {
    return { ok: false, error: `Failed to write diagnostics bundle: ${err.message}` };
  }
  return { ok: true, path: outPath };
});
guardedHandle('sys:restart', () => {
  app.relaunch();
  app.exit();
});

guardedHandle('os:shutdown', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'not_supported' };
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Shut Down',
    message: 'Shut down this computer?',
    detail: 'The computer will shut down in 5 seconds. To cancel, run: shutdown /a',
    buttons: ['Shut Down', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0) return { ok: false, error: 'cancelled' };
  try {
    await execFileAsync('shutdown.exe', ['/s', '/t', '5'], { windowsHide: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

guardedHandle('os:restart', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'not_supported' };
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Restart',
    message: 'Restart this computer?',
    detail: 'The computer will restart in 5 seconds. To cancel, run: shutdown /a',
    buttons: ['Restart', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0) return { ok: false, error: 'cancelled' };
  try {
    await execFileAsync('shutdown.exe', ['/r', '/t', '5'], { windowsHide: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ─── File & Data Export/Import ──────────────────────────────
guardedHandle('fs:save-dialog', async (event, opts) => {
  const result = await dialog.showSaveDialog(mainWindow, buildSaveDialogOptions(opts || {}));
  return result.canceled ? null : result.filePath;
});
guardedHandle('fs:open-dialog', async (event, opts) => {
  const result = await dialog.showOpenDialog(mainWindow, buildOpenDialogOptions(opts || {}));
  return result.canceled ? null : result.filePaths;
});
guardedHandle('fs:write-export', async (event, targetPath, data) => {
  const validation = validateFilePathInput(targetPath, resolveAllowedRoots(app));
  if (!validation.ok) return { ok: false, error: validation.error };
  // Defense in depth: userData is no longer an allowed root, but reject the
  // live local DB file (and its -wal/-shm sidecars) outright regardless of
  // which root it resolved under — this channel must never be able to
  // overwrite the offline DB cache (see fs:import-db-backup for the actual,
  // rollback-guarded way to do that).
  if (isLocalDbPath(validation.resolved, getLocalDbPath(app, path))) {
    return { ok: false, error: 'cannot access the local database file via this channel' };
  }
  try {
    await fs.promises.writeFile(validation.resolved, data);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
guardedHandle('fs:read-import', async (event, sourcePath) => {
  const validation = validateFilePathInput(sourcePath, resolveAllowedRoots(app));
  if (!validation.ok) return { ok: false, error: validation.error };
  // Defense in depth — see the matching check in fs:write-export above.
  if (isLocalDbPath(validation.resolved, getLocalDbPath(app, path))) {
    return { ok: false, error: 'cannot access the local database file via this channel' };
  }
  try {
    const data = await fs.promises.readFile(validation.resolved);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
guardedHandle('fs:reveal', (event, targetPath) => {
  const validation = validateFilePathInput(targetPath, resolveAllowedRoots(app));
  if (!validation.ok) {
    console.error('[FS:REVEAL] Rejected path:', validation.error);
    return;
  }
  shell.showItemInFolder(validation.resolved);
});
guardedHandle('fs:downloads-path', () => app.getPath('downloads'));
guardedHandle('fs:printers', async (event) => formatPrinters(await event.sender.getPrintersAsync()));
guardedHandle('fs:print-silent', async (event, printerName) => {
  const printers = formatPrinters(await event.sender.getPrintersAsync());
  if (!isKnownPrinterName(printerName, printers)) {
    return { ok: false, error: `unknown printer: ${printerName}` };
  }
  return new Promise((resolve) => {
    event.sender.print({ silent: true, deviceName: printerName }, (success, failureReason) => {
      resolve(success ? { ok: true } : { ok: false, error: failureReason });
    });
  });
});
guardedHandle('fs:export-db-backup', async () => {
  const roleCheck = requireOfflineAuthForSensitiveIpc(getConfig('current_user_role'));
  if (!roleCheck.ok) {
    logSecurityAuditEvent('fs:export-db-backup', 'denied', {});
    return { ok: false, error: roleCheck.error };
  }
  const dialogResult = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `rmpg-flex-backup-${Date.now()}.rmpgbak`,
    filters: [{ name: 'RMPG Flex Backup', extensions: ['rmpgbak'] }],
  });
  if (dialogResult.canceled) return { ok: false, error: 'cancelled' };
  // Log only the destination filename (basename), never the full path or
  // any backup content — that's the minimal, non-sensitive detail this
  // audit trail is scoped to.
  const exportFilename = path.basename(dialogResult.filePath);
  const tempPath = path.join(app.getPath('temp'), `rmpg-db-backup-${Date.now()}.db`);
  try {
    await getLocalDb().backup(tempPath);
    const rawBytes = await fs.promises.readFile(tempPath);
    const encoded = encodeBackupForExport(rawBytes, safeStorage);
    await fs.promises.writeFile(dialogResult.filePath, encoded, 'utf8');
    logSecurityAuditEvent('fs:export-db-backup', 'success', { filename: exportFilename });
    return { ok: true, path: dialogResult.filePath };
  } catch (err) {
    logSecurityAuditEvent('fs:export-db-backup', 'error', { filename: exportFilename });
    return { ok: false, error: err.message };
  } finally {
    fs.promises.unlink(tempPath).catch(() => {});
  }
});
guardedHandle('fs:import-db-backup', async (event, sourcePath) => {
  const roleCheck = requireOfflineAuthForSensitiveIpc(getConfig('current_user_role'));
  if (!roleCheck.ok) {
    logSecurityAuditEvent('fs:import-db-backup', 'denied', {});
    return { ok: false, error: roleCheck.error };
  }
  const pathValidation = validateFilePathInput(sourcePath, resolveAllowedRoots(app));
  if (!pathValidation.ok) {
    logSecurityAuditEvent('fs:import-db-backup', 'denied', {});
    return { ok: false, error: pathValidation.error };
  }
  // Log only the source filename (basename), never the full path or any
  // decrypted backup content.
  const importFilename = path.basename(pathValidation.resolved);
  let rawBytes;
  try {
    const encodedText = await fs.promises.readFile(pathValidation.resolved, 'utf8');
    rawBytes = decodeBackupForImport(encodedText, safeStorage);
  } catch (err) {
    logSecurityAuditEvent('fs:import-db-backup', 'error', { filename: importFilename });
    return { ok: false, error: `could not decrypt backup: ${err.message}` };
  }
  const contentValidation = validateBackupFileBeforeImport(rawBytes);
  if (!contentValidation.ok) {
    logSecurityAuditEvent('fs:import-db-backup', 'denied', { filename: importFilename });
    return { ok: false, error: contentValidation.error };
  }
  // validateBackupFileBeforeImport only checks the 16-byte SQLite magic
  // header — a corrupted/truncated-but-genuinely-SQLite file passes that
  // and only fails once initLocalDb()'s integrity pragmas touch it. Route
  // the actual swap through swapInLocalDbWithRollback so a failure there
  // restores the pre-import DB instead of leaving local/offline mode dead.
  const result = await swapInLocalDbWithRollback(rawBytes, {
    dbPath: getLocalDbPath(app, path),
    fsModule: fs,
    closeLocalDb,
    initLocalDb,
  });
  logSecurityAuditEvent('fs:import-db-backup', result && result.ok ? 'success' : 'error', { filename: importFilename });
  return result;
});

// ─── Device & Hardware ───────────────────────────────────────
// listAudioDevices/listVideoDevices (spec #32/#33) have no main-process
// handler here — Electron's main process has no API to enumerate audio/
// video devices, only the renderer's navigator.mediaDevices does. They're
// wired directly in preload.js instead (see Group D plan, Scope Decision #1).
guardedHandle('device:serial-ports', async () => formatSerialPorts(await listSerialPorts()));
guardedHandle('device:bluetooth', async () => {
  if (process.platform !== 'darwin') return [];
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('system_profiler', ['SPBluetoothDataType', '-json'], { timeout: 5000 });
    return parseSystemProfilerBluetoothOutput(stdout);
  } catch (err) {
    console.error('[DEVICE:BLUETOOTH] system_profiler failed:', err.message);
    return [];
  }
});
guardedHandle('device:gps-present', async () => {
  const found = await findGpsPort();
  if (!found) return classifyGpsPresence(null, null);
  const probeError = await probeGpsPortOpen(found.path);
  return classifyGpsPresence(found, probeError);
});
guardedHandle('device:dock-state', async () => {
  if (process.platform !== 'win32') return { docked: false };
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', "Get-PnpDevice -Class DockUpDown | Select-Object Status | ConvertTo-Json"],
      { timeout: 3000 }
    );
    return parseWindowsDockOutput(stdout);
  } catch (err) {
    console.error('[DEVICE:DOCK-STATE] Get-PnpDevice DockUpDown failed:', err.message);
    return { docked: false };
  }
});
guardedHandle('device:wwan-status', async () => {
  if (process.platform !== 'win32') return { present: false, connected: false };
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', "Get-NetAdapter | Where-Object {$_.InterfaceDescription -match 'Sierra|EM74|EM75|EM91'} | Select-Object Name, InterfaceDescription, Status | ConvertTo-Json"],
      { timeout: 3000 }
    );
    return parseWindowsWwanOutput(stdout);
  } catch (err) {
    console.error('[DEVICE:WWAN-STATUS] Get-NetAdapter failed:', err.message);
    return { present: false, connected: false };
  }
});
guardedHandle('device:set-auto-launch', (event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
  return { ok: true };
});

/**
 * Kills Windows 11 shell host processes that surface the Start Menu over
 * fullscreen windows when FlexOS is the Winlogon shell. Uses taskkill /F
 * (no elevation needed for same-session processes).
 */
// ─── Windows shell process suppression ───────────────────────
// When FlexOS is the Winlogon shell, explorer.exe is not running, but Windows
// 11 starts dedicated host processes for the Start Menu and shell chrome even
// without explorer: StartMenuExperienceHost.exe, ShellExperienceHost.exe, and
// SearchHost.exe. These respond to the Win key independently and surface the
// Start Menu over the top of any fullscreen window. Terminating them prevents
// Windows UI from bleeding through while FlexOS is the active shell.
//
// This is ONLY called when isKioskShell is true — i.e. FlexOS was launched as
// the HKCU Winlogon Shell replacement. It must never run in a normal session
// where explorer.exe is the shell, because killing those processes there would
// damage the user's desktop session.
function suppressWindowsShellProcesses() {
  if (process.platform !== 'win32') return;
  const { execFile } = require('child_process');
  // Windows 11 decomposes the Start Menu into these separate host processes.
  // explorer.exe itself is intentionally omitted: when FlexOS IS the Winlogon
  // shell, explorer.exe was never started by Windows — there is nothing to kill.
  // If it somehow is running (e.g. a GPO or startup item launched it), including
  // it here is safe because the FlexOS shell relaunch guard keeps the session
  // alive regardless.
  // NEVER add these to the targets list — they are Microsoft background services
  // that must remain active in kiosk shell mode for Rocky Mountain Protective Group
  // operations. Killing them causes device security failures, sync loss, or a BSOD:
  //   OneDrive.exe               — file sync
  //   SecurityHealthSystray.exe  — Windows Security / Defender
  //   WmiPrvSE.exe               — WMI provider host (battery, hardware queries need this)
  //   MicrosoftEdgeUpdate.exe    — Edge update service
  //   WinStore.App.exe           — Microsoft Store
  //   lsass.exe                  — credential & authentication store
  //   winlogon.exe               — session manager (killing = kernel panic / BSOD)
  //   svchost.exe                — hosts Entra/Azure AD, Windows Update, and 100+ services
  const targets = [
    'StartMenuExperienceHost.exe',
    'ShellExperienceHost.exe',
    'SearchHost.exe',
    'explorer.exe',
  ];
  for (const proc of targets) {
    execFile(
      'taskkill',
      ['/F', '/IM', proc],
      { windowsHide: true },
      (err, _stdout, stderr) => {
        const msg = (err && err.message) || stderr || '';
        // "not found" / "no tasks" means the process wasn't running — expected.
        if (!msg || /not found|no tasks/i.test(msg)) {
          console.log(`[SHELL] ${proc}: not running (ok)`);
        } else if (err) {
          console.warn(`[SHELL] taskkill ${proc}:`, msg.trim());
        } else {
          console.log(`[SHELL] Suppressed: ${proc}`);
        }
      }
    );
  }
}

// ─── HKCU Winlogon Shell registry helpers ─────────────────────
// The Shell value is written to HKCU (per-user) rather than HKLM
// (machine-wide). Per-user has two advantages over the old HKLM approach:
//   1. No UAC — HKCU is always writable by the owning user without elevation.
//   2. Per-user state matches the per-user userData config that tracks
//      kiosk_shell_enabled/kiosk_boot_attempts. An IT recovery account that
//      logs in while the kiosk user's HKCU Shell points at this app gets its
//      OWN HKCU (no Shell override), so it boots to explorer.exe normally.
// HKCU Shell overrides HKLM Shell — Windows checks HKCU first. Deleting the
// HKCU value on revert (rather than writing "explorer.exe") restores the
// system default cleanly even if HKLM was ever customized by an admin.
const HKCU_WINLOGON_KEY = 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon';

/**
 * Writes the kiosk Shell value to HKCU Winlogon. No UAC required.
 * shellValue must already be the quoted registry string produced by
 * buildShellRegistryValue (e.g. `"C:\path\to\RMPG Flex.exe"`).
 * Returns { ok: true } or { ok: false, error: string }.
 */
function runRegistryWrite(shellValue) {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const child = spawn('reg.exe', [
      'add', HKCU_WINLOGON_KEY,
      '/v', 'Shell',
      '/t', 'REG_SZ',
      '/d', shellValue,
      '/f',
    ], { windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: stderr || `reg.exe exited with code ${code}` });
    });
  });
}

/**
 * Deletes the Shell value from HKCU Winlogon, restoring the system default
 * (HKLM explorer.exe fallback). "Value not found" is treated as success —
 * if the value was already gone the registry is already in the desired state.
 * Returns { ok: true } or { ok: false, error: string }.
 */
function deleteHkcuShell() {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const child = spawn('reg.exe', [
      'delete', HKCU_WINLOGON_KEY,
      '/v', 'Shell',
      '/f',
    ], { windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else if (
        // reg.exe exits 1 with "unable to find" or "The system was unable to
        // find the specified registry key or value" when the value didn't exist.
        // Either way the end state is what we want: no HKCU Shell override.
        stderr.toLowerCase().includes('unable to find') ||
        stderr.toLowerCase().includes('not found')
      ) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: stderr || `reg.exe exited with code ${code}` });
      }
    });
  });
}

// ─── Kiosk Shell Mode (Windows only) ─────────────────────────
// Replaces explorer.exe as the Windows login shell so this machine boots
// directly into the RMPG Flex desktop. See docs/superpowers/specs/
// 2026-07-21-desktop-kiosk-shell-mode-design.md for the full design.
// ── RF / signal intelligence scan ────────────────────────────────────
// Runs a passive WiFi + Bluetooth scan via OS commands and returns the
// structured session object ready to POST to /api/radar360/signal-scan.
// opts: { lat, lng, deviceId, callId }
guardedHandle('device:rf-scan', async (event, opts = {}) => {
  try {
    const result = await runRfScan({
      lat: opts.lat ?? null,
      lng: opts.lng ?? null,
      deviceId: opts.deviceId ?? null,
      callId: opts.callId ?? null,
    });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
});

guardedHandle('device:set-kiosk-shell', async (event, enabled) => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Kiosk mode is only available on Windows' };
  }
  const roleCheck = requireOfflineAuthForSensitiveIpc(getConfig('current_user_role'));
  // requireOfflineAuthForSensitiveIpc only accepts 'admin' today; Kiosk Mode
  // is also available to 'manager' per the design spec's admin/manager gate
  // (matches DesktopPage.tsx's isAdmin check), so extend the check inline
  // rather than widen the shared helper's meaning for its other callers.
  const role = getConfig('current_user_role');
  if (!roleCheck.ok && role !== 'manager') {
    logSecurityAuditEvent('device:set-kiosk-shell', 'denied', { role });
    return { ok: false, error: 'This action requires an admin or manager session' };
  }
  try {
    // Deliberate revert-and-restart: mark this BEFORE the registry write so
    // window-all-closed (should the settings window close during this) never
    // mistakes it for an unexpected exit and relaunches back into kiosk mode.
    if (!enabled) kioskDeliberatelyReverting = true;
    // Enable: write HKCU Shell to point at this app (no UAC needed).
    // Disable: delete the HKCU Shell value so Windows falls back to the
    // HKLM default (explorer.exe), restoring the system default cleanly.
    let result;
    if (enabled) {
      result = await runRegistryWrite(buildShellRegistryValue(process.execPath));
    } else {
      result = await deleteHkcuShell();
    }
    if (!result.ok) {
      // Un-latch the deliberate-revert flag set above: the registry write
      // failed, so the shell key still points at this app and a subsequent
      // window-all-closed must still relaunch rather than exit.
      if (!enabled) kioskDeliberatelyReverting = false;
      logSecurityAuditEvent('device:set-kiosk-shell', 'error', { enabled, error: result.error });
      return result;
    }
    setConfig('kiosk_shell_enabled', Boolean(enabled));
    if (enabled) {
      setConfig('kiosk_boot_attempts', resetBootAttemptState());
    }
    logSecurityAuditEvent('device:set-kiosk-shell', 'success', { enabled });
    if (enabled) {
      // Fix #2: the confirmation dialog in DesktopKioskSettings.tsx promises
      // a restart — make that real by offering one here, mirroring the
      // restart dialog already shown by the kiosk:attempt-escape handler
      // below. Fire-and-forget (waitUntil not needed — Electron's dialog
      // module handles its own lifecycle); the IPC response to the renderer
      // isn't blocked on the operator's choice.
      dialog
        .showMessageBox({
          type: 'info',
          title: 'Kiosk Mode Enabled',
          message: 'This machine will now boot directly into RMPG Flex on restart.',
          detail: 'Restart now to apply, or restart later yourself.',
          buttons: ['Restart Now', 'Later'],
          defaultId: 1,
          cancelId: 1,
        })
        .then(({ response }) => {
          if (response === 0) {
            app.relaunch();
            app.exit(0);
          }
        })
        .catch((err) => console.warn('[KIOSK] restart prompt failed:', err && err.message));
    }
    return { ok: true };
  } catch (err) {
    logSecurityAuditEvent('device:set-kiosk-shell', 'error', { enabled, error: err.message });
    return { ok: false, error: err.message };
  }
});

guardedHandle('device:kiosk-shell-state', () => {
  if (process.platform !== 'win32') return { supported: false, enabled: false };
  return { supported: true, enabled: getConfig('kiosk_shell_enabled') === true };
});

// ─── Kiosk escape hatch ────────────────────────────────────────
// A small, always-on-top password window that lets an operator exit Kiosk
// Mode without going through the (possibly unresponsive) main app renderer.
// Uses its own dedicated preload (kioskEscapePreload.js), NOT preload.js —
// it must keep working even if the main window's renderer is dead.
let kioskEscapeWindow = null;
const kioskEscapeRateLimiter = createRateLimiter(5, 60_000); // 5 attempts/minute
const splashAuthRateLimiter = createRateLimiter(5, 60_000);  // 5 attempts/minute
const returnToWindowsRateLimiter = createRateLimiter(5, 60_000);

// kioskEscape.html is loaded with loadFile(), so its frame URL is
// file:///…/kioskEscape.html — host "" — which the remote-origin guard
// (createIpcGuards, bound to TRUSTED_HOST) can never match. Registering
// kiosk:attempt-escape through guardedHandle therefore rejected EVERY call
// from the escape window, silently disabling the only way out of kiosk mode.
// It gets the local-file guard instead, allow-listing exactly this one page.
const KIOSK_ESCAPE_PAGE_PATH = path.join(__dirname, 'kioskEscape.html');
const { guardedHandle: guardedLocalFileHandle } = createLocalFileIpcGuards(ipcMain, [KIOSK_ESCAPE_PAGE_PATH]);
const SPLASH_PAGE_PATH = path.join(__dirname, 'splash.html');
const { guardedOn: guardedSplashOn } = createLocalFileIpcGuards(ipcMain, [SPLASH_PAGE_PATH]);

function openKioskEscapeWindow() {
  if (kioskEscapeWindow) { kioskEscapeWindow.focus(); return; }
  kioskEscapeWindow = new BrowserWindow({
    width: 420,
    height: 260,
    frame: true,
    alwaysOnTop: true,
    resizable: false,
    title: 'RMPG Flex — Exit Kiosk Mode',
    webPreferences: hardenWebPreferencesDefaults({
      preload: resolveTrustedPreloadPath(path.join(__dirname, 'kioskEscapePreload.js'), path.join(__dirname, 'kioskEscapePreload.js')),
    }),
  });
  kioskEscapeWindow.setMenu(null);
  kioskEscapeWindow.loadFile(KIOSK_ESCAPE_PAGE_PATH);
  kioskEscapeWindow.on('closed', () => { kioskEscapeWindow = null; });
}

guardedLocalFileHandle('kiosk:attempt-escape', async (event, username, password) => {
  const rateCheck = kioskEscapeRateLimiter.checkRateLimit('kiosk:attempt-escape');
  if (!rateCheck.ok) {
    logSecurityAuditEvent('kiosk:attempt-escape', 'denied', { reason: 'rate_limited' });
    return rateCheck;
  }
  const shapeCheck = validateKioskEscapeCredentials(username, password);
  if (!shapeCheck.ok) return shapeCheck;

  try {
    const loginUrl = `${KIOSK_ESCAPE_API_BASE}/api/auth/login`;
    if (!isAllowedApiHost(loginUrl, [KIOSK_ESCAPE_API_HOSTNAME])) {
      logSecurityAuditEvent('kiosk:attempt-escape', 'error', { reason: 'host_not_allowlisted' });
      return { ok: false, error: 'Could not reach the server — check network connectivity and try again.' };
    }
    // Always a live call to the API — never a cached/offline credential
    // check — since the whole point of the escape hatch is to prove the
    // operator has current admin/manager credentials right now.
    const result = await withRequestTimeout(
      new Promise((resolve, reject) => {
        const request = net.request({ method: 'POST', url: loginUrl });
        request.setHeader('Content-Type', 'application/json');
        let body = '';
        request.on('response', (response) => {
          response.on('data', (chunk) => { body += chunk.toString(); });
          response.on('end', () => resolve(body));
        });
        request.on('error', reject);
        request.write(JSON.stringify({ username, password }));
        request.end();
      }),
      DEFAULT_IPC_REQUEST_TIMEOUT_MS,
      setTimeout
    );
    const validation = validateEscapeLoginResponse(result);
    logSecurityAuditEvent('kiosk:attempt-escape', validation.ok ? 'success' : 'denied', { username });
    if (!validation.ok) return validation;

    // Deliberate revert-and-restart — see kioskDeliberatelyReverting's
    // definition near the top of this file. Set before the registry write
    // so window-all-closed never mistakes this for an unexpected exit.
    kioskDeliberatelyReverting = true;
    // Delete the HKCU Shell value — restores the HKLM explorer.exe default
    // without requiring UAC. No UAC prompt = no accidental dismissal path.
    const revert = await deleteHkcuShell();
    if (!revert.ok) {
      // The HKCU delete failed unexpectedly. Un-latch the deliberate-revert
      // flag: leaving it set would make the next window-all-closed exit for
      // real and strand the machine with no shell.
      kioskDeliberatelyReverting = false;
      logSecurityAuditEvent('kiosk:attempt-escape', 'error', { reason: 'registry_revert_failed', error: revert.error });
      return { ok: false, error: `Could not restore the Windows desktop shell: ${revert.error}. Contact IT support for a manual registry revert.` };
    }
    setConfig('kiosk_shell_enabled', false);
    setConfig('kiosk_boot_attempts', resetBootAttemptState());
    kioskEscapeWindow?.close();
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'Kiosk Mode Disabled',
      message: 'Kiosk Mode has been disabled. Restart the computer to return to the normal Windows desktop.',
    });
    return { ok: true };
  } catch (err) {
    logSecurityAuditEvent('kiosk:attempt-escape', 'error', { error: err.message });
    return { ok: false, error: 'Could not reach the server — check network connectivity and try again.' };
  }
});

// Renderer-initiated kiosk revert (from FlexOSPowerMenu) — counterpart to
// kiosk:attempt-escape (which is called from the kioskEscape.html file://
// window). Uses guardedHandle (trusted remote origin) not guardedLocalFileHandle.
guardedHandle('os:return-to-windows', async (event, username, password) => {
  if (process.platform !== 'win32') return { ok: false, error: 'not_supported' };
  if (getConfig('kiosk_shell_enabled') !== true) return { ok: false, error: 'not_in_kiosk_mode' };

  const rateCheck = returnToWindowsRateLimiter.checkRateLimit('os:return-to-windows');
  if (!rateCheck.ok) {
    logSecurityAuditEvent('os:return-to-windows', 'denied', { reason: 'rate_limited' });
    return rateCheck;
  }

  const shapeCheck = validateKioskEscapeCredentials(username, password);
  if (!shapeCheck.ok) return shapeCheck;

  try {
    const loginUrl = `${KIOSK_ESCAPE_API_BASE}/api/auth/login`;
    if (!isAllowedApiHost(loginUrl, [KIOSK_ESCAPE_API_HOSTNAME])) {
      logSecurityAuditEvent('os:return-to-windows', 'error', { reason: 'host_not_allowlisted' });
      return { ok: false, error: 'Could not reach the server — check network connectivity and try again.' };
    }
    const result = await withRequestTimeout(
      new Promise((resolve, reject) => {
        const request = net.request({ method: 'POST', url: loginUrl });
        request.setHeader('Content-Type', 'application/json');
        let body = '';
        request.on('response', (response) => {
          response.on('data', (chunk) => { body += chunk.toString(); });
          response.on('end', () => resolve(body));
        });
        request.on('error', reject);
        request.write(JSON.stringify({ username, password }));
        request.end();
      }),
      DEFAULT_IPC_REQUEST_TIMEOUT_MS,
      setTimeout
    );
    const validation = validateEscapeLoginResponse(result);
    logSecurityAuditEvent('os:return-to-windows', validation.ok ? 'success' : 'denied', { username });
    if (!validation.ok) return validation;

    kioskDeliberatelyReverting = true;
    const revert = await deleteHkcuShell();
    if (!revert.ok) {
      kioskDeliberatelyReverting = false;
      logSecurityAuditEvent('os:return-to-windows', 'error', { reason: 'registry_revert_failed', error: revert.error });
      return { ok: false, error: `Could not restore the Windows desktop shell: ${revert.error}. Contact IT support for a manual registry revert.` };
    }
    logSecurityAuditEvent('os:return-to-windows', 'success', { reason: 'registry_reverted', username });
    setConfig('kiosk_shell_enabled', false);
    setConfig('kiosk_boot_attempts', resetBootAttemptState());
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'Kiosk Mode Disabled',
      message: 'Kiosk Mode has been disabled. Restart the computer to return to the normal Windows desktop.',
    });
    return { ok: true };
  } catch (err) {
    logSecurityAuditEvent('os:return-to-windows', 'error', { error: err.message });
    return { ok: false, error: 'Could not reach the server — check network connectivity and try again.' };
  }
});

// ── Startup lock screen authentication ──────────────────────
// Forwards FlexOS credentials from the splash lock screen to /api/auth/login.
// Uses guardedSplashOn (file:// sender guard) not guardedOn (remote-origin guard)
// because splash.html is loaded via loadFile(), giving it a file:// sender URL.
guardedSplashOn('splash:auth', async (event, payload) => {
  const rateCheck = splashAuthRateLimiter.checkRateLimit('splash:auth');
  if (!rateCheck.ok) {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('splash:auth-result', { ok: false, error: 'Too many attempts — please wait before trying again.' });
    }
    return;
  }

  const username = (payload && typeof payload.username === 'string') ? payload.username.trim() : '';
  const password = (payload && typeof payload.password === 'string') ? payload.password : '';

  const sendResult = (data) => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('splash:auth-result', data);
    }
  };

  if (!username || !password) {
    sendResult({ ok: false, error: 'Username and password are required' });
    return;
  }

  if (!isAllowedApiHost(KIOSK_ESCAPE_API_BASE, [KIOSK_ESCAPE_API_HOSTNAME].filter(Boolean))) {
    sendResult({ ok: false, error: 'Auth endpoint not configured' });
    return;
  }

  try {
    const loginUrl = `${KIOSK_ESCAPE_API_BASE}/api/auth/login`;
    const response = await withRequestTimeout(
      fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      }),
      DEFAULT_IPC_REQUEST_TIMEOUT_MS
    );
    const rawJson = await response.text();
    const validated = validateFlexOsLoginResponse(rawJson);

    sendResult(validated.ok
      ? { ok: true, officer: validated.officer }
      : { ok: false, error: validated.error }
    );

    if (validated.ok) {
      // Persist the session token and last-used FlexOS username.
      try {
        const parsedResponse = JSON.parse(rawJson);
        if (parsedResponse && parsedResponse.token) {
          setConfig('last_session_token', parsedResponse.token);
        }
      } catch (_) {}
      try { setConfig('last_flexos_username', username); } catch (_) {}
      // Transition splash to Phase 3 (welcome), then close after animation.
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.send('splash:phase', {
          phase: 'welcome',
          data: { officerName: validated.officer.name, role: validated.officer.role },
        });
        // Phase 3 animates for 2.5s + 400ms fade. Close splash and show main after 3.1s.
        setTimeout(() => {
          closeSplash();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
          }
        }, 3100);
      }
    }
  } catch (err) {
    console.error('[SPLASH:AUTH] Login request failed:', err.message);
    sendResult({ ok: false, error: 'Unable to reach server — check network connection' });
  }
});

guardedHandle('device:auto-launch-state', () => app.getLoginItemSettings().openAtLogin);
guardedHandle('device:register-shortcut', (event, accelerator, actionId) => {
  const validation = validateGlobalShortcutAccelerator(accelerator);
  if (!validation.ok) {
    logSecurityAuditEvent('device:register-shortcut', 'denied', { actionId });
    return { ok: false, error: validation.error };
  }
  const registered = globalShortcut.register(accelerator, () => {
    mainWindow?.webContents.send('device:shortcut-triggered', actionId);
  });
  logSecurityAuditEvent('device:register-shortcut', registered ? 'success' : 'error', { accelerator, actionId });
  return registered ? { ok: true } : { ok: false, error: 'registration failed (already taken by another app?)' };
});
guardedHandle('device:unregister-shortcut', (event, accelerator) => {
  const validation = validateGlobalShortcutAccelerator(accelerator);
  if (validation.ok) globalShortcut.unregister(accelerator);
});
guardedHandle('device:displays', () => formatDisplays(screen.getAllDisplays(), screen.getPrimaryDisplay().id));

// ─── Crash-safe printing ─────────────────────────────────────
// macOS 26's native print panel (NSPrintPanel → PrintingUI →
// PJCSessionHasApplicationSetPrinter) segfaults when opened from
// Electron 40 — window.print() hard-crashes the whole app
// (EXC_BAD_ACCESS in CrBrowserMain). We never open the AppKit panel:
// every print renders via Chromium's printToPDF (no AppKit) and the
// PDF is handed to macOS Preview, whose print dialog is stable.
const { webFrameMain } = require('electron');

const PRINT_OVERRIDE_JS = `(() => {
  if (window.__rmpgPrintPatched) return;
  window.__rmpgPrintPatched = true;
  window.print = () => {
    try {
      if (window.electron && window.electron.printToPdf) { window.electron.printToPdf(); return; }
    } catch (e) {}
    // Subframes (iframes / window.open) have no preload bridge —
    // delegate to the top frame, which is patched and bridged.
    try { window.top.print(); } catch (e) {}
  };
})();`;

// ─── Renderer / GPU crash recovery ───────────────────────────
// Neither `did-fail-load` (in createMainWindow) nor the client's own WebGL
// context-loss watchdog (client/src/utils/webglRecovery.ts) can help here:
// that code runs INSIDE the renderer, so it can't run once the renderer
// itself is gone. Without this, a crashed renderer/GPU process left the
// window permanently dead — a normal reload does nothing because the
// process that would carry out the reload no longer exists — requiring a
// full app restart with no console access in the field to see why. See
// crashRecovery.js for the rolling-window recovery cap this uses.
//
// Module-level (not inside createMainWindow) because createMainWindow() can
// run more than once per process (app 'activate', kiosk self-heal); a
// per-call registration here would stack duplicate `app`-level listeners
// each time. `mainWindow` is always read fresh at call time via closure, so
// this stays correct across window recreation.
function recoverMainWindow(source, reason) {
  console.error(`[APP] ${source} crash: reason=${reason}`);
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.log(`[APP] ${source}: no live main window to recover`);
    return;
  }
  if (!isRecoverableCrashReason(reason)) {
    console.log(`[APP] ${source}: '${reason}' is not a crash reason, ignoring`);
    return;
  }
  const now = Date.now();
  if (!shouldAutoRecover(rendererRecoveryTimestamps, now)) {
    console.error(`[APP] ${source}: too many recoveries in the rolling window — showing crash-loop screen`);
    mainWindow.loadURL(getCrashLoopHTML()).catch((err) => {
      console.warn('[APP] Crash-loop page loadURL failed:', err && err.message);
    });
    return;
  }
  rendererRecoveryTimestamps = recordRecoveryAttempt(rendererRecoveryTimestamps, now);
  console.warn(`[APP] ${source}: reloading to recover`);
  mainWindow.loadURL(REMOTE_SERVER_URL).catch((err) => {
    console.warn('[APP] Recovery loadURL failed (did-fail-load will handle a further failure):', err && err.message);
  });
}

// GPU process crashes are process-wide, not per-webContents, so this is an
// app-level listener registered exactly once — but it drives the SAME
// window/counter as the per-webContents `render-process-gone` listener in
// createMainWindow, since a lost GPU process kills that window's rendering
// too and both must share one recovery cap.
app.on('child-process-gone', (event, details) => {
  if (!details || details.type !== 'GPU') return;
  recoverMainWindow('GPU process', details.reason);
});

// Only inject the window.print() override on macOS — the NSPrintPanel
// segfault is macOS-specific. On Windows/Linux, window.print() works
// fine and opens the native print dialog directly.
if (process.platform === 'darwin') {
  app.on('web-contents-created', (_event, wc) => {
    wc.on('did-frame-finish-load', (_ev, _isMainFrame, frameProcessId, frameRoutingId) => {
      try {
        const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
        if (frame) frame.executeJavaScript(PRINT_OVERRIDE_JS).catch(() => {});
      } catch (e) { /* frame may already be gone */ }
    });
  });
}

guardedHandle('print:to-pdf', async (event) => {
  if (process.platform === 'darwin') {
    // macOS: render to PDF and open in Preview (avoids NSPrintPanel segfault).
    const fs = require('fs');
    try {
      const pdf = await event.sender.printToPDF({ printBackground: true });
      const file = path.join(app.getPath('temp'), `rmpg-print-${Date.now()}.pdf`);
      await fs.promises.writeFile(file, pdf);
      const err = await shell.openPath(file);
      return { ok: !err, file, error: err || undefined };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  // Windows/Linux: use native print dialog directly — no segfault risk.
  return new Promise((resolve) => {
    event.sender.print({ silent: false, printBackground: true }, (success, failureReason) => {
      resolve(success ? { ok: true } : { ok: false, error: failureReason });
    });
  });
});

// ─── Recon Connect launcher ───────────────────────────────
// Spawns the locally-installed toolkit in a detached terminal window. The
// Python CLI lives outside Flex; we only hand off — no stdio piping, no
// privilege delegation. Returns { ok, error? } so the renderer can show
// a copy-command fallback if the binary isn't installed.
guardedHandle('recon:launch', async () => {
  // First check, before any platform-detection/spawn logic: recon tools are
  // a local-system escape hatch, so launching one requires the same
  // admin-always-allowed / active-PIN-session-required rule offline:state
  // enforces for local data access — this handler had NO auth check at all
  // before this guard.
  try {
    const db = getLocalDb();
    const cachedUserId = getConfig('current_user_id');
    const cachedRole = getConfig('current_user_role');
    let activeSession = null;
    if (db && cachedRole !== 'admin' && cachedUserId) {
      activeSession = db.prepare(
        `SELECT expires_at, device_id FROM pin_sessions
         WHERE user_id = ? AND is_active = 1 AND expires_at > ?
         ORDER BY expires_at DESC LIMIT 1`
      ).get(cachedUserId, new Date().toISOString()) || null;
    }
    const currentDeviceId = getOrCreateDeviceId(getConfig, setConfig, require('crypto').randomUUID);
    if (!isReconLaunchAuthorized(cachedRole, activeSession, currentDeviceId, Date.now())) {
      return { ok: false, error: 'recon connect requires an active authenticated session' };
    }
  } catch (err) {
    console.error('[RECON:LAUNCH] Auth check failed:', err.message);
    return { ok: false, error: 'recon connect requires an active authenticated session' };
  }

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

guardedHandle('recon:term-spawn', async (event, { mode } = {}) => {
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

guardedOn('recon:term-input', (_event, { sessionId, data }) => {
  const child = reconSessions.get(sessionId);
  if (child && !child.killed) {
    try { child.stdin.write(data); } catch { /* pipe closed */ }
  }
});

guardedOn('recon:term-resize', (_event, _payload) => {
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
    // Vuln-script scans against every detected service run longer than a
    // plain service-detection scan; 20 min gives it room without inheriting
    // nmap-full's 30 min (it's typically far more bounded than a -p- sweep).
    timeoutMs: 20 * 60 * 1000,
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
    // The actually-invoked tool binary, for callers (recon:check-binary /
    // the renderer's install badges) that want to probe for `gobuster`
    // itself rather than `bash` — `.command` is `bash` here because the
    // real invocation is a wrapper script (see buildArgs below), not a
    // direct gobuster spawn.
    checkBinary: 'gobuster',
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
    // Full 65535-TCP-port scan with service detection routinely takes
    // 15-40+ min against a real host (more against one with many open
    // services, or a firewall dropping rather than rejecting probes) —
    // the global DEFAULT_CHILD_PROCESS_TIMEOUT_MS (10 min) would kill it
    // mid-scan under normal conditions, not just when it's actually hung.
    timeoutMs: 30 * 60 * 1000,
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
guardedHandle('recon:tool-install', async (event, { pkg } = {}) => {
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
    const pathParts = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', process.env.PATH || ''].filter(Boolean);
    const child = spawn(brewPath, ['install', pkg], {
      env: {
        ...buildSandboxedChildEnv(process.env, pathParts),
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

guardedHandle('recon:tool-spawn', async (event, { toolId, args = {} } = {}) => {
  const rateCheck = checkRateLimit('recon:tool-spawn');
  if (!rateCheck.ok) {
    logSecurityAuditEvent('recon:tool-spawn', 'denied', { toolId });
    return { ok: false, error: rateCheck.error };
  }
  const argsCheck = sanitizeReconToolArgs(toolId, args, RECON_TOOLS);
  if (!argsCheck.ok) {
    logSecurityAuditEvent('recon:tool-spawn', 'denied', { toolId });
    return { ok: false, error: argsCheck.error };
  }
  if (isAtConcurrencyLimit(toolSessions.size, MAX_CONCURRENT_TOOLS)) {
    logSecurityAuditEvent('recon:tool-spawn', 'denied', { toolId });
    return { ok: false, error: 'too many concurrent recon tools running' };
  }
  const { spawn } = require('child_process');
  const crypto = require('crypto');
  const fs = require('fs');
  const tool = RECON_TOOLS[toolId];
  if (!tool) {
    logSecurityAuditEvent('recon:tool-spawn', 'denied', { toolId });
    return { ok: false, error: `Unknown tool: ${toolId}` };
  }
  if (!tool.platform.includes(process.platform)) {
    logSecurityAuditEvent('recon:tool-spawn', 'denied', { toolId });
    return { ok: false, error: `${tool.title} is not supported on ${process.platform}.` };
  }
  let argv;
  try {
    argv = tool.buildArgs(args);
  } catch (err) {
    logSecurityAuditEvent('recon:tool-spawn', 'error', { toolId });
    return { ok: false, error: err.message || 'Invalid arguments' };
  }
  // Confirm binary exists — give users a clear "install X" message
  if (tool.requiresInstall) {
    const pathDirs = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
    const found = pathDirs.some((d) => fs.existsSync(`${d}/${tool.command}`));
    if (!found) {
      logSecurityAuditEvent('recon:tool-spawn', 'error', { toolId });
      return { ok: false, error: `${tool.command} is not installed. Run: brew install ${tool.requiresInstall}` };
    }
  }
  try {
    const pathParts = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources', process.env.PATH || ''].filter(Boolean);
    const child = spawn(tool.command, argv, {
      env: buildSandboxedChildEnv(process.env, pathParts),
    });
    const sessionId = crypto.randomUUID();
    toolSessions.set(sessionId, child);
    logSecurityAuditEvent('recon:tool-spawn', 'success', { toolId, sessionId });
    const timeoutHandle = scheduleChildProcessTimeout(child, resolveChildProcessTimeoutMs(tool, DEFAULT_CHILD_PROCESS_TIMEOUT_MS), setTimeout);
    const send = (kind, data) => {
      if (!event.sender.isDestroyed()) event.sender.send('recon:tool-data', { sessionId, kind, data });
    };
    child.stdout.on('data', (b) => send('stdout', b.toString('utf8')));
    child.stderr.on('data', (b) => send('stderr', b.toString('utf8')));
    child.on('exit', (code) => {
      clearTimeout(timeoutHandle);
      toolSessions.delete(sessionId);
      if (!event.sender.isDestroyed()) event.sender.send('recon:tool-exit', { sessionId, code });
    });
    child.on('error', (err) => send('stderr', `[spawn error] ${err.message}\n`));
    return { ok: true, sessionId, title: tool.title };
  } catch (err) {
    logSecurityAuditEvent('recon:tool-spawn', 'error', { toolId });
    return { ok: false, error: err && err.message ? err.message : 'Spawn failed' };
  }
});

// Check whether a binary is on PATH — used by the renderer to show
// INSTALLED/NOT INSTALLED badges and skip the run if pre-flight fails.
guardedHandle('recon:check-binary', async (_event, { binary } = {}) => {
  if (!binary || !/^[a-zA-Z0-9._+-]+$/.test(binary)) return { installed: false, error: 'Invalid binary name' };
  // Additional allowlist layer (on top of the shape check above): only
  // binaries this recon toolset actually knows about can be probed here.
  // Derived live from RECON_TOOLS so it never drifts — includes each
  // tool's invoked `.command`, plus the secondary binary names some
  // entries legitimately depend on (`.checkBinary` for tools invoked via
  // a wrapper like `bash` — see 'gobuster-dir' — and `.requiresInstall`,
  // which for most entries is the same underlying CLI tool, e.g. r2-info's
  // `requiresInstall: 'radare2'` for the `r2` binary).
  const knownCommands = new Set(
    Object.values(RECON_TOOLS).flatMap((t) => [t.command, t.checkBinary, t.requiresInstall].filter(Boolean))
  );
  if (!isAllowedBinaryName(binary, knownCommands)) {
    return { installed: false, error: 'Unknown binary name' };
  }
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
    env: buildSandboxedChildEnv(process.env, pathParts),
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
guardedHandle('recon:tool-terminal', async (_event, { toolId, args = {} } = {}) => {
  const argsCheck = sanitizeReconToolArgs(toolId, args, RECON_TOOLS);
  if (!argsCheck.ok) return { ok: false, error: argsCheck.error };
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
guardedHandle('recon:catalog-terminal', async (_event, { category, className, kind, index } = {}) => {
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

guardedHandle('recon:tool-kill', async (_event, { sessionId }) => {
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
guardedHandle('recon:catalog-run', async (event, { category, className, kind, index } = {}) => {
  const rateCheck = checkRateLimit('recon:catalog-run');
  if (!rateCheck.ok) return { ok: false, error: rateCheck.error };
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

guardedHandle('recon:term-kill', async (_event, { sessionId }) => {
  const child = reconSessions.get(sessionId);
  if (!child) return { ok: true };
  try {
    child.kill('SIGTERM');
    setTimeout(() => {
      // child.killed is set synchronously once kill() sends the signal, not once the
      // process has actually exited — check exitCode/signalCode instead (see the
      // matching fix in scheduleChildProcessTimeout, desktop/security/childProcessGuard.js).
      const stillRunning = child.exitCode == null && child.signalCode == null;
      if (stillRunning) { try { child.kill('SIGKILL'); } catch { /* ignore */ } }
    }, 1500);
  } catch { /* ignore */ }
  reconSessions.delete(sessionId);
  return { ok: true };
});

// Detailed Recon Connect install state (path + whether hackingtool.py is present)
guardedHandle('recon:install-state', async () => {
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
guardedHandle('recon:update', async (event) => {
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
guardedHandle('recon:kill-all', async () => {
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
guardedHandle('recon:check', async () => {
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
guardedHandle('recon:install', async () => {
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
guardedHandle('app:force-refresh', async () => {
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

// ─── Internal GPS (Panasonic Toughbook) ──────────────────────
// On Toughbooks, the internal u-blox GPS module is exposed as a
// virtual COM port. We read raw NMEA sentences instead of relying
// on Chromium's geolocation (which falls back to WiFi triangulation
// and gives ~100-500m accuracy in moving vehicles).
//
// Lifecycle:
//   renderer → geo:internal-gps-detect → { isToughbook, portPath } | null
//   renderer → geo:internal-gps-start → boolean (started?)
//   renderer ← geo:internal-gps-update (event with { latitude, ... })
//   renderer → geo:internal-gps-stop  → void

let internalGpsReader = null;

// NOTE: a main-process geofence engine (_geofenceZones/_activeZoneIds/
// checkGeofences/haversineM, plus a 'geo:set-geofence-zones' IPC handler and
// 'geo:geofence-enter'/'geo:geofence-exit' events) previously lived here.
// Removed as dead code: preload.js exposed no setter for zones and no
// listener for the enter/exit events, no renderer code called any of it, so
// zones were always empty and checkGeofences() was a permanent no-op even
// before that. Geofencing is handled server-side in
// src/routes/dispatch/gps.ts against the live geofence_zones table — that
// system works and is exercised by real traffic; this one never was.

/**
 * Detect whether the host is a Panasonic Toughbook with a usable internal GPS.
 *
 * This function is CALLED ONCE on app startup. The decision drives whether
 * useGpsTracking.ts replaces navigator.geolocation entirely (per the team
 * decision 2026-05-27).
 *
 * Returns: { isToughbook: boolean, manufacturer: string, model: string, portPath: string | null }
 *
 * Detects RMPG Toughbook FZ-55 hardware via WMI + u-blox serial port enumeration.
 */
async function detectToughbook() {
  if (process.platform !== 'win32') {
    return { isToughbook: false, manufacturer: '', model: '', portPath: null };
  }
  try {
    const { execFile } = require('child_process');
    const wmi = await new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-Command', 'Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer, Model | ConvertTo-Json'],
        { timeout: 8000 },
        (err, stdout) => {
          if (err) return resolve(null);
          try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
        }
      );
    });
    const manufacturer = (wmi?.Manufacturer || '').trim();
    const model = (wmi?.Model || '').trim();

    // ─── Toughbook detection (RMPG fleet: FZ-55 only) ───
    // Only the Panasonic Toughbook FZ-55 ships internal GPS in the
    // RMPG fleet. CF-33s and other Panasonic gear (including consumer
    // Lumix laptops) should fall back to navigator.geolocation.
    // 'Matsushita' (Panasonic's pre-2008 name) is intentionally NOT
    // matched — no live RMPG hardware predates the 2008 rename.
    const mfg = manufacturer.toLowerCase();
    const mdl = model.toLowerCase();

    // Normalize the model so hyphen / spacing / case / SKU-suffix variants of
    // the order code all match. WMI reports the FZ-55 inconsistently across
    // BIOS/SKUs: "FZ-55", "FZ55", "FZ-55C", "FZ-55F MK2", "Toughbook FZ-55", …
    // The old exact `mdl.includes('fz-55')` (hyphen, lowercase) missed every
    // variant that lacked that precise hyphen → isToughbook=false → the unit
    // silently fell back to navigator.geolocation (WiFi/IP).
    //   ▶ Confirmed live 2026-06-02: an in-fleet FZ-55 was recording
    //     gps_source='browser_desktop' (the IP fallback) for exactly this reason.
    const mdlNorm = mdl.replace(/[^a-z0-9]/g, '');     // "FZ-55C" → "fz55c"
    const mfgIsPanasonic = mfg.includes('panasonic');
    const modelLooksFz55 = mdlNorm.includes('fz55');

    // Detect by HARDWARE PRESENCE, not just the model string. We ALWAYS
    // enumerate serial ports — the WMI manufacturer string is unreliable (some
    // FZ-55 SKUs report a blank or OEM manufacturer, and the PowerShell probe
    // above can degrade), so gating port discovery on `mfgIsPanasonic` silently
    // hid a present u-blox module and dropped the unit to WiFi triangulation.
    //
    // A u-blox VID (score 100) or a GNSS-named bridge (score 70) is hardware-
    // definitive — no consumer non-GPS machine exposes one — so it qualifies on
    // its own regardless of the manufacturer string. A weak name-only match
    // (score 50, e.g. a bare USB-serial adapter with "gps" in its label) is
    // trusted only on a confirmed Panasonic host, preserving the original intent
    // of keeping unrelated serial ports on non-Panasonic gear from being grabbed.
    const gpsPort = await findGpsPort();          // { path, score } | null
    const portPath = gpsPort?.path ?? null;
    const portIsDefinitive = (gpsPort?.score ?? 0) >= 70;
    const isToughbook =
      portIsDefinitive ||
      (mfgIsPanasonic && (modelLooksFz55 || portPath != null));

    console.log(`[INTERNAL-GPS] Detect: mfg="${manufacturer}" model="${model}" panasonic=${mfgIsPanasonic} fz55=${modelLooksFz55} port=${portPath || 'none'} score=${gpsPort?.score ?? 0} definitive=${portIsDefinitive} -> toughbook=${isToughbook}`);
    return { isToughbook, manufacturer, model, portPath };
  } catch (err) {
    console.warn('[INTERNAL-GPS] Detection failed:', err.message);
    return { isToughbook: false, manufacturer: '', model: '', portPath: null };
  }
}

guardedHandle('geo:internal-gps-detect', detectToughbook);

// Single source of truth for standing up the internal GPS reader — wires the
// channel names the preload/renderer actually listen on
// (`geo:internal-gps-update` / `geo:internal-gps-error`). Used by both the
// renderer-initiated `geo:internal-gps-start` IPC handler and the USB
// hot-plug auto-start below; a second, divergent copy of this wiring previously
// lived at the hot-plug site, sent on channels nothing listened for
// (`geo:position`/`gps:constellation`) — so any USB insertion (mouse,
// scanner, phone) silently killed location updates for the rest of the
// session by claiming `internalGpsReader` before the real start path could run.
async function startInternalGpsReader(portPath, baudRate) {
  if (internalGpsReader) return { ok: true, alreadyRunning: true };
  if (!portPath) {
    const detected = await detectToughbook();
    if (!detected.portPath) return { ok: false, error: 'No GPS COM port found' };
    portPath = detected.portPath;
  }
  internalGpsReader = new InternalGps();
  internalGpsReader.on('position', (pos) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('geo:internal-gps-update', pos);
    }
  });
  internalGpsReader.on('error', (err) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('geo:internal-gps-error', { message: err.message });
    }
  });
  // InternalGps emits this on $GPGSV sentences (satellite count/signal), but
  // nothing forwarded it to the renderer — no IPC channel, no preload
  // exposure. Forward it under its own event so a future satellite-count UI
  // has something to subscribe to (see onGpsConstellation in preload.js).
  internalGpsReader.on('gps:constellation', (c) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('geo:internal-gps-constellation', c);
    }
  });
  // No baud default here — let InternalGps probe its 9600-first ladder
  // (u-blox NEO-M8 ships at 9600; the old 4800 default never locked).
  const ok = await internalGpsReader.start(portPath, baudRate);
  return { ok, portPath };
}

guardedHandle('geo:internal-gps-start', async (_event, { portPath, baudRate } = {}) => {
  return startInternalGpsReader(portPath, baudRate);
});

guardedHandle('geo:internal-gps-stop', async () => {
  if (internalGpsReader) {
    internalGpsReader.stop();
    internalGpsReader.removeAllListeners();
    internalGpsReader = null;
  }
  return { ok: true };
});

// ─── Power management (keep navigation alive off-screen) ─────
// While a vehicle trip is active, the renderer asks the main process to hold a
// powerSaveBlocker so the Toughbook doesn't suspend mid-patrol. We use
// 'prevent-app-suspension' (NOT 'prevent-display-sleep'): the display may turn
// off to save power, but the system stays awake so the nav engine keeps
// calculating + uploading breadcrumbs in the background. The blocker is
// released the moment the trip ends (renderer calls power:allow-sleep) so a
// parked/idle unit returns to normal power behavior. Idempotent: repeated
// keep-awake calls reuse the single active blocker id.
let powerBlockerId = null;
guardedHandle('power:keep-awake', () => {
  try {
    if (powerBlockerId == null || !powerSaveBlocker.isStarted(powerBlockerId)) {
      powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
      console.log('[POWER] prevent-app-suspension started (id', powerBlockerId + ') — active trip');
    }
    return { ok: true, blocking: true };
  } catch (err) {
    console.warn('[POWER] keep-awake failed:', err.message);
    return { ok: false, error: err.message };
  }
});
guardedHandle('power:allow-sleep', () => {
  try {
    if (powerBlockerId != null && powerSaveBlocker.isStarted(powerBlockerId)) {
      powerSaveBlocker.stop(powerBlockerId);
      console.log('[POWER] prevent-app-suspension stopped — trip ended');
    }
    powerBlockerId = null;
    return { ok: true, blocking: false };
  } catch (err) {
    console.warn('[POWER] allow-sleep failed:', err.message);
    return { ok: false, error: err.message };
  }
});

// ─── IP Geolocation Fallback ─────────────────────────────────
// Desktop machines often lack GPS hardware. When Chromium's
// navigator.geolocation fails, the renderer can call this to get
// an approximate position via Google's Geolocation API (IP-based).
// Regression guard (see isAllowedApiHost's doc comment in childProcessGuard.js)
// for geo:ip-locate's outbound request — the URL below is a hardcoded
// literal today, not renderer-influenced, so this doesn't close an active
// vulnerability; it's a tripwire against a future accidental change that
// points this request somewhere other than Google's geolocation API.
const GEO_IP_LOCATE_ALLOWED_HOSTS = ['www.googleapis.com'];

guardedHandle('geo:ip-locate', async () => {
  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    const url = `https://www.googleapis.com/geolocation/v1/geolocate?key=${apiKey}`;
    if (!isAllowedApiHost(url, GEO_IP_LOCATE_ALLOWED_HOSTS)) {
      console.error('[GEO] IP geolocation blocked: URL host not allowlisted');
      return null;
    }
    // Task 7: bound the whole request/response cycle via withRequestTimeout
    // (childProcessGuard.js) — without this, a hung TCP connection or a
    // server that accepts the connection but never responds (net.request
    // never emits 'response' or 'error' in that case) would leave this IPC
    // handler — and the renderer awaiting it — hanging indefinitely.
    return await withRequestTimeout(
      new Promise((resolve, reject) => {
        const request = net.request({ method: 'POST', url });
        request.setHeader('Content-Type', 'application/json');
        let body = '';
        request.on('response', (response) => {
          response.on('data', (chunk) => { body += chunk.toString(); });
          response.on('end', () => {
            // Task 6: shape-validate the response body via parseIpLocateResponse
            // (childProcessGuard.js) instead of trusting JSON.parse + direct
            // data.location.lat/.lng access — fails closed on malformed JSON
            // or non-finite/missing coordinates so a bad response can never
            // hand the renderer a NaN/string coordinate.
            const parsed = parseIpLocateResponse(body);
            if (parsed.ok) {
              resolve({
                latitude: parsed.latitude,
                longitude: parsed.longitude,
                accuracy: parsed.accuracy,
              });
            } else {
              reject(new Error(parsed.error));
}
});

// ─── Device: get capture log ──────────────────────────────────────
guardedHandle('device:get-log', async () => {
  return { ok: true, log: [], latestEntry: null };
});

// ─── Device: export capture log ──────────────────────────────────
guardedHandle('device:export-log', async () => {
  return { ok: true };
});

// ─── Device: clear capture log ───────────────────────────────────
guardedHandle('device:clear-log', async () => {
  return { ok: true };
});

// ─── Device: delete a log entry ──────────────────────────────────
guardedHandle('device:delete-entry', async (_event, id) => {
  return { ok: true };
});

// ─── Device: full RF scan ────────────────────────────────────────
guardedHandle('device:scan-all', async () => {
  try {
    const result = await runRfScan({});
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
});

// ─── Device: ARP / NDP scan ───────────────────────────────────────
guardedHandle('device:scan-arp', async () => {
  try {
    const result = await runRfScan({ protocol: 'arp' });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
});

// ─── Device: Bluetooth scan ───────────────────────────────────────
guardedHandle('device:scan-bt', async () => {
  try {
    const result = await runRfScan({ protocol: 'bt' });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
});

// ─── Device: SSDP / UPnP scan ───────────────────────────────────────
guardedHandle('device:scan-sd', async () => {
  try {
    const result = await runRfScan({ protocol: 'ssdp' });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
});

// ─── Device: mDNS scan ─────────────────────────────────────────────
guardedHandle('device:scan-md', async () => {
  try {
    const result = await runRfScan({ protocol: 'mdns' });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
});

// ─── Device: NetBIOS scan ──────────────────────────────────────────
guardedHandle('device:scan-nb', async () => {
  try {
    const result = await runRfScan({ protocol: 'nb' });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
});
        });
        request.on('error', reject);
        request.write(JSON.stringify({}));
        request.end();
      }),
      DEFAULT_IPC_REQUEST_TIMEOUT_MS,
      setTimeout
    );
  } catch (err) {
    console.error('[GEO] IP geolocation fallback failed:', err.message);
    return null;
  }
});

// ─── Auth Session Bridge ─────────────────────────────────────
// The renderer (AuthContext.tsx / tokenRefresh.ts) calls this immediately
// after every successful login, 2FA completion, and access-token refresh.
// This is the ONLY path that seeds auth_token / refresh_token /
// current_user_id / current_user_role in local_config — before this
// existed, those keys were write-never: pinManager.js, offlineRouter.js,
// and syncManager.js's refreshAndRetry (its Task 10 identity-mismatch
// guard) all READ current_user_id, but nothing ever wrote it at login, so
// offline mode / PIN sessions / the mismatch guard could never actually
// engage on a fresh session — refreshAndRetry itself couldn't even run
// without a refresh_token, which was equally never seeded.
//
// current_user_id/current_user_role are derived from the token's own
// claims (extractSessionIdentity), not taken from a separately-passed
// value — same "trust the signed claims, not a sibling argument" approach
// this file already uses for the Task 10 mismatch check.
guardedHandle('auth:store-session', (_event, { token, refreshToken } = {}) => {
  if (typeof token !== 'string' || !token) {
    return { ok: false, error: 'token required' };
  }

  const identity = extractSessionIdentity(token);
  if (!identity) {
    return { ok: false, error: 'could not decode session token' };
  }

  setConfig('auth_token', token);
  if (typeof refreshToken === 'string' && refreshToken) {
    setConfig('refresh_token', refreshToken);
  }
  setConfig('current_user_id', identity.userId);
  if (identity.role) {
    setConfig('current_user_role', identity.role);
  }

  return { ok: true };
});

// ─── Offline Mode IPC Handlers ──────────────────────────────

// Route an API request through the local SQLite database
guardedHandle('offline:api', async (_event, { method, path, body }) => {
  try {
    if (isJwtExpiredLocally(getConfig('auth_token'), Date.now())) {
      return { status: 401, error: 'cached session expired' };
    }
    if (!offlineRouter) return { status: 503, error: 'Offline mode not initialized' };
    return offlineRouter.handle(method, path, body);
  } catch (err) {
    console.error('[OFFLINE:API] Error:', err.message);
    return { status: 500, error: err.message };
  }
});

// Get current offline/authorization state
guardedHandle('offline:state', () => {
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
        `SELECT expires_at, device_id FROM pin_sessions
         WHERE user_id = ? AND is_active = 1 AND expires_at > ?
         ORDER BY expires_at DESC LIMIT 1`
      ).get(cachedUserId, new Date().toISOString());
      if (session) {
        const currentDeviceId = getOrCreateDeviceId(getConfig, setConfig, require('crypto').randomUUID);
        if (isPinSessionBoundToDevice(session, currentDeviceId)) {
          isLocalAuthorized = true;
          expiresAt = session.expires_at;
        }
        // else: session exists but was created on a different device —
        // treat as if no active session exists (same as the `if (session)`
        // falling through below with isLocalAuthorized left false).
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
guardedHandle('offline:enter-pin', (_event, { pin }) => {
  const pinCheck = validatePinInput(pin);
  if (!pinCheck.ok) return { success: false, error: pinCheck.error };
  try {
    if (!pinManager) return { success: false, error: 'PIN system not initialized' };
    return pinManager.validatePin(pin);
  } catch (err) {
    console.error('[OFFLINE:PIN] Error:', err.message);
    return { success: false, error: err.message };
  }
});

// Admin generates a PIN for an employee
guardedHandle('offline:generate-pin', (_event, { userId }) => {
  const roleCheck = requireOfflineAuthForSensitiveIpc(getConfig('current_user_role'));
  if (!roleCheck.ok) {
    logSecurityAuditEvent('offline:generate-pin', 'denied', { targetUserId: userId });
    return { error: roleCheck.error };
  }
  const userIdCheck = validateUserIdInput(userId);
  if (!userIdCheck.ok) {
    logSecurityAuditEvent('offline:generate-pin', 'denied', { targetUserId: userId });
    return { error: userIdCheck.error };
  }
  try {
    if (!pinManager) {
      logSecurityAuditEvent('offline:generate-pin', 'error', { targetUserId: userId });
      return { error: 'PIN system not initialized' };
    }
    // Note: intentionally logging only targetUserId — never the PIN
    // value/plaintext contained in pinManager.generatePinForUser()'s
    // return value.
    const result = pinManager.generatePinForUser(userId);
    logSecurityAuditEvent('offline:generate-pin', 'success', { targetUserId: userId });
    return result;
  } catch (err) {
    console.error('[OFFLINE:GENERATE-PIN] Error:', err.message);
    logSecurityAuditEvent('offline:generate-pin', 'error', { targetUserId: userId });
    return { error: err.message };
  }
});

// Get sync status
guardedHandle('offline:sync-status', () => {
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
guardedHandle('offline:trigger-sync', async () => {
  const rateCheck = checkRateLimit('offline:trigger-sync');
  if (!rateCheck.ok) return { success: false, error: rateCheck.error };
  try {
    if (syncManager && connectivityMonitor?.isOnline) {
      // Task 7: bound the manual "sync now" trigger via withRequestTimeout
      // (childProcessGuard.js) — pullAll() loops sequentially over every
      // mirrored table; without an outer bound, a network outage mid-loop
      // (each individual pull already timing out+retrying internally)
      // could leave this IPC call — and the renderer's "sync now" button —
      // hanging far longer than a manual trigger should ever block for.
      // OFFLINE_TRIGGER_SYNC_TIMEOUT_MS is deliberately longer than
      // DEFAULT_IPC_REQUEST_TIMEOUT_MS since it bounds a multi-table pull,
      // not a single request — see its doc comment in childProcessGuard.js.
      await withRequestTimeout(syncManager.pullAll(), OFFLINE_TRIGGER_SYNC_TIMEOUT_MS, setTimeout);
      return { success: true };
    }
    return { success: false, error: 'Sync not available (offline or not initialized)' };
  } catch (err) {
    console.error('[OFFLINE:TRIGGER-SYNC] Error:', err.message);
    return { success: false, error: err.message };
  }
});

// Pause background sync (pull timers + pullAll/pushAll become no-ops)
guardedHandle('sync:pause', () => {
  if (syncManager) syncManager.pauseSync();
});

// Resume background sync
guardedHandle('sync:resume', () => {
  if (syncManager) syncManager.resumeSync();
});

// Per-item sync queue detail (pending + failed rows) for diagnostics UI
guardedHandle('sync:queue-detail', () => getSyncQueueDetail());

// Get current write queue size
guardedHandle('sync:write-queue-size', () => getQueueDepth());

// Reset a single sync_queue item back to pending so it replays on the next sync cycle
guardedHandle('sync:retry-item', (event, id) => {
  const idCheck = validateSyncQueueIdInput(id);
  if (!idCheck.ok) return { ok: false, error: idCheck.error };
  return retrySyncQueueItem(id);
});

// Bulk-clear every 'failed' sync_queue row (diagnostics UI "clear failed" action)
guardedHandle('sync:clear-failed', () => clearFailedSyncItems());

// Most recent sync error (pullTable/pushAll failure), for diagnostics UI
guardedHandle('sync:last-error', () => getLastSyncError());

// Read-only per-table row-count + on-disk-size report for the local SQLite
// cache (offline-status panel). Works even when syncManager is still null
// (not yet online this session) — see getLocalCacheStats()'s doc comment
// in localDb.js for why it doesn't depend on syncManager's PULL_INTERVALS.
guardedHandle('sync:cache-stats', () => getLocalCacheStats());

// Destructive (single table): clears one mirrored cache table + its
// sync_metadata row, from the diagnostics UI. `table` comes directly from
// renderer/IPC input, so the allowlist check against
// MIRRORED_CACHE_TABLE_NAMES happens inside clearLocalCache() itself,
// before any SQL string is built — see that function's doc comment in
// localDb.js for the SQL-injection-via-identifier reasoning.
guardedHandle('sync:clear-cache', (event, table) => clearLocalCache(table));

// Destructive: wipes the mirrored/reference cache tables (never sync_queue
// or gps_breadcrumbs) and does a full re-pull from the server. Diagnostics
// UI "force full resync" action.
//
// Requires live connectivity, checked here (not inside syncManager, which
// has no connectivityMonitor dependency). syncManager.forceFullResync()
// already refuses while paused, but pullAll()'s per-table pullTable() calls
// only console.warn on fetch failure — they never throw — so pullAll()
// resolves cleanly even when every pull silently failed. Offline, that
// would let forceFullResync() wipe the cache (including `users`, which
// backs offline PIN auth) and report {ok:true} with nothing repopulated.
// Checking connectivity before ever calling into syncManager keeps the
// wipe from running at all in that case.
guardedHandle('sync:force-full', async () => {
  if (!syncManager) return { ok: false, error: 'sync not initialized' };
  if (!connectivityMonitor?.isOnline) {
    return { ok: false, error: 'cannot force a full resync while offline' };
  }
  return syncManager.forceFullResync();
});

// Get locally cached user for offline authentication
guardedHandle('offline:get-cached-user', (_event, { username }) => {
  try {
    const db = getLocalDb();
    const user = db.prepare(
      `SELECT id, username, password_hash, first_name, last_name, full_name,
              email, role, badge_number, phone, status, avatar_url, created_at
       FROM users WHERE username = ? AND status = 'active'`
    ).get(username);
    if (!user) return null;
    return { ...user, password_hash: decryptPasswordHashOrFallback(user.password_hash, safeStorage) };
  } catch (err) {
    console.error('[OFFLINE:CACHED-USER] Error:', err.message);
    return null;
  }
});

// ─── Face Recognition Auth ──────────────────────────────────
// Enrollment: renderer captures N frames, extracts embeddings via face-api.js
// (runs in renderer — has canvas + camera access), sends averaged embedding here.
guardedHandle('face:enroll', (_event, { userId, embedding }) => {
  if (!faceAuth) return { ok: false, error: 'face_auth_unavailable' };
  if (!userId || !Array.isArray(embedding) || embedding.length !== 128) return { ok: false, error: 'invalid_params' };
  try {
    faceAuth.storeEmbedding(userId, new Float32Array(embedding));
    logSecurityAuditEvent('face:enroll', 'success', { targetUserId: userId });
    return { ok: true };
  } catch (err) {
    logSecurityAuditEvent('face:enroll', 'error', { targetUserId: userId, error: err.message });
    return { ok: false, error: err.message };
  }
});

// Verify: renderer sends a live embedding (extracted by face-api.js in renderer).
guardedHandle('face:verify', (_event, { userId, embedding }) => {
  if (!faceAuth) return { ok: false, reason: 'face_auth_unavailable' };
  if (!userId || !Array.isArray(embedding) || embedding.length !== 128) return { ok: false, reason: 'invalid_params' };
  try {
    const result = faceAuth.verify(userId, new Float32Array(embedding));
    logSecurityAuditEvent('face:verify', result.match ? 'success' : 'denied', {
      targetUserId: userId, confidence: result.confidence,
    });
    return { ok: result.match, confidence: result.confidence, reason: result.reason };
  } catch (err) {
    logSecurityAuditEvent('face:verify', 'error', { targetUserId: userId, error: err.message });
    return { ok: false, reason: err.message };
  }
});

guardedHandle('face:clear', (_event, { userId }) => {
  if (!faceAuth) return { ok: false, error: 'face_auth_unavailable' };
  try {
    faceAuth.deleteEmbedding(userId);
    logSecurityAuditEvent('face:clear', 'success', { targetUserId: userId });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

guardedHandle('face:enrollment-status', (_event, { userId }) => {
  if (!faceAuth) return { enrolled: false };
  const embedding = faceAuth.getEmbedding(userId);
  return { enrolled: embedding !== null };
});

// ── Face unlock success (from splash lock screen renderer) ──
// Uses guardedSplashOn (local-file guard) to verify the sender is the trusted
// splash.html loaded via loadFile(), preventing a compromised renderer from
// bypassing authentication by sending this IPC directly.
guardedSplashOn('face:unlock-success', () => {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  mainWindow?.show();
  mainWindow?.focus();
  logSecurityAuditEvent('face:unlock-success', 'success', {});
});

// ── Camera QR / Barcode Scanner ──
guardedHandle('device:camera-scan-start', () => {
  if (!cameraScanner) cameraScanner = new CameraScanner();
  const started = cameraScanner.start(mainWindow, BrowserWindow);
  return { ok: started };
});

guardedHandle('device:camera-scan-stop', () => {
  cameraScanner?.stop();
  return { ok: true };
});

// ── System info: battery (Windows only) ──
guardedHandle('system:get-battery', async () => {
  if (process.platform !== 'win32') return null;
  try {
    const { execFile } = require('child_process');
    const out = await new Promise((resolve, reject) => {
      execFile(
        'wmic',
        ['path', 'Win32_Battery', 'get', 'EstimatedChargeRemaining,BatteryStatus', '/format:csv'],
        { timeout: 3000, encoding: 'utf8', windowsHide: true },
        (err, stdout) => err ? reject(err) : resolve(stdout)
      );
    });
    const lines = out.trim().split('\n').filter(l => l.trim() && !l.startsWith('Node'));
    if (!lines.length) return null;
    const parts = lines[0].trim().split(',');
    // CSV columns: Node, EstimatedChargeRemaining, BatteryStatus
    const pct = parseInt(parts[1], 10);
    const status = parseInt(parts[2], 10); // 2 = AC/charging, 1 = discharging
    return { percent: isNaN(pct) ? null : pct, charging: status === 2 };
  } catch { return null; }
});

// ── System info: WiFi network (Windows only) ──
guardedHandle('system:get-network', async () => {
  if (process.platform !== 'win32') return null;
  try {
    const { execSync } = require('child_process');
    const out = execSync(
      'netsh wlan show interfaces',
      { timeout: 3000, encoding: 'utf8', windowsHide: true }
    );
    const ssidMatch = out.match(/^\s+SSID\s+:\s+(.+)/m);
    const signalMatch = out.match(/^\s+Signal\s+:\s+(\d+)%/m);
    return {
      ssid: ssidMatch ? ssidMatch[1].trim() : null,
      signal: signalMatch ? parseInt(signalMatch[1], 10) : null,
    };
  } catch { return null; }
});

// ── WiFi: deep detail (IP, gateway, DNS, channel, band, MAC, …) ──
guardedHandle('wifi:get-detail', async () => {
  if (process.platform !== 'win32') return null;
  const { execSync } = require('child_process');
  const os = require('os');

  // --- netsh wlan show interfaces ---
  let wlanOut = '';
  try { wlanOut = execSync('netsh wlan show interfaces', { timeout: 4000, encoding: 'utf8', windowsHide: true }); } catch { /* no adapter */ }

  const parsed = parseNetshGetDetail(wlanOut) || {};

  // --- IP info from os.networkInterfaces() matched by MAC ---
  let ip = null, ipv6 = null, subnet = null;
  const normalMac = parsed.mac ? parsed.mac.toLowerCase().replace(/-/g, ':') : null;
  if (normalMac) {
    const ifaces = os.networkInterfaces();
    for (const ifAddrs of Object.values(ifaces)) {
      const entry = ifAddrs.find(a => a.mac && a.mac.toLowerCase() === normalMac);
      if (entry) {
        const v4 = ifAddrs.find(a => a.family === 'IPv4' && !a.internal);
        const v6 = ifAddrs.find(a => a.family === 'IPv6' && !a.internal);
        ip     = v4?.address ?? null;
        subnet = v4?.netmask ?? null;
        ipv6   = v6?.address?.split('%')[0] ?? null;
        break;
      }
    }
  }

  // --- Gateway + DNS via PowerShell (quick, structured) ---
  let gateway = null, dns = [];
  try {
    const psOut = execSync(
      'powershell.exe -NoProfile -Command "' +
        '$a=Get-NetIPConfiguration|Where-Object{$_.IPv4Address -ne $null}|Select-Object -First 1;' +
        '[PSCustomObject]@{gw=$a.IPv4DefaultGateway.NextHop;dns=($a.DNSServer.ServerAddresses -join \",\")}|' +
        'ConvertTo-Json -Compress"',
      { timeout: 5000, encoding: 'utf8', windowsHide: true }
    );
    const parsedPs = JSON.parse(psOut.trim());
    gateway = parsedPs.gw || null;
    dns = parsedPs.dns ? parsedPs.dns.split(',').filter(Boolean) : [];
  } catch { /* not critical */ }

  return { ...parsed, ip, ipv6, subnet, gateway, dns };
});

// ── WiFi: scan available networks (Windows only) ──────────────
guardedHandle('wifi:scan-networks', async () => {
  if (process.platform !== 'win32') return [];
  const { execSync } = require('child_process');
  try {
    const out = execSync(
      'netsh wlan show networks mode=Bssid',
      { timeout: 8000, encoding: 'utf8', windowsHide: true }
    );
    return parseNetshScanNetworks(out);
  } catch { return []; }
});

// ── WiFi: list saved profiles (Windows only) ──────────────────
guardedHandle('wifi:list-profiles', async () => {
  if (process.platform !== 'win32') return [];
  const { execSync } = require('child_process');
  try {
    const out = execSync('netsh wlan show profiles', { timeout: 3000, encoding: 'utf8', windowsHide: true });
    return parseNetshListProfiles(out);
  } catch { return []; }
});

// ── WiFi: connect to a saved profile (Windows only) ───────────
guardedHandle('wifi:connect', async (_event, { profile }) => {
  if (process.platform !== 'win32') return { ok: false, reason: 'unsupported_platform' };
  if (!profile || typeof profile !== 'string') return { ok: false, reason: 'invalid_profile' };
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  try {
    // execFile avoids shell interpolation — profile name passed as a direct argument
    await promisify(execFile)('netsh', ['wlan', 'connect', `name=${profile}`], { timeout: 6000, encoding: 'utf8', windowsHide: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

// ── WiFi: disconnect (Windows only) ──────────────────────────
guardedHandle('wifi:disconnect', async () => {
  if (process.platform !== 'win32') return { ok: false, reason: 'unsupported_platform' };
  const { execSync } = require('child_process');
  try {
    execSync('netsh wlan disconnect', { timeout: 4000, encoding: 'utf8', windowsHide: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

// ── System: set OS master volume ──────────────────────────────
guardedHandle('system:set-volume', async (_event, level) => {
  const clamped = Math.max(0, Math.min(100, Number(level) || 0));
  try {
    if (process.platform === 'win32') {
      // nircmd setsysvolume takes 0–65535
      const nircmdPath = path.join(
        process.resourcesPath || path.join(__dirname, 'vendor'),
        'nircmd.exe'
      );
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      await promisify(execFile)(nircmdPath, ['setsysvolume', String(Math.round(clamped / 100 * 65535))], { timeout: 2000 });
    } else if (process.platform === 'darwin') {
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      await promisify(execFile)('osascript', ['-e', `set volume output volume ${clamped}`], { timeout: 2000 });
    } else {
      return { ok: false, reason: 'unsupported_platform' };
    }
    return { ok: true };
  } catch (err) {
    console.error('[SYSTEM:SET-VOLUME]', err.message);
    return { ok: false, reason: err.message };
  }
});

// ── Device: set display brightness (Windows only — WMI) ───────
guardedHandle('device:set-brightness', async (_event, level) => {
  if (process.platform !== 'win32') return { ok: false, reason: 'unsupported_platform' };
  const clamped = Math.max(0, Math.min(100, Number(level) || 0));
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    await promisify(execFile)(
      'powershell.exe',
      ['-NoProfile', '-Command',
        `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(0, ${clamped})`],
      { timeout: 3000 }
    );
    return { ok: true };
  } catch (err) {
    console.error('[DEVICE:SET-BRIGHTNESS]', err.message);
    return { ok: false, reason: err.message };
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
        ...(shouldExposeDevToolsMenuItem(app.isPackaged) ? [
          {
            label: 'Toggle DevTools',
            accelerator: 'CmdOrCtrl+Shift+I',
            click: () => mainWindow?.webContents.toggleDevTools(),
          },
          { type: 'separator' },
        ] : []),
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
        label: 'Reload (F5)',
        click: () => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          rendererRecoveryTimestamps = [];
          const currentUrl = mainWindow.webContents.getURL();
          if (currentUrl.startsWith('data:')) {
            mainWindow.loadURL(REMOTE_SERVER_URL).catch(() => {});
          } else {
            mainWindow.webContents.reload();
          }
          mainWindow.show();
          console.log('[TRAY] Reload triggered from tray');
        },
      },
      {
        label: 'Hard Reload — Clear Cache (Ctrl+Shift+F5)',
        click: async () => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          rendererRecoveryTimestamps = [];
          try {
            await mainWindow.webContents.session.clearCache();
            await mainWindow.webContents.session.clearStorageData({
              storages: ['serviceworkers', 'cachestorage', 'appcache', 'filesystem'],
            });
          } catch (err) {
            console.warn('[TRAY] Hard reload cache clear failed:', err && err.message);
          }
          mainWindow.loadURL(REMOTE_SERVER_URL).catch(() => {});
          mainWindow.show();
          console.log('[TRAY] Hard reload triggered from tray');
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

  // On Windows (non-kiosk), register as a startup app so FlexOS launches on every boot.
  // This is set once and persists — the user can toggle it off via Settings > System.
  if (process.platform === 'win32' && !DEV_MODE) {
    const currentSettings = app.getLoginItemSettings();
    if (!currentSettings.openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: true });
      console.log('[APP] Registered RMPG Flex as a Windows startup app');
    }
  }
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
      const db = getLocalDb();
      if (db) {
        const { prunedRows } = pruneOldPinAttempts(db, 500);
        if (prunedRows > 0) {
          console.log(`[APP] Pruned ${prunedRows} stale pin_attempts row(s) on startup`);
        }

        // Clock-skew detection: defends against an attacker rolling the
        // system clock backward to replay an expired offline PIN session
        // window. If the wall clock and monotonic clock disagree by more
        // than the tolerance since the last check, invalidate every active
        // PIN session so the user must re-enter their PIN.
        const { skewDetected } = detectClockSkew(getConfig, setConfig, Date.now(), process.hrtime.bigint());
        if (skewDetected) {
          const { changes } = invalidateAllActivePinSessions(db);
          console.warn(`[APP] System clock skew detected — invalidated ${changes} active PIN session(s) on startup`);
        }

        // lockOnSystemSleep: invalidate every active offline PIN session on
        // system suspend/lock, the same DB update as the clock-skew response
        // above (shared via invalidateAllActivePinSessions). Both events are
        // physical-access risk windows — re-fetch getLocalDb() at fire time
        // (rather than closing over the `db` local here) since these
        // listeners can fire arbitrarily long after startup, well after this
        // try block has exited.
        //
        // 'suspend' fires on sleep/hibernate across macOS, Windows, and
        // Linux. 'lock-screen' is macOS/Windows only — Electron's own
        // powerMonitor docs list it under those two platforms and it is
        // simply never emitted on Linux, so registering the listener
        // unconditionally degrades gracefully there (matches this
        // program's established pattern of no-op-on-unsupported-platform
        // rather than an explicit platform guard).
        powerMonitor.on('suspend', () => {
          const liveDb = getLocalDb();
          if (!liveDb) return;
          const { changes } = invalidateAllActivePinSessions(liveDb);
          console.warn(`[APP] System suspend detected — invalidated ${changes} active PIN session(s)`);
        });
        powerMonitor.on('lock-screen', () => {
          const liveDb = getLocalDb();
          if (!liveDb) return;
          const { changes } = invalidateAllActivePinSessions(liveDb);
          console.warn(`[APP] System lock-screen detected — invalidated ${changes} active PIN session(s)`);
        });
      }
      try {
        const localDb = getLocalDb();
        if (localDb) {
          faceAuth = createFaceAuth({ db: localDb, safeStorage });
          console.log('[FACE-AUTH] Initialized');
        }
      } catch (err) {
        console.error('[FACE-AUTH] Failed to initialize:', err.message);
      }
    } catch (dbErr) {
      console.error('[APP] Local DB init failed — offline support disabled:', dbErr.message);
    }

    // Start connectivity check in parallel with window creation.
    // Old behaviour blocked on 5 × 2s retries before createMainWindow(),
    // leaving macOS users staring at the splash for up to 10s before
    // the window even began loading. Now the window starts immediately
    // and the connectivity result is used only to seed the monitor.
    // In kiosk shell mode, Windows starts this process before the network
    // stack is fully up — use more retries so the initial check doesn't
    // seed the monitor as "offline" just because the NIC wasn't ready yet.
    const isKioskContext = process.platform === 'win32' && (getConfig('kiosk_shell_enabled') === true || KIOSK_SHELL_ARGV);
    const connectivityPromise = checkServerConnectivity({ kioskShell: isKioskContext });

    // Kick off Windows account lookup in parallel with connectivity check.
    // Both must resolve (+ 3s minimum) before the lock screen shows.
    const accountInfoPromise = getWindowsAccountInfo();
    const minBootPromise = new Promise((resolve) => setTimeout(resolve, 3000));

    // After DB init, we know if this is a kiosk shell session.
    // Drive phase transitions only in kiosk shell mode.
    Promise.all([accountInfoPromise, minBootPromise]).then(([accountInfo]) => {
      const isKioskForSplash = process.platform === 'win32' && (getConfig('kiosk_shell_enabled') === true || KIOSK_SHELL_ARGV);
      if (isKioskForSplash && splashWindow && !splashWindow.isDestroyed()) {
        const phaseMsg = {
          phase: 'lock',
          data: accountInfo || { name: getConfig('last_flexos_username') || 'Officer', fullName: null, avatarDataUri: null },
        };
        if (splashLoaded) {
          splashWindow.webContents.send('splash:phase', phaseMsg);
        } else {
          // Page hasn't finished loading yet — queue for delivery in did-finish-load.
          splashPhasePending = phaseMsg;
        }
      }
    }).catch((err) => {
      console.warn('[SPLASH] Phase 1→2 transition error:', err && err.message);
    });

    // Lifted out of the `if (DEV_MODE)` block below (rather than left as a
    // block-scoped const inside it) so the Task 10 self-test further down
    // can reuse this exact result — see the self-test's own comment for
    // why it reuses rather than recomputes this.
    let auditResult = null;
    if (DEV_MODE) {
      const mainJsSource = fs.readFileSync(__filename, 'utf8');
      const updaterJsSource = fs.readFileSync(path.join(__dirname, 'updater.js'), 'utf8');
      auditResult = auditIpcHandlerRegistry(mainJsSource + '\n' + updaterJsSource);
      if (!auditResult.ok) {
        console.error('[SECURITY] Unguarded IPC handlers detected:', auditResult.violations);
      }
    }

    const secureDefaultsResult = assertSecureElectronDefaults(app);
    if (!secureDefaultsResult.ok) {
      console.error('[SECURITY] Insecure Electron command-line switches active:', secureDefaultsResult.violations);
      // Group J Task 9: console.error alone is invisible on a packaged
      // build (no attached terminal) — escalate into the Task 8 security
      // audit log specifically when this is happening in production, so
      // there's a durable, inspectable record of it.
      const escalation = evaluateInsecureElectronFlagsEscalation(secureDefaultsResult, app.isPackaged);
      if (escalation.shouldEscalate) {
        logSecurityAuditEvent(escalation.auditEvent.channel, escalation.auditEvent.outcome, escalation.auditEvent.detail);
      }
    }

    // Group J Task 10 (spec #50, selfTestHardeningOnStartup): the final
    // function of the entire 10-group hardening program — a read-only
    // aggregate rollup of this program's own startup checks via the pure
    // `runHardeningSelfTest` aggregator (childProcessGuard.js). Reuses
    // `auditResult`/`secureDefaultsResult` already computed above
    // (wrapped in zero-arg closures) instead of recomputing them — the
    // audit check in particular re-reads main.js/updater.js off disk, so
    // recomputing it here would double that I/O for no benefit.
    //
    // `auditIpcHandlerRegistry` is included ONLY when DEV_MODE is on,
    // mirroring its existing gate above: it's a static source-text audit
    // meant to catch a developer mistake (an `ipcMain.handle` registered
    // without a guard wrapper) before it ships, not a runtime condition
    // that varies between launches of a packaged build — running it
    // unconditionally in production would add a real (if small) disk-read
    // cost on every startup for a check whose signal is only actionable
    // to a developer with source access. When DEV_MODE is off,
    // `auditResult` is never computed (stays `null`), so this check is
    // simply omitted from the aggregate rather than synthesizing a fake
    // pass/fail for it.
    //
    // No safeStorage-migration-status check is included here: Group H's
    // secretsStore.js only exports `migrateOfflineSecretsToSafeStorage`,
    // which PERFORMS the migration (a write via `setConfig`) rather than
    // reporting on one already done — it is not a read-only status check.
    // Its internal `looksAlreadyMigrated(value, safeStorage)` helper,
    // which could serve as one, is not exported. Building a genuine
    // read-only "has this already run" check from here would mean either
    // re-running the migration as a side effect (explicitly out of scope
    // — this self-test is a diagnostic, not a repair action) or adding a
    // new export/state-tracking to secretsStore.js that doesn't exist
    // today (out of scope for this task). Skipped rather than forced;
    // flagged for the reviewer in the task report.
    const selfTestChecks = [
      { name: 'assertSecureElectronDefaults', fn: () => secureDefaultsResult },
      ...(DEV_MODE ? [{ name: 'auditIpcHandlerRegistry', fn: () => auditResult }] : []),
      {
        // Lightweight "this group's own module loaded correctly" sanity
        // check — confirms childProcessGuard.js's own key exports are
        // present and callable. Not a re-test of each function's
        // behavior (that's what the unit tests are for) — just a guard
        // against a bad require()/bundling regression silently handing
        // main.js an `undefined` where a function was expected.
        name: 'childProcessGuard-module-loaded',
        fn: () => {
          const exportsToCheck = {
            buildSandboxedChildEnv,
            scheduleChildProcessTimeout,
            isAtConcurrencyLimit,
            isAllowedBinaryName,
            isAllowedApiHost,
            parseIpLocateResponse,
            withRequestTimeout,
          };
          const missing = Object.keys(exportsToCheck).filter((key) => typeof exportsToCheck[key] !== 'function');
          return missing.length === 0 ? { ok: true } : { ok: false, violations: missing };
        },
      },
    ];

    try {
      const selfTestResult = runHardeningSelfTest(selfTestChecks);
      const passCount = selfTestResult.results.filter((r) => r.ok).length;
      const summaryLine = `[SECURITY] Startup hardening self-test: ${passCount}/${selfTestResult.results.length} checks passed`;
      if (selfTestResult.allPassed) {
        console.log(summaryLine);
      } else {
        console.error(summaryLine, selfTestResult.results.filter((r) => !r.ok));
        // Task 8's audit logger is a sensible fit here (rather than
        // inventing a second log file for this task) — the whole point
        // of that log is a durable, inspectable record of security-
        // relevant events a packaged build's missing terminal would
        // otherwise hide, and a failed startup hardening check is
        // squarely that. Fire-and-forget: logSecurityAuditEvent never
        // throws (see its own doc comment above), so this can't be the
        // thing that breaks the "never blocks launch" guarantee either.
        logSecurityAuditEvent('security:hardening-self-test', 'violation', { results: selfTestResult.results });
      }
    } catch (selfTestErr) {
      // Defense in depth beyond runHardeningSelfTest's own internal
      // per-check try/catch: this self-test must NEVER block app launch,
      // regardless of what goes wrong here — no process.exit, no thrown
      // error escaping the startup sequence (the spec's Error Handling
      // section, non-negotiable). Swallow and log only.
      console.error('[SECURITY] Startup hardening self-test failed to run:', selfTestErr && selfTestErr.message);
    }

    createMenu();
    await createMainWindow();
    createTray();

    // ─── Field reload hotkeys (global — survive kiosk/black-screen) ───
    // Registered as global shortcuts so they fire from the main process
    // regardless of renderer state (no menu needed, works on black screens).
    //
    // F5  — soft reload: reloads the current page (recovers random freezes).
    //        If the page is the offline data: URL, navigates back to the real
    //        server instead of re-rendering the dead-end offline screen.
    // Ctrl+Shift+F5 — hard reload: clears HTTP + SW caches then loads the
    //        real server URL. Recovers wedged service workers, stale deploys,
    //        and any state that a plain reload won't shake loose.
    //
    // Both shortcuts unregister themselves in the 'before-quit' handler via
    // globalShortcut.unregisterAll(), matching the kiosk escape hatch pattern.
    const f5Registered = globalShortcut.register('F5', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      rendererRecoveryTimestamps = [];
      const currentUrl = mainWindow.webContents.getURL();
      if (currentUrl.startsWith('data:')) {
        mainWindow.loadURL(REMOTE_SERVER_URL).catch((err) => {
          console.warn('[RELOAD] F5 loadURL failed:', err && err.message);
        });
      } else {
        mainWindow.webContents.reload();
      }
      console.log('[RELOAD] F5: soft reload');
    });
    console.log(`[RELOAD] F5 shortcut registered: ${f5Registered}`);

    // Ctrl+Shift+F5 — hard reload: clears all caches then navigates.
    // On Windows, this accelerator can conflict with OEM/driver software
    // (e.g. Intel Graphics hotkeys). Try the primary combo first; if it
    // fails, register Ctrl+Alt+F5 as a fallback that field users can
    // reach more reliably on Toughbooks.
    function doHardReload() {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      rendererRecoveryTimestamps = [];
      console.log('[RELOAD] Hard reload — clearing caches');
      (async () => {
        try {
          await mainWindow.webContents.session.clearCache();
          await mainWindow.webContents.session.clearStorageData({
            storages: ['serviceworkers', 'cachestorage', 'appcache', 'filesystem'],
          });
          await mainWindow.webContents.executeJavaScript(`
            if ('caches' in window) { caches.keys().then(keys => keys.forEach(k => caches.delete(k))); }
            if (navigator.serviceWorker) { navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister())); }
          `).catch(() => {});
        } catch (err) {
          console.warn('[RELOAD] Hard reload cache clear failed (continuing):', err && err.message);
        }
        mainWindow.loadURL(REMOTE_SERVER_URL).catch((err) => {
          console.warn('[RELOAD] Hard reload loadURL failed:', err && err.message);
        });
      })();
    }

    const hardReloadRegistered = globalShortcut.register('Ctrl+Shift+F5', doHardReload);
    console.log(`[RELOAD] Ctrl+Shift+F5 shortcut registered: ${hardReloadRegistered}`);
    if (!hardReloadRegistered) {
      const fallbackRegistered = globalShortcut.register('Ctrl+Alt+F5', doHardReload);
      console.log(`[RELOAD] Ctrl+Alt+F5 fallback registered: ${fallbackRegistered}`);
      if (!fallbackRegistered) {
        console.warn('[RELOAD] WARNING: Neither Ctrl+Shift+F5 nor Ctrl+Alt+F5 could be registered — hard reload unavailable');
      }
    }

    // ─── Kiosk-mode keyboard fallback (before-input-event) ─────
    // In kiosk mode (kiosk:true), the BrowserWindow captures ALL keyboard
    // input at the Chromium level before globalShortcut (the OS-level
    // shortcut handler) ever sees it. This means F5 and Ctrl+Shift+F5
    // registered via globalShortcut.register() never fire in kiosk mode.
    // Solution: also listen on webContents 'before-input-event', which
    // intercepts keyboard input at the Chromium level BEFORE it's consumed
    // by the kiosk window. This gives us the same key combos in kiosk mode
    // that globalShortcut provides in normal windowed mode.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;

        const ctrl = input.control;
        const shift = input.shift;
        const alt = input.alt;
        const key = input.key;

        // F5 — soft reload
        if (key === 'F5' && !ctrl && !shift && !alt) {
          event.preventDefault();
          if (!mainWindow || mainWindow.isDestroyed()) return;
          rendererRecoveryTimestamps = [];
          const currentUrl = mainWindow.webContents.getURL();
          if (currentUrl.startsWith('data:')) {
            mainWindow.loadURL(REMOTE_SERVER_URL).catch((err) => {
              console.warn('[RELOAD] (kiosk) F5 loadURL failed:', err && err.message);
            });
          } else {
            mainWindow.webContents.reload();
          }
          console.log('[RELOAD] (kiosk before-input-event) F5: soft reload');
          return;
        }

        // Ctrl+Shift+F5 or Ctrl+Alt+F5 — hard reload
        if (key === 'F5' && ctrl && (shift || alt)) {
          event.preventDefault();
          doHardReload();
          console.log('[RELOAD] (kiosk before-input-event) hard reload');
          return;
        }
      });
    }

    // Await connectivity (usually already resolved by now)
    const isReachable = await connectivityPromise;
    if (!isReachable) {
      console.warn('[APP] Server unreachable at startup');
    }

    // Initialize auto-updater
    console.log('[APP] Initializing auto-updater with:', REMOTE_SERVER_URL);
    appUpdater.init(REMOTE_SERVER_URL, guardedOn);

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
    // Guard against double-reload: the fast-reconnect callback fires on every
    // positive check (~10s), while the debounced callback fires ~30s later.
    // Both independently try to reload when on the offline page. Track the
    // last reload time so the debounced path skips if fast-reconnect already
    // handled it.
    let _lastConnectivityReload = 0;
    connectivityMonitor.start(mainWindow, (nowOnline) => {
      console.log(`[APP] Connectivity transition → ${nowOnline ? 'ONLINE' : 'OFFLINE'}`);
      if (nowOnline) {
        // Auto-reload when on the offline page — the officer shouldn't have
        // to manually tap "Retry" after cellular reconnects in the field.
        // (The fast-reconnect path below handles this sooner; this is the
        // fallback for any case where that didn't fire.)
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            const currentUrl = mainWindow.webContents.getURL();
            if (currentUrl.startsWith('data:') && Date.now() - _lastConnectivityReload > 5000) {
              _lastConnectivityReload = Date.now();
              console.log('[APP] Connectivity restored (debounced) while on offline page — reloading');
              mainWindow.loadURL(REMOTE_SERVER_URL).catch((err) => {
                console.warn('[APP] Auto-reload on reconnect failed:', err && err.message);
              });
            }
          }
        } catch { /* window may be closing */ }
        // Trigger push sync
        if (syncManager && syncManager.pushAll) {
          syncManager.pushAll().catch(err => {
            console.error('[APP] Push sync on reconnect failed:', err.message);
          });
        }
        // Detect WWAN failover
        const currentWwan = _lastWwanState;
        if (currentWwan?.connected) {
          mainWindow?.webContents.send('connectivity:failover', { from: 'wifi', to: 'wwan' });
        }
      }
    }, (isReachable) => {
      // ─── Fast reconnect: bypass debounce when on the offline page ─────
      // The debounce (stableCount=3, ~30s) protects against flapping while
      // the app is running normally. When the page is already dead (data: URL)
      // there is nothing to protect — any confirmed positive reachability check
      // should reload immediately, not after 30s.
      if (!isReachable) return;
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          const currentUrl = mainWindow.webContents.getURL();
          if (currentUrl.startsWith('data:') && Date.now() - _lastConnectivityReload > 5000) {
            _lastConnectivityReload = Date.now();
            console.log('[APP] Fast reconnect: reachable while on offline page — reloading immediately');
            mainWindow.loadURL(REMOTE_SERVER_URL).catch((err) => {
              console.warn('[APP] Fast reconnect loadURL failed:', err && err.message);
            });
          }
        }
      } catch { /* window may be closing */ }
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
  globalShortcut.unregisterAll();

  // Clean up WWAN push timer
  if (_wwanPushTimer) { clearInterval(_wwanPushTimer); _wwanPushTimer = null; }
  // Clean up offline modules
  if (connectivityMonitor) connectivityMonitor.stop();
  if (syncManager && syncManager.stopPullSchedule) syncManager.stopPullSchedule();
  if (pinManager && pinManager.destroy) pinManager.destroy();
  closeLocalDb();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Fix: on a real Windows kiosk, if all windows close while this instance
    // is running as the shell — and it isn't a deliberate, admin-initiated
    // revert-and-restart (Settings disable, or the Ctrl+Alt+Shift+F12 escape
    // hatch, both of which set kioskDeliberatelyReverting before touching the
    // registry) — relaunch instead of exiting. Otherwise the machine is left
    // with no shell running at all: a black screen, no taskbar, and the
    // escape hotkey unregistered (before-quit above unregisters all global
    // shortcuts), with no way back in. A normal Windows shell (explorer.exe)
    // is always expected to be present, so this app must behave the same way
    // while it's standing in for one.
    //
    // This can't loop forever into a broken boot: relaunching calls
    // createMainWindow() again exactly like any other launch, so the
    // self-revert boot-failure counter in createMainWindow (shouldSelfRevert/
    // MAX_BOOT_FAILURES) still increments and will flip kiosk_shell_enabled
    // off and fall back to explorer.exe after enough consecutive failures.
    if (shouldRelaunchOnAllWindowsClosed({
      isKioskShell: isRunningAsKioskShell,
      deliberatelyReverting: kioskDeliberatelyReverting,
    })) {
      isQuitting = true;
      app.relaunch();
      app.exit(0);
      return;
    }
    isQuitting = true;
    app.quit();
  }
});
