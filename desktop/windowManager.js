// ============================================================
// RMPG Flex — Secondary Window URL Builder
// Pure helper (no Electron dependency) used by main.js's
// 'window:open-secondary' IPC handler. Kept in its own module —
// like fileOps.js/systemInfo.js/deviceInfo.js — so it can be
// unit-tested without booting Electron.
// ============================================================

'use strict';

/**
 * Builds the URL a secondary BrowserWindow should load, from the SAME
 * trusted base URL the main window loads (REMOTE_SERVER_URL in main.js)
 * plus a renderer-supplied in-app route.
 *
 * routePath MUST be a same-origin, in-app route — never a renderer-supplied
 * absolute/external/protocol URL. A compromised or buggy renderer must not
 * be able to make a new BrowserWindow navigate off the trusted host (e.g.
 * 'javascript:', 'file:', 'http://evil.example.com', or a protocol-relative
 * '//attacker.example.com', which has no scheme of its own but is resolved
 * by the browser against the CURRENT page's scheme — i.e. an off-host
 * navigation hijack).
 *
 * Validation (routePath must):
 *   - be a non-empty string
 *   - start with '/'
 *   - NOT start with '//' (protocol-relative — rejected even though it
 *     technically "starts with /", checked before the generic ':' scan
 *     since a bare '//host' contains no ':' at all)
 *   - NOT contain ':' anywhere (catches 'http:', 'https:', 'javascript:',
 *     'file:', and any other scheme-prefixed value)
 *
 * Returns the built URL string `${baseUrl}${routePath}` on success.
 * Returns { ok: false, error } on validation failure — this project's
 * dominant convention for pure validators (see validatePinInput,
 * validateUserIdInput, validateFilePathInput, validateGlobalShortcutAccelerator,
 * sanitizeReconToolArgs, etc. in desktop/security/ipcGuard.js), chosen over
 * throwing so the IPC handler can return a structured { ok:false, error }
 * response to the renderer without a try/catch.
 */
function buildSecondaryWindowUrl(baseUrl, routePath) {
  if (typeof routePath !== 'string' || routePath.length === 0) {
    return { ok: false, error: 'routePath must be a non-empty string' };
  }
  if (!routePath.startsWith('/')) {
    return { ok: false, error: 'routePath must start with "/"' };
  }
  if (routePath.startsWith('//')) {
    return { ok: false, error: 'routePath must not be protocol-relative (starts with "//")' };
  }
  if (routePath.includes(':')) {
    return { ok: false, error: 'routePath must not contain ":"' };
  }
  return `${baseUrl}${routePath}`;
}

module.exports = { buildSecondaryWindowUrl };
