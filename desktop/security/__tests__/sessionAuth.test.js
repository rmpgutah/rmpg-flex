'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeJwtPayloadLocally, isJwtExpiredLocally } = require('../sessionAuth');

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
