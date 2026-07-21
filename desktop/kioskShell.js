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
  validateEscapeLoginResponse,
};
