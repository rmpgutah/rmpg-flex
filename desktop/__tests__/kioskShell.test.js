'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildShellRegistryValue,
  MAX_BOOT_FAILURES,
  nextBootAttemptState,
  shouldSelfRevert,
  resetBootAttemptState,
  validateEscapeLoginResponse,
  validateFlexOsLoginResponse,
} = require('../kioskShell');

test('buildShellRegistryValue: wraps the exe path in quotes for the Shell value', () => {
  assert.equal(
    buildShellRegistryValue('C:\\Program Files\\RMPG Flex\\RMPG Flex.exe'),
    '"C:\\Program Files\\RMPG Flex\\RMPG Flex.exe"'
  );
});

test('buildShellRegistryValue: rejects a non-string or empty path', () => {
  assert.throws(() => buildShellRegistryValue(''), /non-empty string/);
  assert.throws(() => buildShellRegistryValue(undefined), /non-empty string/);
});

test('resetBootAttemptState: starts at count 0', () => {
  assert.deepEqual(resetBootAttemptState(), { count: 0 });
});

test('nextBootAttemptState: increments count by 1 each call', () => {
  let state = resetBootAttemptState();
  state = nextBootAttemptState(state);
  assert.deepEqual(state, { count: 1 });
  state = nextBootAttemptState(state);
  assert.deepEqual(state, { count: 2 });
});

test('nextBootAttemptState: treats a missing/malformed prior state as count 0', () => {
  assert.deepEqual(nextBootAttemptState(null), { count: 1 });
  assert.deepEqual(nextBootAttemptState(undefined), { count: 1 });
  assert.deepEqual(nextBootAttemptState({}), { count: 1 });
  assert.deepEqual(nextBootAttemptState({ count: 'not a number' }), { count: 1 });
});

test('shouldSelfRevert: false while count is at or below MAX_BOOT_FAILURES', () => {
  assert.equal(MAX_BOOT_FAILURES, 3);
  assert.equal(shouldSelfRevert({ count: 0 }), false);
  assert.equal(shouldSelfRevert({ count: 3 }), false);
});

test('shouldSelfRevert: true once count exceeds MAX_BOOT_FAILURES', () => {
  assert.equal(shouldSelfRevert({ count: 4 }), true);
  assert.equal(shouldSelfRevert({ count: 10 }), true);
});

test('validateEscapeLoginResponse: accepts a successful admin/manager login with a token', () => {
  const body = JSON.stringify({ token: 'abc.def.ghi', user: { role: 'admin' } });
  assert.deepEqual(validateEscapeLoginResponse(body), { ok: true, role: 'admin' });
});

test('validateEscapeLoginResponse: accepts manager role too', () => {
  const body = JSON.stringify({ token: 'abc.def.ghi', user: { role: 'manager' } });
  assert.deepEqual(validateEscapeLoginResponse(body), { ok: true, role: 'manager' });
});

test('validateEscapeLoginResponse: rejects a non-admin/manager role even with a valid token', () => {
  const body = JSON.stringify({ token: 'abc.def.ghi', user: { role: 'officer' } });
  const result = validateEscapeLoginResponse(body);
  assert.equal(result.ok, false);
  assert.match(result.error, /admin or manager/);
});

test('validateEscapeLoginResponse: rejects a requires2FA response with a clear reason', () => {
  const body = JSON.stringify({ requires2FA: true, tempToken: 'x' });
  const result = validateEscapeLoginResponse(body);
  assert.equal(result.ok, false);
  assert.match(result.error, /2FA/);
});

test('validateEscapeLoginResponse: rejects an error response (wrong password, locked, etc)', () => {
  const body = JSON.stringify({ error: 'Invalid username or password', code: 'INVALID_USERNAME_OR_PASSWORD' });
  const result = validateEscapeLoginResponse(body);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Invalid username or password');
});

test('validateEscapeLoginResponse: rejects malformed JSON without throwing', () => {
  const result = validateEscapeLoginResponse('not json');
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid response/);
});

test('validateFlexOsLoginResponse: accepts officer role with valid token', () => {
  const body = JSON.stringify({ token: 'tok', user: { name: 'Jane Smith', role: 'officer' } });
  assert.deepEqual(validateFlexOsLoginResponse(body), { ok: true, officer: { name: 'Jane Smith', role: 'officer' } });
});

test('validateFlexOsLoginResponse: accepts admin role with valid token', () => {
  const body = JSON.stringify({ token: 'tok', user: { name: 'Bob', role: 'admin' } });
  assert.deepEqual(validateFlexOsLoginResponse(body), { ok: true, officer: { name: 'Bob', role: 'admin' } });
});

test('validateFlexOsLoginResponse: accepts dispatcher role with valid token', () => {
  const body = JSON.stringify({ token: 'tok', user: { name: 'Sue', role: 'dispatcher' } });
  assert.deepEqual(validateFlexOsLoginResponse(body), { ok: true, officer: { name: 'Sue', role: 'dispatcher' } });
});

test('validateFlexOsLoginResponse: rejects server error string', () => {
  const result = validateFlexOsLoginResponse(JSON.stringify({ error: 'Invalid credentials' }));
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'Invalid credentials');
});

test('validateFlexOsLoginResponse: rejects malformed JSON without throwing', () => {
  const result = validateFlexOsLoginResponse('not json at all');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'invalid response from server');
});

test('validateFlexOsLoginResponse: rejects requires2FA response', () => {
  const result = validateFlexOsLoginResponse(JSON.stringify({ requires2FA: true }));
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.length > 0);
});

test('validateFlexOsLoginResponse: rejects response missing token', () => {
  const result = validateFlexOsLoginResponse(JSON.stringify({ user: { name: 'X', role: 'officer' } }));
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'invalid response from server');
});

// ─── Escape accelerator selection ─────────────────────────────

const {
  KIOSK_ESCAPE_ACCELERATORS,
  selectEscapeAccelerator,
  shouldUseKioskChrome,
  shouldRelaunchOnAllWindowsClosed,
} = require('../kioskShell');
const { validateGlobalShortcutAccelerator } = require('../security/ipcGuard');

test('KIOSK_ESCAPE_ACCELERATORS: every candidate is a well-formed Electron accelerator', () => {
  // Electron's globalShortcut.register THROWS on a malformed accelerator
  // string, so a typo here would burn a candidate slot at runtime.
  assert.ok(KIOSK_ESCAPE_ACCELERATORS.length >= 2, 'need a fallback, not just one combo');
  for (const accelerator of KIOSK_ESCAPE_ACCELERATORS) {
    assert.deepEqual(
      validateGlobalShortcutAccelerator(accelerator),
      { ok: true },
      `${accelerator} is not a valid accelerator`
    );
  }
});

test('selectEscapeAccelerator: returns the first accelerator that registers', () => {
  const tried = [];
  const chosen = selectEscapeAccelerator(['A1', 'A2'], (a) => { tried.push(a); return true; });
  assert.equal(chosen, 'A1');
  assert.deepEqual(tried, ['A1'], 'must stop at the first success');
});

test('selectEscapeAccelerator: falls through when register returns false', () => {
  const chosen = selectEscapeAccelerator(['A1', 'A2'], (a) => a === 'A2');
  assert.equal(chosen, 'A2');
});

test('selectEscapeAccelerator: falls through when register throws', () => {
  const chosen = selectEscapeAccelerator(['A1', 'A2'], (a) => {
    if (a === 'A1') throw new Error('malformed accelerator');
    return true;
  });
  assert.equal(chosen, 'A2');
});

test('selectEscapeAccelerator: treats a truthy non-true return as failure', () => {
  // Guards against a mock/API drift where register() returns undefined.
  assert.equal(selectEscapeAccelerator(['A1'], () => undefined), null);
  assert.equal(selectEscapeAccelerator(['A1'], () => 'yes'), null);
});

test('selectEscapeAccelerator: returns null when every candidate fails', () => {
  assert.equal(selectEscapeAccelerator(['A1', 'A2', 'A3'], () => false), null);
});

// ─── Kiosk chrome vs. relaunch-on-close (the anti-brick invariant) ───

test('shouldUseKioskChrome: true on a normal kiosk boot with a registered accelerator', () => {
  assert.equal(shouldUseKioskChrome({
    isKioskShell: true, revertSucceeded: false, escapeAcceleratorRegistered: true,
  }), true);
});

test('shouldUseKioskChrome: false when no escape accelerator could be registered', () => {
  // Never enter a mode the operator cannot leave.
  assert.equal(shouldUseKioskChrome({
    isKioskShell: true, revertSucceeded: false, escapeAcceleratorRegistered: false,
  }), false);
});

test('shouldUseKioskChrome: false after a successful self-revert', () => {
  assert.equal(shouldUseKioskChrome({
    isKioskShell: true, revertSucceeded: true, escapeAcceleratorRegistered: true,
  }), false);
});

test('shouldUseKioskChrome: stays TRUE when the self-revert failed', () => {
  // The registry still points at this app, so the escape hotkey and kiosk
  // chrome must stay live — dropping to a normal window here is what left
  // the machine shell-less after a dismissed UAC prompt.
  assert.equal(shouldUseKioskChrome({
    isKioskShell: true, revertSucceeded: false, escapeAcceleratorRegistered: true,
  }), true);
});

test('shouldUseKioskChrome: false whenever this launch is not the shell', () => {
  assert.equal(shouldUseKioskChrome({
    isKioskShell: false, revertSucceeded: false, escapeAcceleratorRegistered: true,
  }), false);
});

test('shouldRelaunchOnAllWindowsClosed: true while running as the Windows shell', () => {
  assert.equal(shouldRelaunchOnAllWindowsClosed({
    isKioskShell: true, deliberatelyReverting: false,
  }), true);
});

test('shouldRelaunchOnAllWindowsClosed: false during a deliberate admin revert', () => {
  assert.equal(shouldRelaunchOnAllWindowsClosed({
    isKioskShell: true, deliberatelyReverting: true,
  }), false);
});

test('shouldRelaunchOnAllWindowsClosed: false for an ordinary non-shell launch', () => {
  assert.equal(shouldRelaunchOnAllWindowsClosed({
    isKioskShell: false, deliberatelyReverting: false,
  }), false);
});

test('relaunch survives a fallback to a normal window (the brick regression)', () => {
  // Both paths that drop kiosk chrome while the registry still points here —
  // a failed self-revert and an unavailable accelerator — must NOT also opt
  // out of relaunch-on-close. Tying both answers to one flag is what turned
  // a dismissed UAC prompt into a black screen.
  for (const escapeAcceleratorRegistered of [true, false]) {
    const usesChrome = shouldUseKioskChrome({
      isKioskShell: true, revertSucceeded: false, escapeAcceleratorRegistered,
    });
    const relaunches = shouldRelaunchOnAllWindowsClosed({
      isKioskShell: true, deliberatelyReverting: false,
    });
    assert.equal(relaunches, true, 'must always relaunch while the shell key points here');
    assert.equal(usesChrome, escapeAcceleratorRegistered);
  }
});

// ─── main.js wiring guards ────────────────────────────────────
// The bugs fixed alongside these helpers were all WIRING bugs — the pure
// functions above were fine, main.js just called them wrongly. Unit tests
// can't reach main.js (it requires electron at module load), so scan the
// source, in the same spirit as auditIpcHandlerRegistry.

const fs = require('node:fs');
const nodePath = require('node:path');
const MAIN_JS = fs.readFileSync(nodePath.join(__dirname, '..', 'main.js'), 'utf8');

test('main.js: kiosk:attempt-escape uses the local-file guard, not the host guard', () => {
  // kioskEscape.html is loaded with loadFile(), so a host-based guard
  // rejects every call and the only exit from kiosk mode stops working.
  assert.match(
    MAIN_JS,
    /guardedLocalFileHandle\(\s*['"]kiosk:attempt-escape['"]/,
    'kiosk:attempt-escape must be registered through createLocalFileIpcGuards'
  );
  assert.doesNotMatch(
    MAIN_JS,
    /\bguardedHandle\(\s*['"]kiosk:attempt-escape['"]/,
    'kiosk:attempt-escape must NOT use the remote-host guard'
  );
});

test('main.js: every runRegistryWrite / deleteHkcuShell result is inspected', () => {
  // A discarded result means a registry failure silently reads as success,
  // clearing kiosk state while the Shell key still points at this app.
  // Accept either `const x = await fn(` or `x = await fn(` (the latter is
  // used where the same variable is assigned in a conditional branch).
  const ASSIGNED = /^(?:const \w+ = |result = )await (runRegistryWrite|deleteHkcuShell)\(/;
  const writeLines = (MAIN_JS.match(/^.*runRegistryWrite\(.*$/gm) || [])
    .filter((l) => !l.includes('function runRegistryWrite'));
  const deleteLines = (MAIN_JS.match(/^.*deleteHkcuShell\(.*$/gm) || [])
    .filter((l) => !l.includes('function deleteHkcuShell'));
  const allInvocations = [...writeLines, ...deleteLines];
  assert.ok(allInvocations.length >= 3, `expected at least 3 call sites, found ${allInvocations.length}`);
  for (const line of allInvocations) {
    assert.match(
      line.trim(),
      ASSIGNED,
      `result discarded — assign and check .ok: ${line.trim()}`
    );
  }
});

test('main.js: no remnant call to runElevatedRegistryWrite (HKLM UAC path fully replaced)', () => {
  assert.doesNotMatch(
    MAIN_JS,
    /runElevatedRegistryWrite\s*\(/,
    'runElevatedRegistryWrite must not appear in main.js — use runRegistryWrite or deleteHkcuShell'
  );
});

test('main.js: the escape shortcut is registered through selectEscapeAccelerator', () => {
  // A bare globalShortcut.register('Ctrl+Alt+Shift+F12', …) ignores the
  // boolean return, so a combination owned by another process silently
  // leaves kiosk mode with no exit.
  assert.match(MAIN_JS, /selectEscapeAccelerator\(\s*\n?\s*KIOSK_ESCAPE_ACCELERATORS/);
  assert.doesNotMatch(
    MAIN_JS,
    /globalShortcut\.register\(\s*['"]Ctrl\+Alt\+Shift\+F12['"]/,
    'hardcoded single-accelerator registration reintroduces the no-exit bug'
  );
});

test('main.js: relaunch-on-close is driven by isKioskShell, not useKioskChrome', () => {
  // Tying them together means every fallback to a normal window also opts
  // out of relaunch, which is the black-screen brick.
  assert.match(MAIN_JS, /isRunningAsKioskShell = isKioskShell;/);
  assert.doesNotMatch(MAIN_JS, /isRunningAsKioskShell = useKioskChrome;/);
});
