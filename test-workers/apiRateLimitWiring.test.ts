// Proves apiRateLimit is actually MOUNTED in the real app, not just correct
// in isolation (test-workers/rateLimitMiddleware.test.ts already covers the
// middleware's own logic). Same pattern as
// test-workers/readOnlyRoleGuardWiring.test.ts — imports `app` straight from
// src/index.ts and exercises it through a real, already-proven-reachable
// auth-required route (/api/warrants/scrapers, see
// test-workers/scrapersMount.test.ts).
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { app } from '../src/index';
import { sign } from 'hono/jwt';
import { getDb, execute } from '../src/utils/db';
import { API_RATE_LIMIT } from '../src/middleware/rateLimit';

const SECRET = 'test-jwt-secret-do-not-use-in-prod';

async function mintAccessToken(userId: number, role: string, username: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: String(userId), user_id: userId, userId, username, role, iat: now, exp: now + 900, type: 'access' }, SECRET);
}

function testEnv() {
  return { ...(env as unknown as Record<string, unknown>), JWT_SECRET: SECRET };
}

function currentWindowStart(windowSeconds: number): number {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % windowSeconds);
}

describe('apiRateLimit — wired into the real app', () => {
  it('returns 429 once a user\'s bucket is already at the limit', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    await execute(db, `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL,
      full_name TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    )`);
    await execute(db,
      `INSERT INTO users (username, role, full_name, status) VALUES ('rate-limit-wiring-test', 'admin', 'Rate Limit Test', 'active')`);
    const user = await db.prepare(`SELECT id FROM users WHERE username = 'rate-limit-wiring-test'`).first<{ id: number }>();
    const token = await mintAccessToken(user!.id, 'admin', 'rate-limit-wiring-test');

    const windowStart = currentWindowStart(300);
    await env.KV.put(`rl:api:user:${user!.id}:${windowStart}`, String(API_RATE_LIMIT), { expirationTtl: 600 });

    const res = await app.request(
      '/api/warrants/scrapers',
      { headers: { authorization: `Bearer ${token}` } },
      testEnv(),
    );

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ error: 'Too many requests. Slow down and try again shortly.', code: 'RATE_LIMITED' });
  });

  it('the SAME user/route only starts returning 429 after their bucket is pre-seeded at the limit', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    await execute(db,
      `INSERT INTO users (username, role, full_name, status) VALUES ('rate-limit-differential-test', 'admin', 'Differential Test', 'active')`);
    const user = await db.prepare(`SELECT id FROM users WHERE username = 'rate-limit-differential-test'`).first<{ id: number }>();
    const token = await mintAccessToken(user!.id, 'admin', 'rate-limit-differential-test');

    // First request: bucket is fresh (nothing pre-seeded). Whatever this
    // route's own downstream handler does in this test's isolated D1
    // (200, 404, 500 — it doesn't matter), the rate limiter itself must
    // not be the thing blocking it.
    const before = await app.request(
      '/api/warrants/scrapers',
      { headers: { authorization: `Bearer ${token}` } },
      testEnv(),
    );
    expect(before.status).not.toBe(429);

    // Now pre-seed the SAME user's bucket at the limit and repeat the
    // identical request. Only the KV state changed — if the response now
    // flips to 429 with the rate limiter's exact body, that's directly
    // attributable to apiRateLimit, not to anything about the route itself
    // (which just returned a non-429 status for this exact same user a
    // moment ago).
    const windowStart = currentWindowStart(300);
    await env.KV.put(`rl:api:user:${user!.id}:${windowStart}`, String(API_RATE_LIMIT), { expirationTtl: 600 });

    const after = await app.request(
      '/api/warrants/scrapers',
      { headers: { authorization: `Bearer ${token}` } },
      testEnv(),
    );
    expect(after.status).toBe(429);
    const afterBody = await after.json();
    expect(afterBody).toEqual({ error: 'Too many requests. Slow down and try again shortly.', code: 'RATE_LIMITED' });
  });
});
