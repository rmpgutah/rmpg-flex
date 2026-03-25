/**
 * HMAC-based resource access signing — session-independent, time-limited.
 *
 * Generates signatures that authorise read-only access to specific resources
 * (files, video streams, thumbnails, downloads) without embedding the full
 * JWT session token in URL query parameters.
 *
 * This prevents token leakage via browser history, Referer headers, and
 * proxy/CDN logs.
 */

import crypto from 'crypto';
import config from '../config';

// Track legacy token usage for deprecation monitoring
// [FIX 76] Cap legacy token tracking map size to prevent unbounded growth
const MAX_LEGACY_ROUTES = 200;
const legacyTokenCounts = new Map<string, number>();
let lastLogTime = 0;

/**
 * Log when a legacy ?token= query param is used instead of signed access.
 * Throttled to once per 5 minutes per route to avoid log spam.
 */
export function logLegacyTokenUsage(route: string): void {
  // [FIX 77] Don't track more than MAX_LEGACY_ROUTES to prevent memory leak
  if (!legacyTokenCounts.has(route) && legacyTokenCounts.size >= MAX_LEGACY_ROUTES) {
    return;
  }
  const count = (legacyTokenCounts.get(route) || 0) + 1;
  legacyTokenCounts.set(route, count);
  const now = Date.now();
  if (now - lastLogTime > 5 * 60 * 1000) {
    lastLogTime = now;
    const entries = Array.from(legacyTokenCounts.entries())
      .map(([r, c]) => `${r}: ${c}`)
      .join(', ');
    console.warn(`[SECURITY] Legacy ?token= usage (migrate to signed URLs): ${entries}`);
    legacyTokenCounts.clear();
  }
}

/**
 * Sign access to a resource.
 * @param resourceType - e.g. 'file', 'dashcam', 'bodycam', 'training'
 * @param resourceId   - the resource's unique identifier (string or number)
 * @param ttlSeconds   - signature lifetime (default: 24 hours)
 */
export function signResourceAccess(
  resourceType: string,
  resourceId: string | number,
  ttlSeconds = 86400,
): { sig: string; exp: number; nonce: string } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const nonce = crypto.randomBytes(8).toString('hex');
  const data = `${resourceType}:${resourceId}:${exp}:${nonce}`;
  const sig = crypto.createHmac('sha256', config.jwt.secret).update(data).digest('hex');
  return { sig, exp, nonce };
}

/**
 * Verify a signed resource access token.
 * Uses timing-safe comparison to prevent oracle attacks.
 */
export function verifyResourceAccess(
  resourceType: string,
  resourceId: string | number,
  sig: string,
  exp: number,
  nonce?: string,
): boolean {
  // [FIX 78] Validate input types before processing
  if (!sig || typeof sig !== 'string' || !exp || typeof exp !== 'number') return false;
  if (Date.now() / 1000 > exp) return false;
  // [FIX 79] Validate sig is valid hex and reasonable length
  if (sig.length !== 64 || !/^[0-9a-f]+$/i.test(sig)) return false;
  const data = nonce
    ? `${resourceType}:${resourceId}:${exp}:${nonce}`
    : `${resourceType}:${resourceId}:${exp}`;
  const expected = crypto.createHmac('sha256', config.jwt.secret).update(data).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
