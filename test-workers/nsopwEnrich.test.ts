// Route-level regression test (Miniflare/workerd) for POST /api/nsopw/enrich.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import nsopw from '../src/routes/nsopw';

function buildApp(role: string) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, role, username: 'test-user' });
    c.set('userId', 1);
    await next();
  });
  app.route('/api/nsopw', nsopw);
  return app;
}

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS national_sex_offenders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, jurisdiction TEXT, detail_url TEXT,
    offense TEXT, risk_level TEXT, tier INTEGER, registration_status TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS sor_enrichment_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, offender_id INTEGER NOT NULL, jurisdiction TEXT NOT NULL,
    detail_url TEXT NOT NULL, success INTEGER NOT NULL DEFAULT 0, http_status INTEGER,
    error_message TEXT, parsed_offense TEXT, parsed_risk_level TEXT, raw_snippet TEXT,
    attempted_at TEXT DEFAULT (datetime('now'))
  )`);
  await execute(db, `INSERT INTO national_sex_offenders (jurisdiction, detail_url) VALUES ('UT', 'https://example.com/ut/1')`);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/nsopw/enrich', () => {
  it('rejects non-admin roles', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/nsopw/enrich', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('runs a batch and returns a summary', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      text: async () => '<p>Offense: Test Offense</p><p>Risk Level: Low</p>',
    } as Response);

    const app = buildApp('admin');
    const res = await app.request('/api/nsopw/enrich', { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { attempted: number; succeeded: number; failed: number };
    expect(body.attempted).toBe(1);
    expect(body.succeeded).toBe(1);
  });
});
