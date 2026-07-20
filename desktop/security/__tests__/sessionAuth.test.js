'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { decodeJwtPayloadLocally, isJwtExpiredLocally, getOrCreateDeviceId, isPinSessionBoundToDevice, pruneOldPinAttempts } = require('../sessionAuth');

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

// ─── pruneOldPinAttempts ───────────────────────────────────────
//
// Unlike getOrCreateDeviceId/isPinSessionBoundToDevice above,
// pruneOldPinAttempts(db, maxRowsPerUser) genuinely needs SQL — its
// interface takes a real better-sqlite3 `db` instance as an explicit
// parameter (matching this file's DI-testable style) rather than reaching
// into localDb.js's module-level singleton via getLocalDb(). Because the
// function operates on whatever `db` it's handed rather than calling
// getLocalDb() itself, the test doesn't need localDb.test.js's
// require.cache electron/safeStorage mock (that trick exists to satisfy
// localDb.js's own `require('electron')` + app.getPath('userData') calls
// inside initLocalDb()) — a plain in-memory better-sqlite3 database with
// just the pin_attempts table is enough to exercise the real SQL.

function makeTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pin_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      success INTEGER NOT NULL DEFAULT 0,
      attempted_at TEXT NOT NULL
    );
  `);
  return db;
}

function seedPinAttempt(db, { userId, success = 0, attemptedAt }) {
  db.prepare('INSERT INTO pin_attempts (user_id, success, attempted_at) VALUES (?, ?, ?)').run(userId, success, attemptedAt);
}

test('pruneOldPinAttempts: keeps only the N most-recent rows (by attempted_at) for a user, leaves a second (under-cap) user completely untouched, returns accurate prunedRows count', () => {
  const db = makeTestDb();

  // User 1: 10 rows, timestamps 2026-01-01T00:00:00Z .. 2026-01-01T00:09:00Z
  // (minute increments so ordering is unambiguous). Pruned to keep 3.
  const user1Timestamps = [];
  for (let i = 0; i < 10; i++) {
    const attemptedAt = `2026-01-01T00:0${i}:00.000Z`;
    user1Timestamps.push(attemptedAt);
    seedPinAttempt(db, { userId: 1, success: i % 2, attemptedAt });
  }

  // User 2: only 2 rows — under the maxRowsPerUser=3 cap, so this user's
  // rows must be completely untouched by pruning user 1's excess.
  const user2Timestamps = ['2026-02-01T00:00:00.000Z', '2026-02-01T00:01:00.000Z'];
  for (const attemptedAt of user2Timestamps) {
    seedPinAttempt(db, { userId: 2, success: 1, attemptedAt });
  }

  const user2Before = db.prepare('SELECT * FROM pin_attempts WHERE user_id = 2 ORDER BY id').all();
  assert.equal(user2Before.length, 2);

  const result = pruneOldPinAttempts(db, 3);

  // 10 rows -> keep 3 for user 1 means 7 pruned; user 2 has only 2 rows
  // (under the cap), so nothing is pruned there.
  assert.deepEqual(result, { prunedRows: 7 });

  const user1After = db.prepare('SELECT id, attempted_at FROM pin_attempts WHERE user_id = 1 ORDER BY attempted_at').all();
  assert.equal(user1After.length, 3);
  // The 3 most-recent rows by attempted_at must remain — i.e. the last 3
  // timestamps seeded (00:07, 00:08, 00:09) — checked by content/order,
  // not just count.
  assert.deepEqual(user1After.map((r) => r.attempted_at), user1Timestamps.slice(-3));

  const user2After = db.prepare('SELECT * FROM pin_attempts WHERE user_id = 2 ORDER BY id').all();
  assert.deepEqual(user2After, user2Before, "user 2's rows must be byte-for-byte untouched");
});

test('pruneOldPinAttempts: a user whose row count is at or below maxRowsPerUser is left completely untouched', () => {
  const db = makeTestDb();

  const timestamps = ['2026-03-01T00:00:00.000Z', '2026-03-01T00:01:00.000Z', '2026-03-01T00:02:00.000Z'];
  for (const attemptedAt of timestamps) {
    seedPinAttempt(db, { userId: 42, success: 1, attemptedAt });
  }
  const before = db.prepare('SELECT * FROM pin_attempts WHERE user_id = 42 ORDER BY id').all();

  const result = pruneOldPinAttempts(db, 500);

  assert.equal(result.prunedRows, 0);
  const after = db.prepare('SELECT * FROM pin_attempts WHERE user_id = 42 ORDER BY id').all();
  assert.deepEqual(after, before, 'rows must be byte-for-byte untouched when under the retention cap');
});

test('pruneOldPinAttempts: empty pin_attempts table — no-op, returns {prunedRows: 0}', () => {
  const db = makeTestDb();
  const result = pruneOldPinAttempts(db, 500);
  assert.deepEqual(result, { prunedRows: 0 });
});
