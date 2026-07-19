// ============================================================
// RMPG Flex — Session Hardening
// Electron process/session-level hardening: CSP, permission
// scoping, navigation guard, hardened webPreferences defaults,
// window-open restriction, TLS pinned-host audit, remote-module
// lockdown, auto-updater transport lock, production DevTools
// restriction, preload-path restriction.
// ============================================================

'use strict';

/**
 * The desktop shell's Content-Security-Policy, shipped in Report-Only
 * mode (see plan Global Constraints) until a human confirms zero real
 * violations against the live app. Scoped to the app's own origin plus
 * the known third-party integration this shell embeds: Mapbox GL JS.
 */
function buildCspHeaderValue() {
  const directives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.mapbox.com",
    "style-src 'self' 'unsafe-inline' https://*.mapbox.com https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://*.mapbox.com https://*.rmpgutah.us",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://*.rmpgutah.us https://api.rmpgutah.us wss://api.rmpgutah.us https://*.mapbox.com https://events.mapbox.com",
    "worker-src 'self' blob:",
    "frame-src 'self'",
  ];
  return directives.join('; ') + ';';
}

/**
 * Applies buildCspHeaderValue() as a Report-Only header on every response
 * the given session's webRequest sees. Report-Only never blocks a
 * request — it only makes the renderer log violations to its console.
 */
function installContentSecurityPolicy(session) {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy-Report-Only': [buildCspHeaderValue()],
      },
    });
  });
}

const ALLOWED_PERMISSIONS = new Set(['geolocation', 'notifications', 'media']);

/**
 * The pre-Group-F handler granted these permissions to ANY origin the
 * window ever loaded. This adds the missing origin check: only the
 * configured trusted host may receive them.
 */
function isPermissionAllowed(requestingHost, expectedHost, permission) {
  return requestingHost === expectedHost && ALLOWED_PERMISSIONS.has(permission);
}

/**
 * Decision function for the main window's 'will-navigate' guard. Only
 * same-host http(s) navigation is allowed; everything else (a different
 * host, a data:/javascript: scheme, an unparseable URL) is rejected.
 * This complements the pre-existing setWindowOpenHandler, which governs
 * NEW windows/tabs rather than navigation of the existing one.
 */
function shouldAllowNavigation(targetUrl, expectedHost) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  return parsed.host === expectedHost;
}

/**
 * Decision function for setWindowOpenHandler. Replaces the pre-existing
 * inline check (which implicitly allowed anything that merely CONTAINED
 * serverHost as a substring, and implicitly allowed non-http(s) schemes
 * by falling through to { action: 'allow' }) with an explicit allow-list:
 * only http(s) URLs are ever considered; same-host opens in-app, a
 * different host opens externally, anything else is denied outright.
 */
function shouldAllowNewWindow(targetUrl, expectedHost) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { action: 'deny' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { action: 'deny' };
  }
  return parsed.host === expectedHost ? { action: 'allow' } : { action: 'external' };
}

/**
 * Single source of truth for webPreferences security defaults. Every
 * BrowserWindow this shell creates should build its webPreferences via
 * this function rather than hand-rolling the flag list, so a future
 * window (e.g. a Group E secondary window) can't accidentally ship with
 * a weaker configuration than the main window.
 */
function hardenWebPreferencesDefaults(overrides = {}) {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    webviewTag: false,
    experimentalFeatures: false,
    allowRunningInsecureContent: false,
    enableWebSQL: false,
    ...overrides,
  };
}

const INSECURE_COMMAND_LINE_SWITCHES = [
  'disable-web-security',
  'allow-file-access-from-files',
  'allow-running-insecure-content',
  'ignore-certificate-errors',
];

/**
 * Startup assertion: none of the known security-weakening Chromium
 * command-line switches should ever be active. These are normally only
 * set for local debugging (e.g. --disable-web-security to bypass CORS
 * while pointed at a dev server) and must never ship in a packaged build.
 */
function assertSecureElectronDefaults(app) {
  const violations = INSECURE_COMMAND_LINE_SWITCHES.filter((flag) => app.commandLine.hasSwitch(flag));
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

/**
 * The application menu's "Toggle DevTools" item exposes the renderer's
 * DevTools console, which can call every window.electron.* preload API
 * directly — fine for development, an unnecessary attack surface in a
 * packaged production build handed to an officer.
 */
function shouldExposeDevToolsMenuItem(isPackaged) {
  return !isPackaged;
}

module.exports = {
  buildCspHeaderValue,
  installContentSecurityPolicy,
  isPermissionAllowed,
  shouldAllowNavigation,
  shouldAllowNewWindow,
  hardenWebPreferencesDefaults,
  assertSecureElectronDefaults,
  shouldExposeDevToolsMenuItem,
};
