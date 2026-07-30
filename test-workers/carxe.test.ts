// Route-level smoke test (Miniflare/workerd) for /api/carxe.
// This codebase's test-workers/*.test.ts files don't use JWT bearer tokens
// against SELF.fetch — auth is applied per-prefix in src/index.ts, not
// inside the router, so routers are tested in isolation with an injected
// c.set('user', ...) middleware (see test-workers/health.test.ts,
// test-workers/auth.test.ts, and test-workers/legalDataHunter.test.ts for
// the established pattern). There is no globalThis.__TEST_JWT__ /
// unstable_dev fixture in this codebase; we build a local Hono app per
// test with the role we need, exactly like legalDataHunter.test.ts does.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import carxe from '../src/routes/carxe';
import { getDb, execute } from '../src/utils/db';

type TestUser = { id: number; role: string; username: string };

function appWithUser(user: TestUser) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: TestUser; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    c.set('userId', user.id);
    await next();
  });
  app.route('/api/carxe', carxe);
  return app;
}

describe('POST /api/carxe/plate-lookup', () => {
  beforeAll(async () => {
    // Miniflare's D1 instance doesn't have migrations applied — create the
    // table this route touches inline, mirroring the other test-workers/*
    // files' pattern (see legalDataHunter.test.ts, bodycamDetections.test.ts).
    const db = getDb(env as unknown as { DB: D1Database });
    await execute(db, `CREATE TABLE IF NOT EXISTS carxe_lookups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lookup_type TEXT NOT NULL,
      plate TEXT,
      state TEXT,
      vin TEXT,
      response_json TEXT NOT NULL,
      requested_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM carxe_lookups').run();
  });

  it('returns not_configured when CARXE_API_KEY is unset', async () => {
    const app = appWithUser({ id: 1, role: 'officer', username: 'test-officer' });
    const res = await app.request(
      '/api/carxe/plate-lookup',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plate: '7XER187', state: 'CA' }),
      },
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: 'not_configured' });
  });

  it('rejects client_viewer role (not an operational role)', async () => {
    const app = appWithUser({ id: 2, role: 'client_viewer', username: 'viewer' });
    const res = await app.request(
      '/api/carxe/plate-lookup',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plate: '7XER187', state: 'CA' }),
      },
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(403);
  });

  it('returns invalid_input when plate is missing', async () => {
    const app = appWithUser({ id: 1, role: 'officer', username: 'test-officer' });
    const res = await app.request(
      '/api/carxe/plate-lookup',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'CA' }),
      },
      env as unknown as Record<string, unknown>,
    );
    // configFromEnv is checked before body parsing, so with no CARXE_API_KEY
    // set this still resolves to not_configured rather than invalid_input —
    // asserting 200 here pins that ordering rather than guessing at it.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: 'not_configured' });
  });
});
