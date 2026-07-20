// ============================================================
// RMPG Flex — Session Auth
// Local (offline-safe) JWT inspection for the desktop shell.
// These helpers never contact the network or verify a signature —
// they only decode the claims already embedded in a cached token
// so the offline API bridge can refuse to serve stale-session
// data once that token's stated expiry has passed. Signature
// verification of the live session still happens server-side;
// this is a client-side, fail-closed staleness guard only.
// ============================================================

'use strict';

/**
 * Decodes the payload segment of a JWT without verifying its signature.
 * Never throws — malformed/missing input (e.g. no cached token yet) is
 * an expected, common case and simply yields `null`.
 *
 * @param {string} token
 * @returns {object|null} the decoded payload, or null if `token` isn't
 *   a well-formed 3-segment JWT with a JSON payload segment.
 */
function decodeJwtPayloadLocally(token) {
  if (typeof token !== 'string' || token.length === 0) return null;

  const segments = token.split('.');
  if (segments.length !== 3) return null;

  const [, payloadSegment] = segments;

  try {
    const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Fail-closed local expiry check: an undecodable token, or a decodable
 * token with no `exp` claim, is treated as expired rather than trusted.
 *
 * JWT `exp` is seconds-since-epoch (RFC 7519); `nowMs` is expected to be
 * milliseconds (e.g. `Date.now()`) — the comparison converts `exp` to
 * milliseconds before comparing, it never mixes the two units directly.
 *
 * @param {string} token
 * @param {number} nowMs - current time in milliseconds
 * @returns {boolean} true if the token should be treated as expired
 */
function isJwtExpiredLocally(token, nowMs) {
  const payload = decodeJwtPayloadLocally(token);
  if (!payload || typeof payload.exp !== 'number') return true;

  return payload.exp * 1000 <= nowMs;
}

/**
 * Reads (or lazily creates) a stable per-installation device identifier,
 * used to bind offline PIN sessions to the device they were created on.
 * DI-testable: takes `getConfig`/`setConfig`-shaped functions and a
 * `crypto.randomUUID`-shaped function as parameters rather than reaching
 * into localDb.js / node:crypto directly.
 *
 * If a device id is already stored, it's returned UNCHANGED and
 * `setConfigFn` is never called — this is a read path, not a
 * read-or-refresh path; callers rely on the id staying stable across
 * calls within the same install.
 *
 * @param {(key: string) => string|null} getConfigFn
 * @param {(key: string, value: string) => void} setConfigFn
 * @param {() => string} randomUUIDFn
 * @returns {string} the device id (existing or newly generated)
 */
function getOrCreateDeviceId(getConfigFn, setConfigFn, randomUUIDFn) {
  const existing = getConfigFn('device_id');
  if (existing) return existing;

  const newId = randomUUIDFn();
  setConfigFn('device_id', newId);
  return newId;
}

/**
 * Pure check: is a `pin_sessions` row bound to the current device?
 *
 * `session.device_id` being `null`/`undefined` means the row predates the
 * device-binding migration (this column was added after pin_sessions
 * already had live rows). That case is treated as valid — a one-time
 * transitional allowance so existing active offline sessions aren't
 * locked out the instant this ships. Every session created AFTER this
 * change always has a `device_id` set (see pinManager.js's INSERT), so
 * this allowance naturally stops mattering as old sessions expire/rotate
 * out; it is not meant to be a permanent bypass.
 *
 * @param {{ device_id?: string|null }} session
 * @param {string} currentDeviceId
 * @returns {boolean}
 */
function isPinSessionBoundToDevice(session, currentDeviceId) {
  if (session.device_id === null || session.device_id === undefined) return true;
  return session.device_id === currentDeviceId;
}

/**
 * Retention sweep for `pin_attempts` (brute-force tracking log): for each
 * distinct `user_id`, deletes all but the most recent `maxRowsPerUser` rows
 * (ordered by `attempted_at`), so the table doesn't grow unbounded on a
 * long-lived install. This is retention/rotation, not real-time PIN
 * enforcement — intended to run once per app launch, not on every attempt.
 *
 * Unlike the other helpers in this file, this genuinely needs SQL, so it
 * takes a real `better-sqlite3` `db` instance as an explicit parameter
 * (matching this file's DI-testable style) rather than reaching into
 * localDb.js's module-level singleton itself.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} [maxRowsPerUser]
 * @returns {{ prunedRows: number }} total number of rows deleted across all users
 */
function pruneOldPinAttempts(db, maxRowsPerUser = 500) {
  const userIds = db.prepare('SELECT DISTINCT user_id FROM pin_attempts').all().map((row) => row.user_id);

  const deleteStale = db.prepare(`
    DELETE FROM pin_attempts
    WHERE user_id = ?
      AND id NOT IN (
        SELECT id FROM pin_attempts
        WHERE user_id = ?
        ORDER BY attempted_at DESC, id DESC
        LIMIT ?
      )
  `);

  let prunedRows = 0;
  for (const userId of userIds) {
    const result = deleteStale.run(userId, userId, maxRowsPerUser);
    prunedRows += result.changes;
  }

  return { prunedRows };
}

/**
 * Pure check: is a Recon Connect tool launch authorized for the current
 * cached role + active PIN session? Mirrors `offline:state`'s
 * admin-always-allowed / active-PIN-session-required rule exactly (see
 * that handler in main.js) — this function exists so `recon:launch` can
 * reuse the SAME rule instead of re-deriving a subtly different one.
 *
 * `cachedRole === 'admin'` is always authorized, regardless of session
 * state. Otherwise `activeSession` must be a non-null object representing
 * a currently-valid (non-expired) session; device binding is delegated to
 * `isPinSessionBoundToDevice` (composed, not duplicated) whenever
 * `activeSession` carries a `device_id` field.
 *
 * @param {string|null|undefined} cachedRole
 * @param {{ expires_at?: string, device_id?: string|null } | null} activeSession
 * @param {string} currentDeviceId - this installation's device id, used only
 *   for the device-binding check when `activeSession.device_id` is present
 * @param {number} nowMs - current time in milliseconds (DI-testable, mirrors
 *   isJwtExpiredLocally's style)
 * @returns {boolean}
 */
function isReconLaunchAuthorized(cachedRole, activeSession, currentDeviceId, nowMs) {
  if (cachedRole === 'admin') return true;

  if (!activeSession || typeof activeSession !== 'object') return false;

  if (typeof activeSession.expires_at === 'string') {
    const expiresAtMs = Date.parse(activeSession.expires_at);
    if (Number.isNaN(expiresAtMs) || expiresAtMs <= nowMs) return false;
  }

  if (Object.prototype.hasOwnProperty.call(activeSession, 'device_id')) {
    return isPinSessionBoundToDevice(activeSession, currentDeviceId);
  }

  return true;
}

/**
 * Detects system clock skew between successive app launches (or periodic
 * checks) by comparing how much the wall clock (`Date.now()`) moved against
 * how much the monotonic clock (`process.hrtime.bigint()`) moved over the
 * same interval. The monotonic clock is immune to wall-clock manipulation
 * (NTP corrections, DST, or a user/attacker manually rolling the system
 * clock forward or backward) — a large disagreement between the two deltas
 * means the wall clock was tampered with or jumped unexpectedly.
 *
 * This defends specifically against an attacker rolling the system clock
 * BACKWARD to replay an expired offline PIN session window (an `expires_at`
 * check using `Date.now()` would otherwise see a "past" expiry as still in
 * the future). A backward wall-clock jump produces a large negative
 * `wallDeltaMs` against a small positive `monotonicDeltaMs`, which this
 * function flags exactly like a forward jump — skew is detected on
 * magnitude of disagreement, not direction.
 *
 * DI-testable: takes `getConfigFn`/`setConfigFn`-shaped functions plus the
 * current `Date.now()`/`process.hrtime.bigint()` values as parameters
 * rather than calling them internally.
 *
 * Storage: both baseline values are persisted as strings (`'clock_skew_check_wall_ms'`,
 * `'clock_skew_check_monotonic_ns'`) since config storage is string-only;
 * the monotonic value round-trips through BigInt <-> string explicitly.
 *
 * Baseline update ordering: the stored baseline is updated to the CURRENT
 * check's values only AFTER computing `skewDetected` against the PREVIOUS
 * baseline (not before). This makes every check's rolling baseline "the
 * latest successful check", which is more defensible than updating first:
 * if this function were ever called back-to-back in a tight loop, updating
 * before computing skew would silently make every call compare against
 * itself (always `{skewDetected:false}`), permanently defeating the check.
 * Computing first, then updating, guarantees each check is always compared
 * against a genuinely prior point in time.
 *
 * @param {(key: string) => string|null} getConfigFn
 * @param {(key: string, value: string) => void} setConfigFn
 * @param {number} nowMs - current wall-clock time in ms (e.g. `Date.now()`)
 * @param {bigint} monotonicNs - current monotonic time in ns (e.g. `process.hrtime.bigint()`)
 * @param {number} [toleranceMs] - allowed disagreement between the two deltas, in ms
 * @returns {{ skewDetected: boolean }}
 */
function detectClockSkew(getConfigFn, setConfigFn, nowMs, monotonicNs, toleranceMs = 60000) {
  const previousWallRaw = getConfigFn('clock_skew_check_wall_ms');
  const previousMonotonicRaw = getConfigFn('clock_skew_check_monotonic_ns');

  const hasBaseline = previousWallRaw !== null && previousWallRaw !== undefined
    && previousMonotonicRaw !== null && previousMonotonicRaw !== undefined;

  let skewDetected = false;

  if (hasBaseline) {
    const previousWallMs = Number(previousWallRaw);
    const previousMonotonicNs = BigInt(previousMonotonicRaw);

    const wallDeltaMs = nowMs - previousWallMs;
    const monotonicDeltaMs = Number(monotonicNs - previousMonotonicNs) / 1e6;

    skewDetected = Math.abs(wallDeltaMs - monotonicDeltaMs) > toleranceMs;
  }

  // Update the baseline to THIS check's values (see ordering rationale above)
  // — always runs, whether this was the first-ever check or a subsequent one.
  setConfigFn('clock_skew_check_wall_ms', String(nowMs));
  setConfigFn('clock_skew_check_monotonic_ns', monotonicNs.toString());

  return { skewDetected };
}

module.exports = {
  decodeJwtPayloadLocally,
  isJwtExpiredLocally,
  getOrCreateDeviceId,
  isPinSessionBoundToDevice,
  pruneOldPinAttempts,
  isReconLaunchAuthorized,
  detectClockSkew,
};
