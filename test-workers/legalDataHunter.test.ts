// Route-level smoke test (Miniflare/workerd) for /api/legal-data-hunter.
// This codebase's test-workers/*.test.ts files don't use JWT bearer tokens
// against SELF.fetch — auth is applied per-prefix in src/index.ts, not
// inside the router, so routers are tested in isolation with an injected
// c.set('user', ...) middleware (see test-workers/health.test.ts and
// test-workers/auth.test.ts for the established pattern). There is no
// globalThis.__TEST_JWT__ / __TEST_CLIENT_VIEWER_JWT__ fixture in this
// codebase; we build a local Hono app per test with the role we need.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import legalDataHunter from '../src/routes/legalDataHunter';
import { getDb, execute } from '../src/utils/db';

type TestUser = { id: number; role: string; username: string };

function appWithUser(user: TestUser) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: TestUser; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    c.set('userId', user.id);
    await next();
  });
  app.route('/api/legal-data-hunter', legalDataHunter);
  return app;
}

describe('POST /api/legal-data-hunter/validate', () => {
  beforeAll(async () => {
    // Miniflare's D1 instance doesn't have migrations applied — create the
    // tables this route touches inline, mirroring the other test-workers/*
    // files' pattern (see bodycamDetections.test.ts, connectionsAlpr.test.ts).
    const db = getDb(env as unknown as { DB: D1Database });
    await execute(db, `CREATE TABLE IF NOT EXISTS legal_charge_validations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      charge_text TEXT NOT NULL,
      charge_text_normalized TEXT NOT NULL,
      state TEXT,
      warrant_id INTEGER,
      source TEXT NOT NULL,
      match_found INTEGER NOT NULL,
      matched_title TEXT,
      matched_citation TEXT,
      matched_source_url TEXT,
      raw_response TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(charge_text_normalized, state)
    )`);
    await execute(db, `CREATE TABLE IF NOT EXISTS utah_statutes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      citation TEXT,
      short_title TEXT,
      description TEXT,
      source_url TEXT,
      is_active INTEGER DEFAULT 1
    )`);
  });

  beforeEach(async () => {
    // Clean cache table between tests.
    await env.DB.prepare('DELETE FROM legal_charge_validations').run();
  });

  it('returns not_configured when LEGAL_DATA_HUNTER_API_KEY is unset', async () => {
    const app = appWithUser({ id: 1, role: 'officer', username: 'test-officer' });
    const res = await app.request(
      '/api/legal-data-hunter/validate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ charge: 'Assault by a Prisoner', state: 'NV' }),
      },
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: false, code: 'not_configured' });
  });

  it('returns bad_request when charge is missing', async () => {
    const app = appWithUser({ id: 1, role: 'officer', username: 'test-officer' });
    const res = await app.request(
      '/api/legal-data-hunter/validate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'UT' }),
      },
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(400);
  });

  it('rejects client_viewer role', async () => {
    const app = appWithUser({ id: 2, role: 'client_viewer', username: 'viewer' });
    const res = await app.request(
      '/api/legal-data-hunter/validate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ charge: 'Theft', state: 'UT' }),
      },
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(403);
  });

  it('matches a realistic charge string against a local utah_statutes row (Fix 1)', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    // Realistic-shaped row: short citation/short_title, like the real seeded
    // utah_statutes table — not the full charge text.
    await execute(db,
      `INSERT INTO utah_statutes (citation, short_title, description, source_url, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      '76-6-404', 'Theft, generally', 'Theft of property or services.', 'https://le.utah.gov/xcode/Title76/Chapter6/76-6-S404.html',
    );

    const app = appWithUser({ id: 1, role: 'officer', username: 'test-officer' });
    const res = await app.request(
      '/api/legal-data-hunter/validate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Uses the same "charge text contains the statute's short_title"
        // direction the Fix 1 matcher relies on (charge LIKE '%'||short_title||'%').
        body: JSON.stringify({ charge: 'THEFT, GENERALLY - 3RD DEGREE FELONY', state: 'UT' }),
      },
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      source: 'local_statute',
      match_found: true,
      matched_title: 'Theft, generally',
      matched_citation: '76-6-404',
      matched_source_url: 'https://le.utah.gov/xcode/Title76/Chapter6/76-6-S404.html',
    });
  });
});
