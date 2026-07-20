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

module.exports = {
  decodeJwtPayloadLocally,
  isJwtExpiredLocally,
};
