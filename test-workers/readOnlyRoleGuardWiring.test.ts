// Proves readOnlyRoleGuard is actually MOUNTED in the real app, not just
// correct in isolation (test-workers/auth.test.ts already covers the
// function's own logic against a standalone test Hono instance). This
// imports `app` straight from src/index.ts — same pattern as
// test-workers/scrapersMount.test.ts, which caught a router-mounted-but-
// unreachable bug that isolated-harness tests couldn't see. The guard
// is middleware, so when it's wired it short-circuits BEFORE any route
// handler's own logic runs — meaning a POST from a client_viewer to
// ANY auth-required path will get the guard's exact response body,
// regardless of what that specific handler would otherwise do. That
// makes the assertion below robust to picking any real, already-proven-
// reachable auth-required route rather than needing a special "unguarded"
// one.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
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

describe('readOnlyRoleGuard — wired into the real app', () => {
  beforeAll(async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    await execute(db, `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL,
      full_name TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    )`);
    await execute(db,
      `INSERT INTO users (username, role, full_name, status) VALUES ('viewer-wiring-test', 'client_viewer', 'Viewer Test', 'active')`);
  });

  it('blocks a client_viewer POST to a real auth-required route with the guard\'s exact response', async () => {
    const viewer = await getDb(env as unknown as { DB: D1Database })
      .prepare(`SELECT id FROM users WHERE username = 'viewer-wiring-test'`)
      .first<{ id: number }>();
    const token = await mintAccessToken(viewer!.id, 'client_viewer', 'viewer-wiring-test');

    // /api/warrants/scrapers is a real, already-proven-reachable
    // auth-required route (see test-workers/scrapersMount.test.ts).
    const res = await app.request(
      '/api/warrants/scrapers',
      { method: 'POST', headers: { authorization: `Bearer ${token}` } },
      testEnv(),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Read-only role cannot modify data', code: 'FORBIDDEN' });
  });

  it('does not block a client_viewer GET to the same route (guard only gates mutating methods)', async () => {
    const viewer = await getDb(env as unknown as { DB: D1Database })
      .prepare(`SELECT id FROM users WHERE username = 'viewer-wiring-test'`)
      .first<{ id: number }>();
    const token = await mintAccessToken(viewer!.id, 'client_viewer', 'viewer-wiring-test');

    const res = await app.request(
      '/api/warrants/scrapers',
      { method: 'GET', headers: { authorization: `Bearer ${token}` } },
      testEnv(),
    );

    // Not 403 with the guard's body — whatever warrants.ts's own GET
    // handling does for this role (its own router-level exclusion, a
    // real response, etc.) is out of scope here; the point is the
    // guard itself must not be the thing blocking a read.
    if (res.status === 403) {
      const body = await res.json();
      expect(body).not.toEqual({ error: 'Read-only role cannot modify data', code: 'FORBIDDEN' });
    }
  });
});
