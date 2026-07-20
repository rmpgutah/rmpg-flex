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

/**
 * Coerces a renderer-supplied badge count (from 'notify:dock-badge') into a
 * safe, bounded non-negative integer suitable for app.setBadgeCount().
 *
 * - `Number(count) || 0` turns non-numeric input into 0: `Number('abc')` is
 *   `NaN` and `NaN || 0` is `0`. `Number(null)` is `0` already (not NaN), so
 *   it passes through the same fallback to `0` either way. `Number(undefined)`
 *   is `NaN`, also falling back to `0`.
 * - `Math.floor(...)` truncates floats down (e.g. 3.7 -> 3).
 * - `Math.max(0, ...)` clamps negative numbers up to 0.
 * - `Math.min(..., 9999)` caps the upper bound at 9999 — a dock/taskbar
 *   badge is a glanceable count, not a precise metric; 9999 is a generous
 *   ceiling that avoids unbounded/absurd values (e.g. a runaway counter)
 *   while still comfortably covering any realistic queue/alert count.
 */
function coerceBadgeCount(count) {
  return Math.min(Math.max(0, Math.floor(Number(count) || 0)), 9999);
}

module.exports = { buildSecondaryWindowUrl, coerceBadgeCount };
