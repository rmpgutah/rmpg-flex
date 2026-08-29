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
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.mapbox.com https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://*.mapbox.com https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://*.mapbox.com https://*.rmpgutah.us",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://*.rmpgutah.us https://api.rmpgutah.us wss://api.rmpgutah.us wss://*.rmpgutah.us https://*.mapbox.com https://events.mapbox.com https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    // DialerPanel embeds Dial Connect. Stamping frame-src 'self' onto every
    // response (including that iframe) made Chromium log report-only violations
    // for https://dialer.rmpgutah.us/dialer-embed on every Dispatch load.
    "frame-src 'self' https://dialer.rmpgutah.us",
  ];
  return directives.join('; ') + ';';
}

/**
 * The desktop CSP-Report-Only header is for the CAD document only.
 * Applying it to every subresource — especially the cross-origin Dial
 * Connect iframe — intersects with Cloudflare Observatory's starter
 * report-only policy (script-src without 'self', connect-src 'none') and
 * floods the console with violations for /_next chunks, the Insights
 * beacon, and cdn-cgi/challenge-platform scripts. Those documents already
 * ship their own CSP (frame-ancestors on dialer.rmpgutah.us).
 */
function shouldAttachDesktopCspReportOnly(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return (
    host === 'rmpgutah.us' ||
    host === 'www.rmpgutah.us' ||
    host.endsWith('.rmpg-flex.pages.dev') ||
    host === 'localhost' ||
    host === '127.0.0.1'
  );
}

/**
 * Applies buildCspHeaderValue() as a Report-Only header on CAD navigations.
 * Report-Only never blocks a request — it only makes the renderer log
 * violations to its console. Cross-origin frames (Dial Connect) are left
 * with whatever headers their own origin sent.
 */
function installContentSecurityPolicy(session) {
  session.webRequest.onHeadersReceived((details, callback) => {
    if (!shouldAttachDesktopCspReportOnly(details.url)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
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
const DIALER_HOST = 'dialer.rmpgutah.us';

function isPermissionAllowed(requestingHost, expectedHost, permission) {
  if (!ALLOWED_PERMISSIONS.has(permission)) return false;
  if (requestingHost === expectedHost) return true;
  // Twilio Voice runs in DialerPanel's https://dialer.rmpgutah.us iframe.
  return requestingHost === DIALER_HOST && permission === 'media';
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
  const host = parsed.hostname.toLowerCase();
  const expected = String(expectedHost || '').toLowerCase();
  if (host === expected || host === `www.${expected}` || `www.${host}` === expected) {
    return { action: 'allow' };
  }
  // Dial Connect is the inbound phone. Opening it as {action:'external'}
  // (shell.openExternal) spawned a new OS-browser tab on every click and
  // denied the WindowProxy — multiple Twilio Clients, none tied to CAD.
  if (host === DIALER_HOST) return { action: 'allow' };
  return { action: 'external' };
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
  // Added during Group J Task 9's audit of Group F's original 4-item list
  // against the wider set of security-relevant Chromium/Electron
  // command-line switches — the original list only covered flags that
  // directly disable web-platform security (CORS/file-access/mixed-
  // content/TLS-verification); it missed switches that widen the app's
  // OS-level or debug-protocol attack surface instead:
  //   - remote-debugging-port / remote-debugging-address: opens Chromium's
  //     DevTools Protocol on a TCP port with NO authentication — anything
  //     that can reach that port (a co-resident process, or another host
  //     if `-address` is also widened past loopback) gets full control of
  //     the renderer, including arbitrary JS execution and reading
  //     whatever the officer-facing window has loaded. Legitimate only for
  //     a deliberate local debugging session, never in a shipped build.
  'remote-debugging-port',
  'remote-debugging-address',
  // - no-sandbox: disables Chromium's OS-level renderer sandbox entirely,
  //   so a renderer-process compromise (e.g. via a malicious page reached
  //   through shouldAllowNewWindow's 'external'/same-host paths, or a
  //   future XSS) has direct, unsandboxed access to the host OS instead
  //   of being contained. Sometimes passed for containerized/CI
  //   environments that lack sandbox support, but must never reach a
  //   real officer's machine.
  'no-sandbox',
  // - allow-insecure-localhost: tells Chromium to treat localhost TLS
  //   errors as trusted, which defeats certificate validation for any
  //   request this shell makes to a loopback address — a mechanism a
  //   locally-running malicious process could exploit to MITM what looks
  //   like a trusted local endpoint.
  'allow-insecure-localhost',
  // - disable-site-isolation-trials: turns off Site Isolation, the
  //   Chromium mitigation that puts different origins in separate OS
  //   processes specifically to contain Spectre-class cross-origin data
  //   leaks and make a renderer compromise harder to escalate across
  //   origins.
  'disable-site-isolation-trials',
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
  shouldAttachDesktopCspReportOnly,
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
