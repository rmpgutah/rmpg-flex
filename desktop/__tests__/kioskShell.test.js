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
