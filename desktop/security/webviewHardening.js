// ============================================================
// RMPG Flex — Webview Hardening
// Pure helpers used by main.js's Company Browser window to
// re-harden every guest <webview> attached inside it (via
// 'will-attach-webview') and to gate guest navigation to
// http(s) only. Kept dependency-free (no Electron import) so
// it can be unit-tested without booting Electron — same
// pattern as desktop/windowManager.js and
// desktop/security/sessionHardening.js's pure functions.
// ============================================================

'use strict';

/**
 * Forces every attached <webview> guest's webPreferences to the same
 * security floor as the rest of this app, regardless of what the hosting
 * page (CompanyBrowserPage.tsx) requested via the <webview> tag's own
 * attributes. A guest page has no legitimate reason to run with Node
 * integration, a disabled context isolation boundary, plugins, or a
 * preload script — all of which this app's main window already forbids
 * via hardenWebPreferencesDefaults(). Non-security fields (e.g.
 * `partition`, used to give each tab its own session/cookie jar) pass
 * through untouched.
 */
function hardenGuestWebPreferences(webPreferences) {
  const prefs = webPreferences || {};
  return {
    ...prefs,
    nodeIntegration: false,
    contextIsolation: true,
    plugins: false,
    preload: undefined,
  };
}

/**
 * Gate for guest <webview> navigation (both the initial load and any
 * later navigation within it). Only http(s) is ever allowed — a guest
 * page has no legitimate reason to navigate to file:, chrome:,
 * javascript:, or any other scheme from inside this sandboxed browser
 * tab. Mirrors shouldAllowNavigation's http(s)-only scheme check in
 * security/sessionHardening.js, but WITHOUT that function's same-host
 * restriction — the whole point of this feature is browsing to
 * arbitrary external hosts.
 */
function shouldAllowGuestNavigation(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

module.exports = {
  hardenGuestWebPreferences,
  shouldAllowGuestNavigation,
};
