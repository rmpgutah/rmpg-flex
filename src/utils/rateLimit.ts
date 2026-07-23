// ============================================================
// KV-backed fixed-window rate limiter.
//
// KV is eventually consistent, so counts are approximate — two
// colocated requests can race the read-increment-write. That's
// acceptable here: the limiter exists to stop brute-force loops
// (hundreds of attempts), not to enforce an exact N. The window
// key embeds the window start so entries expire on their own.
//
// FAIL-OPEN: a KV outage must never lock the org out of login.
// ============================================================
import { log } from './logger';
import type { KVNamespace } from '@cloudflare/workers-types';

export async function rateLimitAllow(
  kv: KVNamespace,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (now % windowSeconds);
    const key = `rl:${bucket}:${windowStart}`;
    const current = Number((await kv.get(key)) ?? '0');
    if (current >= limit) return false;
    // KV minimum expirationTtl is 60s; keep the entry one extra window
    // so a request near the window edge still sees the counter.
    await kv.put(key, String(current + 1), {
      expirationTtl: Math.max(60, windowSeconds * 2),
    });
    return true;
  } catch (err) {
    log.error('KV error (failing open)', {}, err);
    return true;
  }
}

/** Read-only companion to rateLimitAllow — returns the current window's
 *  count for `bucket` WITHOUT incrementing it. Computes the same
 *  window-bucketed key (`rl:${bucket}:${windowStart}`) so it reads exactly
 *  what rateLimitAllow already wrote for "now". Used where a caller needs
 *  the running count for a decision (e.g. "has this IP crossed N failures
 *  in this window") separate from whether to allow/deny the request. */
export async function rateLimitCount(
  kv: KVNamespace,
  bucket: string,
  windowSeconds: number,
): Promise<number> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (now % windowSeconds);
    const key = `rl:${bucket}:${windowStart}`;
    return Number((await kv.get(key)) ?? '0');
  } catch (err) {
    log.error('KV error (failing open)', {}, err);
    return 0;
  }
}
