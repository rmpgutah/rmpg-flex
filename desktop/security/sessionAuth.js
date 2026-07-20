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

module.exports = {
  decodeJwtPayloadLocally,
  isJwtExpiredLocally,
  getOrCreateDeviceId,
  isPinSessionBoundToDevice,
};
