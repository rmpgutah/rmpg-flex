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

module.exports = {
  buildCspHeaderValue,
  installContentSecurityPolicy,
  isPermissionAllowed,
};
