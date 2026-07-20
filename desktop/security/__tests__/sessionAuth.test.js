'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { decodeJwtPayloadLocally, isJwtExpiredLocally, getOrCreateDeviceId, isPinSessionBoundToDevice, pruneOldPinAttempts, isReconLaunchAuthorized, detectClockSkew } = require('../sessionAuth');

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

// ─── isReconLaunchAuthorized ────────────────────────────────────
//
// Mirrors offline:state's admin-always-allowed / active-PIN-session-required
// rule exactly (see main.js's `offline:state` handler): admin bypasses
// entirely; everyone else needs a non-null, non-expired, device-bound
// session. `nowMs` mirrors isJwtExpiredLocally's DI-testable style so
// expiry checks don't depend on real wall-clock time in tests.

const RECON_NOW_MS = Date.parse('2026-07-20T12:00:00.000Z');
const RECON_FUTURE_EXPIRY = '2026-07-20T13:00:00.000Z'; // 1h after RECON_NOW_MS
const RECON_PAST_EXPIRY = '2026-07-20T11:00:00.000Z'; // 1h before RECON_NOW_MS

test('isReconLaunchAuthorized: admin role is always authorized, even with no session', () => {
  assert.equal(isReconLaunchAuthorized('admin', null, 'device-a', RECON_NOW_MS), true);
});

test('isReconLaunchAuthorized: admin role is always authorized, even with an expired session', () => {
  const session = { expires_at: RECON_PAST_EXPIRY, device_id: 'device-a' };
  assert.equal(isReconLaunchAuthorized('admin', session, 'device-b', RECON_NOW_MS), true);
});

test('isReconLaunchAuthorized: non-admin with a valid, device-bound active session is authorized', () => {
  const session = { expires_at: RECON_FUTURE_EXPIRY, device_id: 'device-a' };
  assert.equal(isReconLaunchAuthorized('officer', session, 'device-a', RECON_NOW_MS), true);
});

test('isReconLaunchAuthorized: non-admin with no session (null) is unauthorized', () => {
  assert.equal(isReconLaunchAuthorized('officer', null, 'device-a', RECON_NOW_MS), false);
});

test('isReconLaunchAuthorized: non-admin with an expired session is unauthorized', () => {
  const session = { expires_at: RECON_PAST_EXPIRY, device_id: 'device-a' };
  assert.equal(isReconLaunchAuthorized('officer', session, 'device-a', RECON_NOW_MS), false);
});

test('isReconLaunchAuthorized: non-admin with a valid session bound to a different device is unauthorized (composes isPinSessionBoundToDevice)', () => {
  const session = { expires_at: RECON_FUTURE_EXPIRY, device_id: 'device-a' };
  assert.equal(isReconLaunchAuthorized('officer', session, 'device-b', RECON_NOW_MS), false);
});

test('isReconLaunchAuthorized: non-admin with a valid session and no device_id field (pre-migration row) is authorized', () => {
  const session = { expires_at: RECON_FUTURE_EXPIRY };
  assert.equal(isReconLaunchAuthorized('officer', session, 'device-a', RECON_NOW_MS), true);
});

test('isReconLaunchAuthorized: undefined/missing role is treated as non-admin', () => {
  const session = { expires_at: RECON_FUTURE_EXPIRY, device_id: 'device-a' };
  assert.equal(isReconLaunchAuthorized(undefined, session, 'device-a', RECON_NOW_MS), true);
  assert.equal(isReconLaunchAuthorized(undefined, null, 'device-a', RECON_NOW_MS), false);
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

// ─── detectClockSkew ───────────────────────────────────────────

// A genuine round-tripping fake config store — NOT a fixed-return stub.
// setConfigFn actually persists into `store`, and getConfigFn actually
// reads back from it, so BigInt<->string round-tripping is really
// exercised rather than trivially passing.
function makeConfigFake() {
  const store = new Map();
  return {
    store,
    getConfigFn: (key) => (store.has(key) ? store.get(key) : null),
    setConfigFn: (key, value) => {
      store.set(key, value);
    },
  };
}

test('detectClockSkew: first-ever check (no stored baseline) returns skewDetected:false and stores the baseline', () => {
  const { store, getConfigFn, setConfigFn } = makeConfigFake();

  const nowMs = 1_700_000_000_000;
  const monotonicNs = 123_456_789_000n;

  const result = detectClockSkew(getConfigFn, setConfigFn, nowMs, monotonicNs);

  assert.deepEqual(result, { skewDetected: false });

  // setConfigFn must actually have been called to persist the baseline —
  // not just a correct return value.
  assert.equal(store.get('clock_skew_check_wall_ms'), String(nowMs));
  assert.equal(store.get('clock_skew_check_monotonic_ns'), monotonicNs.toString());
});

test('detectClockSkew: first-ever check with only ONE of the two keys present is still treated as "no baseline"', () => {
  const { store, getConfigFn, setConfigFn } = makeConfigFake();
  // Simulate a partially-written prior state (e.g. crash mid-write) —
  // only the wall clock half of the baseline exists.
  store.set('clock_skew_check_wall_ms', '1000');

  const result = detectClockSkew(getConfigFn, setConfigFn, 2000, 5_000_000n);

  assert.deepEqual(result, { skewDetected: false });
  assert.equal(store.get('clock_skew_check_wall_ms'), '2000');
  assert.equal(store.get('clock_skew_check_monotonic_ns'), '5000000');
});

test('detectClockSkew: wall-clock and monotonic deltas roughly agree (~5000ms) -> skewDetected:false', () => {
  const { getConfigFn, setConfigFn } = makeConfigFake();

  const baselineWallMs = 1_700_000_000_000;
  const baselineMonotonicNs = 10_000_000_000n; // 10s in ns

  // Seed the baseline via a real first check.
  detectClockSkew(getConfigFn, setConfigFn, baselineWallMs, baselineMonotonicNs);

  // 5000ms later on both clocks.
  const nowMs = baselineWallMs + 5000;
  const monotonicNs = baselineMonotonicNs + 5_000_000_000n; // +5000ms in ns

  const result = detectClockSkew(getConfigFn, setConfigFn, nowMs, monotonicNs);

  assert.deepEqual(result, { skewDetected: false });
});

test('detectClockSkew: wall clock jumped FAR AHEAD of monotonic clock (e.g. +10yr wall vs +5s monotonic) -> skewDetected:true', () => {
  const { getConfigFn, setConfigFn } = makeConfigFake();

  const baselineWallMs = 1_700_000_000_000;
  const baselineMonotonicNs = 10_000_000_000n;

  detectClockSkew(getConfigFn, setConfigFn, baselineWallMs, baselineMonotonicNs);

  const tenYearsMs = 10 * 365 * 24 * 60 * 60 * 1000;
  const nowMs = baselineWallMs + tenYearsMs;
  const monotonicNs = baselineMonotonicNs + 5_000_000_000n; // +5000ms in ns

  const result = detectClockSkew(getConfigFn, setConfigFn, nowMs, monotonicNs);

  assert.deepEqual(result, { skewDetected: true });
});

test('detectClockSkew: wall clock rolled BACKWARD while monotonic clock kept advancing -> skewDetected:true (the attack scenario: replaying an expired offline PIN window by rolling back the system clock)', () => {
  const { getConfigFn, setConfigFn } = makeConfigFake();

  const baselineWallMs = 1_700_000_000_000;
  const baselineMonotonicNs = 10_000_000_000n;

  detectClockSkew(getConfigFn, setConfigFn, baselineWallMs, baselineMonotonicNs);

  // Attacker rolls the wall clock back by 1 hour while real elapsed
  // (monotonic) time only advances by 5000ms — negative wall delta,
  // positive monotonic delta.
  const nowMs = baselineWallMs - (60 * 60 * 1000);
  const monotonicNs = baselineMonotonicNs + 5_000_000_000n;

  const result = detectClockSkew(getConfigFn, setConfigFn, nowMs, monotonicNs);

  assert.deepEqual(result, { skewDetected: true });
});

test('detectClockSkew: updates the stored baseline to the CURRENT check values after each call, so a third check compares against the second (not the first)', () => {
  const { store, getConfigFn, setConfigFn } = makeConfigFake();

  const t0Wall = 1_700_000_000_000;
  const t0Mono = 0n;
  detectClockSkew(getConfigFn, setConfigFn, t0Wall, t0Mono);
  assert.equal(store.get('clock_skew_check_wall_ms'), String(t0Wall));

  // Second check, 5000ms later on both clocks — baseline rolls forward.
  const t1Wall = t0Wall + 5000;
  const t1Mono = t0Mono + 5_000_000_000n;
  const secondResult = detectClockSkew(getConfigFn, setConfigFn, t1Wall, t1Mono);
  assert.deepEqual(secondResult, { skewDetected: false });
  assert.equal(store.get('clock_skew_check_wall_ms'), String(t1Wall));
  assert.equal(store.get('clock_skew_check_monotonic_ns'), t1Mono.toString());

  // Third check, another 5000ms later relative to the SECOND check (not
  // the first) — if the baseline hadn't rolled forward, comparing against
  // t0 (10000ms/10s ago) would look like agreement too, so this asserts
  // the rolling-baseline behavior more precisely: only 3000ms elapse this
  // time, which is still within tolerance either way, so instead assert
  // exact stored values to prove the baseline moved.
  const t2Wall = t1Wall + 3000;
  const t2Mono = t1Mono + 3_000_000_000n;
  detectClockSkew(getConfigFn, setConfigFn, t2Wall, t2Mono);
  assert.equal(store.get('clock_skew_check_wall_ms'), String(t2Wall));
  assert.equal(store.get('clock_skew_check_monotonic_ns'), t2Mono.toString());
});
