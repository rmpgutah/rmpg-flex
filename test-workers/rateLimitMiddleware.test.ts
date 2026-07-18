// Isolated unit test for apiRateLimit's own logic — mounts it on a
// standalone test Hono app with a fake userId injected directly (no real
// authMiddleware/JWT involved). Mirrors the pattern test-workers/auth.test.ts
// uses for readOnlyRoleGuard: this file proves the middleware's behavior in
// isolation; test-workers/apiRateLimitWiring.test.ts (Task 2) proves it's
// actually mounted in the real app.
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { apiRateLimit } from '../src/middleware/rateLimit';

function appWithUserId(userId: number | undefined) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { userId?: number } }>();
  app.use('*', async (c, next) => {
    if (userId != null) c.set('userId', userId);
    await next();
  });
  app.use('*', apiRateLimit);
  app.get('/probe', (c) => c.json({ ok: true }));
  return app;
}

// Pre-seeding KV directly at a known count avoids looping 600 real requests
// per test — rateLimitAllow's own window-bucketing logic is already covered
// by the existing login-flow tests in test-workers/auth.test.ts; this file
// only needs to prove apiRateLimit wires userId -> bucket -> response
// correctly, which a single pre-seeded read/write exercises just as well.
function currentWindowStart(windowSeconds: number): number {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % windowSeconds);
}

describe('apiRateLimit middleware', () => {
  it('allows a request well under the limit', async () => {
    const userId = 1001;
    const windowStart = currentWindowStart(300);
    await env.KV.put(`rl:api:user:${userId}:${windowStart}`, '5', { expirationTtl: 600 });

    const app = appWithUserId(userId);
    const res = await app.request('/probe', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
  });

  it('blocks with 429 once the count has reached the limit', async () => {
    const userId = 1002;
    const windowStart = currentWindowStart(300);
    await env.KV.put(`rl:api:user:${userId}:${windowStart}`, '600', { expirationTtl: 600 });

    const app = appWithUserId(userId);
    const res = await app.request('/probe', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ error: 'Too many requests. Slow down and try again shortly.', code: 'RATE_LIMITED' });
  });

  it('is a no-op (always allows) when userId is absent', async () => {
    const app = appWithUserId(undefined);
    const res = await app.request('/probe', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
  });
});
