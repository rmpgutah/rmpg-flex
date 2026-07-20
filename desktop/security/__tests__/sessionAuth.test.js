'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeJwtPayloadLocally, isJwtExpiredLocally, getOrCreateDeviceId, isPinSessionBoundToDevice } = require('../sessionAuth');

// Base64url-encode helper matching the encoding sessionAuth.js decodes
// (standard base64 with '+'->'-', '/'->'_', trailing '=' stripped —
// stripping padding isn't required for decoding but keeps fixtures
// realistic since real JWT libraries omit it).
function base64url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makeJwt(payload, header = {}) {
  return `${base64url(header)}.${base64url(payload)}.sig`;
}

test('decodeJwtPayloadLocally: decodes a real-shaped JWT to its payload object', () => {
  const token = makeJwt({ exp: 1234567890 });
  assert.deepEqual(decodeJwtPayloadLocally(token), { exp: 1234567890 });
});

test('decodeJwtPayloadLocally: returns null for a token with only 2 segments', () => {
  assert.equal(decodeJwtPayloadLocally(`${base64url({})}.${base64url({ exp: 1 })}`), null);
});

test('decodeJwtPayloadLocally: returns null for a token with too many segments', () => {
  assert.equal(decodeJwtPayloadLocally('a.b.c.d'), null);
});

test('decodeJwtPayloadLocally: returns null when the middle segment is not valid JSON', () => {
  // 'not-json' base64url-decodes fine but the decoded bytes aren't valid JSON
  const notJsonSegment = Buffer.from('not valid json{{{').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(decodeJwtPayloadLocally(`header.${notJsonSegment}.sig`), null);
});

test('decodeJwtPayloadLocally: returns null for an empty string', () => {
  assert.equal(decodeJwtPayloadLocally(''), null);
});

test('decodeJwtPayloadLocally: returns null for null/undefined input', () => {
  assert.equal(decodeJwtPayloadLocally(null), null);
  assert.equal(decodeJwtPayloadLocally(undefined), null);
});

test('isJwtExpiredLocally: not expired when exp is far in the future', () => {
  const nowMs = 1_700_000_000_000;
  const token = makeJwt({ exp: Math.floor(nowMs / 1000) + 3600 }); // +1hr
  assert.equal(isJwtExpiredLocally(token, nowMs), false);
});

test('isJwtExpiredLocally: expired when exp is in the past', () => {
  const nowMs = 1_700_000_000_000;
  const token = makeJwt({ exp: Math.floor(nowMs / 1000) - 3600 }); // -1hr
  assert.equal(isJwtExpiredLocally(token, nowMs), true);
});

test('isJwtExpiredLocally: fail-closed — expired when token has no exp claim', () => {
  const nowMs = 1_700_000_000_000;
  const token = makeJwt({ sub: 'user-1' });
  assert.equal(isJwtExpiredLocally(token, nowMs), true);
});

test('isJwtExpiredLocally: fail-closed — expired when token is undecodable', () => {
  const nowMs = 1_700_000_000_000;
  assert.equal(isJwtExpiredLocally('not-a-jwt', nowMs), true);
  assert.equal(isJwtExpiredLocally('', nowMs), true);
  assert.equal(isJwtExpiredLocally(null, nowMs), true);
});

test('isJwtExpiredLocally: boundary — exp exactly at nowMs/1000 is treated as expired', () => {
  // exp * 1000 === nowMs exactly: the token's validity instant has been
  // reached, so it must be treated as expired (fail closed at the edge).
  const nowMs = 1_700_000_000_000;
  const token = makeJwt({ exp: nowMs / 1000 });
  assert.equal(isJwtExpiredLocally(token, nowMs), true);
});

test('isJwtExpiredLocally: boundary — exp one second after nowMs/1000 is not expired', () => {
  const nowMs = 1_700_000_000_000;
  const token = makeJwt({ exp: nowMs / 1000 + 1 });
  assert.equal(isJwtExpiredLocally(token, nowMs), false);
});

// ─── getOrCreateDeviceId ───────────────────────────────────────

test('getOrCreateDeviceId: no stored id — generates one, persists it via setConfigFn, and returns it', () => {
  const store = {};
  const getConfigFn = (key) => (key in store ? store[key] : null);
  const setConfigFn = (key, value) => { store[key] = value; };
  let setConfigCalls = 0;
  const trackedSetConfigFn = (key, value) => { setConfigCalls += 1; setConfigFn(key, value); };
  const randomUUIDFn = () => 'generated-device-id';

  const result = getOrCreateDeviceId(getConfigFn, trackedSetConfigFn, randomUUIDFn);

  assert.equal(result, 'generated-device-id');
  assert.equal(setConfigCalls, 1);
  assert.equal(store.device_id, 'generated-device-id');
});

test('getOrCreateDeviceId: existing stored id — returns it unchanged WITHOUT calling setConfigFn (regression guard)', () => {
  const getConfigFn = (key) => (key === 'device_id' ? 'already-stored-id' : null);
  let setConfigCalls = 0;
  const setConfigFn = () => { setConfigCalls += 1; };
  const randomUUIDFn = () => { throw new Error('randomUUIDFn should not be called when an id already exists'); };

  const result = getOrCreateDeviceId(getConfigFn, setConfigFn, randomUUIDFn);

  assert.equal(result, 'already-stored-id');
  assert.equal(setConfigCalls, 0);
});

// ─── isPinSessionBoundToDevice ─────────────────────────────────

test('isPinSessionBoundToDevice: matching device_id returns true', () => {
  const session = { device_id: 'device-a' };
  assert.equal(isPinSessionBoundToDevice(session, 'device-a'), true);
});

test('isPinSessionBoundToDevice: mismatched device_id returns false', () => {
  const session = { device_id: 'device-a' };
  assert.equal(isPinSessionBoundToDevice(session, 'device-b'), false);
});

test('isPinSessionBoundToDevice: transitional backward-compat — null device_id (pre-migration row) is treated as valid', () => {
  const session = { device_id: null };
  assert.equal(isPinSessionBoundToDevice(session, 'device-a'), true);
});

test('isPinSessionBoundToDevice: transitional backward-compat — undefined device_id (pre-migration row) is treated as valid', () => {
  const session = { device_id: undefined };
  assert.equal(isPinSessionBoundToDevice(session, 'device-a'), true);
});
