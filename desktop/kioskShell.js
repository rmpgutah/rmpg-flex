// ============================================================
// RMPG Flex — Kiosk Shell Mode pure helpers
// No Electron dependency — unit-testable in isolation, matching
// the windowManager.js / deviceInfo.js / fileOps.js convention.
// ============================================================

'use strict';

/**
 * Builds the string value written to the Winlogon\Shell registry key.
 * Windows resolves an unquoted path with spaces incorrectly (it tries each
 * space-delimited prefix as a separate executable), so the value is always
 * wrapped in double quotes.
 */
function buildShellRegistryValue(exePath) {
  if (typeof exePath !== 'string' || exePath.length === 0) {
    throw new Error('exePath must be a non-empty string');
  }
  return `"${exePath}"`;
}

/**
 * How many consecutive failed kiosk-mode boots are tolerated before the next
 * boot self-reverts the shell registry key back to explorer.exe rather than
 * trying again. This is the primary guard against bricking a machine with a
 * black screen and no shell.
 */
const MAX_BOOT_FAILURES = 3;

/**
 * Returns a fresh boot-attempt state, used the first time kiosk mode is
 * enabled (before any boot has been attempted).
 */
function resetBootAttemptState() {
  return { count: 0 };
}

/**
 * Increments the boot-attempt counter. Treats any missing/malformed prior
 * state as a fresh start (count 0) rather than throwing — a corrupted or
 * absent config value must never crash startup in kiosk mode, since that
 * would itself become the very failure loop this counter exists to catch.
 */
function nextBootAttemptState(prevState) {
  const prevCount = prevState && typeof prevState.count === 'number' ? prevState.count : 0;
  return { count: prevCount + 1 };
}

/**
 * True once the boot-attempt count has exceeded MAX_BOOT_FAILURES. Checked
 * BEFORE attempting to load the app on each kiosk-mode boot — see main.js's
 * startup sequence in Task 3.
 */
function shouldSelfRevert(state) {
  const count = state && typeof state.count === 'number' ? state.count : 0;
  return count > MAX_BOOT_FAILURES;
}

/**
 * Accelerators tried, in order, for the kiosk escape hatch. More than one
 * because `globalShortcut.register` returns false when another process
 * already owns the combination — and in kiosk mode that shortcut is the
 * ONLY way an operator reaches the escape window, so a single unavailable
 * accelerator must not be able to strand the machine.
 */
const KIOSK_ESCAPE_ACCELERATORS = [
  'Ctrl+Alt+Shift+F12',
  'Ctrl+Alt+Shift+F11',
  'Ctrl+Alt+Shift+K',
];

/**
 * Returns the first accelerator that tryRegister accepts, or null if every
 * candidate was rejected. tryRegister is injected (Electron's
 * globalShortcut.register in main.js) so this stays unit-testable.
 *
 * Electron's register() reports failure two different ways — a false return
 * for an already-taken combination, and a throw for a malformed accelerator
 * string — so both are treated as "this one didn't work, try the next".
 */
function selectEscapeAccelerator(accelerators, tryRegister) {
  for (const accelerator of accelerators) {
    let registered = false;
    try {
      registered = tryRegister(accelerator) === true;
    } catch {
      registered = false;
    }
    if (registered) return accelerator;
  }
  return null;
}

/**
 * Whether this launch should paint kiosk chrome (frameless, fullscreen, no
 * menu). Deliberately a DIFFERENT question from
 * shouldRelaunchOnAllWindowsClosed below — conflating the two is what makes
 * a kiosk machine brickable, so they are kept as two named predicates:
 *
 *  - revertSucceeded: a self-revert completed this boot, so Windows will use
 *    explorer.exe from now on. No reason to keep the operator frameless.
 *    If the revert was ATTEMPTED AND FAILED this stays false, because the
 *    registry still points here and the escape hotkey must stay live.
 *  - escapeAcceleratorRegistered: never enter a mode the operator cannot
 *    leave. If every candidate accelerator was taken, fall back to a normal
 *    window — the app is still the Windows shell, so
 *    shouldRelaunchOnAllWindowsClosed independently stays true and the
 *    machine still never ends up with no shell at all.
 */
function shouldUseKioskChrome({ isKioskShell, revertSucceeded, escapeAcceleratorRegistered }) {
  return Boolean(isKioskShell) && !revertSucceeded && Boolean(escapeAcceleratorRegistered);
}

/**
 * Whether 'window-all-closed' must relaunch the app instead of exiting.
 *
 * The governing question is "did Windows start this process as the login
 * shell", NOT "are we painting kiosk chrome". If we exit while the Winlogon
 * shell key points at this app, the session is left with no shell at all:
 * black screen, no taskbar, global shortcuts already torn down by
 * before-quit. That is unrecoverable without Safe Mode.
 *
 * This stays true even after a SUCCESSFUL self-revert, which is intentional:
 * the registry edit only takes effect at the next sign-in, so exiting before
 * that reboot would still strand the current session. The single exception is
 * deliberatelyReverting — an admin-initiated disable that is about to
 * relaunch or restart on purpose.
 */
function shouldRelaunchOnAllWindowsClosed({ isKioskShell, deliberatelyReverting }) {
  return Boolean(isKioskShell) && !deliberatelyReverting;
}

/**
 * Validates the escape hatch's live /api/auth/login response body before
 * main.js acts on it. Returns { ok: true, role } only for a successful,
 * non-2FA login by an admin or manager. Every other shape — network error,
 * malformed JSON, wrong credentials, a non-admin role, or an account that
 * requires 2FA (which this main-process-only flow cannot complete — see
 * Global Constraints) — returns { ok: false, error } with a caller-facing
 * reason, never throws.
 */
function validateEscapeLoginResponse(rawJson) {
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, error: 'invalid response from server' };
  }
  if (parsed && parsed.requires2FA) {
    return { ok: false, error: 'This account requires 2FA, which the kiosk escape hatch cannot complete. Use the in-app "Disable Kiosk Mode" button once logged in, or contact IT for a registry-level revert.' };
  }
  if (parsed && typeof parsed.error === 'string') {
    return { ok: false, error: parsed.error };
  }
  if (!parsed || typeof parsed.token !== 'string' || !parsed.token) {
    return { ok: false, error: 'invalid response from server' };
  }
  const role = parsed.user && parsed.user.role;
  if (role !== 'admin' && role !== 'manager') {
    return { ok: false, error: 'This account is not an admin or manager' };
  }
  return { ok: true, role };
}

module.exports = {
  buildShellRegistryValue,
  MAX_BOOT_FAILURES,
  resetBootAttemptState,
  nextBootAttemptState,
  shouldSelfRevert,
  KIOSK_ESCAPE_ACCELERATORS,
  selectEscapeAccelerator,
  shouldUseKioskChrome,
  shouldRelaunchOnAllWindowsClosed,
  validateEscapeLoginResponse,
};
