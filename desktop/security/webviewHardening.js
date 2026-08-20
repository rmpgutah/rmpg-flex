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

// The app's own new-tab placeholder (see CompanyBrowserPage.tsx's
// NEW_TAB_URL). Every brand-new tab's <webview> starts on this literal
// value before the user has typed anything, so it has to be let through
// on the initial attach — but this is NOT a blanket allowance for the
// `about:` scheme (about:config, about:preferences, etc. must still be
// denied). Only this exact literal string is special-cased.
const NEW_TAB_SENTINEL_URL = 'about:blank';

/**
 * Gate for guest <webview> navigation (both the initial load and any
 * later navigation within it). Only http(s) is ever allowed — a guest
 * page has no legitimate reason to navigate to file:, chrome:,
 * javascript:, or any other scheme from inside this sandboxed browser
 * tab. Mirrors shouldAllowNavigation's http(s)-only scheme check in
 * security/sessionHardening.js, but WITHOUT that function's same-host
 * restriction — the whole point of this feature is browsing to
 * arbitrary external hosts. The single exception is the app's own
 * `about:blank` new-tab sentinel (see NEW_TAB_SENTINEL_URL above) —
 * without this, will-attach-webview's preventDefault() on every brand
 * new tab destroys the guest before the user ever gets to navigate it.
 */
function shouldAllowGuestNavigation(targetUrl) {
  if (targetUrl === NEW_TAB_SENTINEL_URL) return true;
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

/**
 * Gate for the 'window:open-company-browser' IPC handler: rejects
 * client_viewer/contract_manager roles even if the IPC channel is invoked
 * directly (e.g. via DevTools console), not just through the UI's own
 * nav-catalog filtering (which only hides the launcher icon and can be
 * bypassed by a renderer script calling window.electron.openCompanyBrowser()
 * directly). role is renderer-supplied and NOT cryptographically verified —
 * this is the same trust tier this app's client-side role guards (e.g.
 * client/src/App.tsx's AdminRoute/DispatchRoleGuard/CompanyBrowserRoleGuard)
 * already use, not a new, weaker one. A determined, already-authenticated
 * insider with DevTools access could still forge a different role string in
 * the IPC call; closing that fully would require a server-verified session
 * in the Electron main process, which this app doesn't have today and is
 * out of scope here.
 */
function isCompanyBrowserRoleAllowed(role) {
  return role !== 'client_viewer' && role !== 'contract_manager';
}

module.exports = {
  hardenGuestWebPreferences,
  shouldAllowGuestNavigation,
  NEW_TAB_SENTINEL_URL,
  isCompanyBrowserRoleAllowed,
};
