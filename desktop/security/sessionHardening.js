// ============================================================
// RMPG Flex — Session Hardening
// Electron process/session-level hardening: CSP, permission
// scoping, navigation guard, hardened webPreferences defaults,
// window-open restriction, TLS pinned-host audit, auto-updater
// transport lock, production DevTools restriction, preload-path
// restriction. (No separate remote-module lockdown here — the
// `remote` module was removed from Electron core in v14; this
// shell is on v40 with no `@electron/remote` dependency, so
// there is nothing to disable.)
// ============================================================

'use strict';

const path = require('path');

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

/**
 * The auto-updater downloads and silently installs whatever it finds at
 * this URL (electron-updater's 'generic' provider). It must always be
 * https — this is a startup assertion against that URL ever regressing
 * to plain http, not a runtime network check.
 */
function isSecureUpdateFeedUrl(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function shouldAuditCertificateVerification(hostname, pinnedHosts) {
  return pinnedHosts.includes(hostname);
}

/**
 * Returns an Electron ses.setCertificateVerifyProc-compatible function.
 * Per this plan's Global Constraints (no real SPKI pin value available
 * yet), this NEVER overrides Chromium's own trust decision — callback(-3)
 * unconditionally means "use Chromium's own verification result" per
 * Electron's session docs. Its only job is visibility: for the hosts we
 * actually care about, log when Chromium's verification did NOT come
 * back clean, so an anomaly (e.g. an unexpected corporate TLS proxy) is
 * observable instead of silently accepted-or-rejected with no trace.
 */
function createCertificateVerifyProc(pinnedHosts, logFn) {
  return function verifyProc(request, callback) {
    const { hostname, verificationResult } = request;
    if (shouldAuditCertificateVerification(hostname, pinnedHosts) && verificationResult !== 'net::OK') {
      logFn(`[SECURITY] TLS verification for pinned host "${hostname}" did not return net::OK: ${verificationResult}`);
    }
    callback(-3);
  };
}

/**
 * The main window is the only BrowserWindow with a preload script today,
 * and it must always be exactly desktop/preload.js. A future BrowserWindow
 * (e.g. a Group E secondary window) that wants a preload script should
 * call this with its own requested path and the same fixed allowed path,
 * so a typo or a renderer-influenced path can never load an unintended
 * script with Node access.
 */
function resolveTrustedPreloadPath(requestedPath, allowedPath) {
  const resolvedRequested = path.resolve(requestedPath);
  const resolvedAllowed = path.resolve(allowedPath);
  if (resolvedRequested !== resolvedAllowed) {
    throw new Error(`untrusted preload path: "${resolvedRequested}" !== "${resolvedAllowed}"`);
  }
  return resolvedAllowed;
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
  isSecureUpdateFeedUrl,
  shouldAuditCertificateVerification,
  createCertificateVerifyProc,
  resolveTrustedPreloadPath,
};
