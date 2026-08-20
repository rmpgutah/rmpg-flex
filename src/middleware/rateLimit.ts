// ============================================================
// General per-user API rate limit — applied to every auth-required
// route (see src/index.ts) and, separately, the mobile PSO path
// (see src/routes/mobileCfs.ts's verifyMobile(), which is NOT covered
// by the authPrefixes loop this middleware is mounted through).
//
// Deliberately generous: this exists to catch runaway/malicious
// traffic, not to throttle normal heavy use (live dispatch board
// polling, GPS updates, etc.) on a system where availability matters.
// See docs/superpowers/specs/2026-07-18-general-api-rate-limiting-design.md
//
// Limit history:
//   600/300s → too low: MDTBridge (global, 8 s) + GPS (5 s) + system
//   context pollers (15 s, 20 s) + FeatureFlags + Notifications consume
//   ~152 requests per tab per window. 4 open tabs = 608 → blocked. Raised
//   to 1500 (≈5 req/s avg) to accommodate multi-tab CAD use without
//   impacting the guard against actual runaway loops.
// ============================================================
import type { Context, Next } from 'hono';
import { rateLimitAllow } from '../utils/rateLimit';
import { log } from '../utils/logger';

export const API_RATE_LIMIT = 3000;
export const API_RATE_WINDOW_SECONDS = 300;

export async function apiRateLimit(c: Context, next: Next) {
  const userId = c.get('userId') as number | undefined;
  if (userId != null) {
    const allowed = await rateLimitAllow(c.env.KV, `api:user:${userId}`, API_RATE_LIMIT, API_RATE_WINDOW_SECONDS);
    if (!allowed) {
      log.warn('API rate limit exceeded', { userId, path: new URL(c.req.url).pathname });
      return c.json({ error: 'Too many requests. Slow down and try again shortly.', code: 'RATE_LIMITED' }, 429);
    }
  }
  await next();
}
