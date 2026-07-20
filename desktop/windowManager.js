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

/**
 * The complete set of valid tray-status states accepted by the
 * 'notify:tray-status' IPC channel. A genuine enum check — anything that
 * isn't an exact string match (wrong case, extra whitespace, a near-match
 * like 'onshift', or a non-string) is rejected.
 */
const VALID_TRAY_STATUSES = ['on-shift', 'off-shift', 'alert'];

/**
 * Returns true only for the exact strings 'on-shift', 'off-shift', 'alert'.
 */
function isValidTrayStatus(state) {
  return VALID_TRAY_STATUSES.includes(state);
}

/**
 * Maps a valid tray status to its human-readable tooltip text for
 * tray.setToolTip(...). The caller (main.js's 'notify:tray-status' handler)
 * always validates via isValidTrayStatus() first, so an invalid state here
 * should be unreachable in practice — but rather than throw (redundant
 * defensive-programming noise given the caller's gate) or return a blank
 * string (which would silently produce an empty tooltip), fall back to the
 * bare app name so a maintainer calling this directly never sees undefined
 * or blank output.
 */
function formatTrayTooltip(state) {
  switch (state) {
    case 'on-shift':
      return 'RMPG Flex — On Shift';
    case 'off-shift':
      return 'RMPG Flex — Off Shift';
    case 'alert':
      return 'RMPG Flex — ALERT';
    default:
      return 'RMPG Flex';
  }
}

/**
 * Standard 2D axis-aligned-bounding-box intersection test: does the window's
 * saved rectangle overlap AT LEAST ONE currently-connected display's
 * rectangle? Used by restoreWindowBounds() to reject a saved position that
 * lived entirely on a monitor that's no longer plugged in (e.g. a laptop
 * undocked from a second external display) — without this check the window
 * would restore fully off-screen with no way for the user to drag it back.
 *
 * ANY overlap counts as "recoverable", including a sliver at the edge — as
 * long as some part of the titlebar/window is reachable on a live display,
 * the user can drag the rest back into view. This is intentionally lenient
 * (vs. e.g. requiring the full window or its titlebar to be on-screen).
 *
 * displays is an array shaped like Electron's screen.getAllDisplays() result
 * (each entry has a `.bounds` rectangle `{x, y, width, height}`) — fake test
 * displays only need to match that shape, not be real Display instances.
 *
 * Never throws: an empty displays array, or malformed/missing bounds fields
 * (non-finite x/y/width/height), simply return false rather than blowing up
 * — this runs during window creation and a thrown error here must not be
 * able to prevent the app from starting.
 */
function boundsIntersectSomeDisplay(bounds, displays) {
  if (!bounds || typeof bounds !== 'object') return false;
  const { x, y, width, height } = bounds;
  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return false;
  }
  if (!Array.isArray(displays)) return false;

  return displays.some((display) => {
    const db = display && display.bounds;
    if (!db || typeof db !== 'object') return false;
    const { x: dx, y: dy, width: dw, height: dh } = db;
    if (![dx, dy, dw, dh].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return false;
    }
    return x < dx + dw && x + width > dx && y < dy + dh && y + height > dy;
  });
}

/**
 * Persists the main window's current bounds (position + size) to the local
 * config store so they can be restored on the next launch. Main-internal
 * only — per spec, there is no IPC channel exposing this to the renderer;
 * it's called exclusively from main.js's own window-lifecycle code (the
 * debounced resize/move listeners and the close-to-tray handler).
 *
 * Takes the live BrowserWindow and a setConfig-shaped function as PARAMETERS
 * (rather than importing them directly) purely for DI-testability — a fake
 * `{ getBounds: () => ({...}) }` object and a spy function are enough to
 * exercise this without booting Electron or the real local DB. It's placed
 * here alongside the other window-related helpers (rather than inline in
 * main.js) for the same reason the rest of this file exists: keep anything
 * that can be unit-tested without Electron out of main.js's IPC-wiring bulk.
 *
 * Skips the save entirely when the window is currently maximized or
 * fullscreen. win.getBounds() returns the MAXIMIZED (or fullscreen) rectangle
 * in those states, not the window's "normal" restored size/position — saving
 * that value would clobber the last-known normal bounds with a
 * screen-filling rectangle. On the next launch, restoreWindowBounds() would
 * hand that rectangle to createMainWindow(), which spreads it into a NORMAL
 * (non-maximized) BrowserWindow constructor call, producing a "fake
 * maximized" floating window with no real maximize chrome — a real,
 * recurring UX regression given the debounced 'resize' listener fires on the
 * maximize transition itself, and the 'close' handler saves whatever state
 * is current when the app is hidden to the tray. Simply not saving while
 * maximized/fullscreen leaves the previously-saved normal bounds intact and
 * correct; deliberately simpler than round-tripping a separate
 * "was maximized" flag that would also need to be replayed via
 * win.maximize() on restore.
 */
function saveWindowBounds(win, setConfigFn) {
  if (win.isMaximized() || win.isFullScreen()) return;
  setConfigFn('main_window_bounds', JSON.stringify(win.getBounds()));
}

/**
 * Reads the main window's last-saved bounds from the local config store and
 * returns them only if they're still usable — i.e. they overlap at least one
 * currently-connected display (see boundsIntersectSomeDisplay above). Returns
 * `null` (meaning "fall back to the hardcoded default size/position") when:
 *   - nothing has been saved yet (getConfigFn returns a falsy value)
 *   - the stored value isn't valid JSON (corrupt config row)
 *   - the parsed bounds don't intersect any current display (e.g. saved from
 *     a second monitor that's now disconnected)
 *
 * Never throws — this runs synchronously at the top of createMainWindow(),
 * before the BrowserWindow even exists, so a thrown error here must not be
 * able to prevent the app from starting.
 *
 * Takes getConfig and something shaped like screen.getAllDisplays as
 * PARAMETERS for the same DI-testability reason as saveWindowBounds — fake
 * functions returning canned JSON / a fake display list exercise the full
 * read -> parse -> validate path without Electron or the real local DB.
 * Main-internal only — no IPC channel (see saveWindowBounds doc above).
 */
function restoreWindowBounds(getConfigFn, getAllDisplaysFn) {
  const raw = getConfigFn('main_window_bounds');
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const displays = getAllDisplaysFn();
  if (!boundsIntersectSomeDisplay(parsed, displays)) return null;

  return parsed;
}

module.exports = {
  buildSecondaryWindowUrl,
  coerceBadgeCount,
  isValidTrayStatus,
  formatTrayTooltip,
  boundsIntersectSomeDisplay,
  saveWindowBounds,
  restoreWindowBounds,
};
