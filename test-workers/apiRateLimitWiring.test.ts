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
    await env.KV.put(`rl:api:user:${user!.id}:${windowStart}`, '600', { expirationTtl: 600 });

    const res = await app.request(
      '/api/warrants/scrapers',
      { headers: { authorization: `Bearer ${token}` } },
      testEnv(),
    );

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ error: 'Too many requests. Slow down and try again shortly.', code: 'RATE_LIMITED' });
  });

  it('does not rate-limit a user whose bucket is fresh', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    await execute(db,
      `INSERT INTO users (username, role, full_name, status) VALUES ('rate-limit-fresh-test', 'admin', 'Fresh Test', 'active')`);
    const user = await db.prepare(`SELECT id FROM users WHERE username = 'rate-limit-fresh-test'`).first<{ id: number }>();
    const token = await mintAccessToken(user!.id, 'admin', 'rate-limit-fresh-test');

    const res = await app.request(
      '/api/warrants/scrapers',
      { headers: { authorization: `Bearer ${token}` } },
      testEnv(),
    );

    expect(res.status).not.toBe(429);
  });
});
