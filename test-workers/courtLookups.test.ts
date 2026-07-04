// Route-level regression test (Miniflare/workerd) for /api/court/lookups —
// backing AdminCourtLookupsTab.tsx's editable dropdown management.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import court from '../src/routes/court';

function buildApp(role: string) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, role, username: 'test-user' });
    c.set('userId', 1);
    await next();
  });
  app.route('/api/court', court);
  return app;
}

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS court_lookups (
    id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, value TEXT NOT NULL,
    display_label TEXT, meta TEXT, display_order INTEGER NOT NULL DEFAULT 100,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`);
  await execute(db, `INSERT INTO court_lookups (category, value, display_label, display_order, is_active)
    VALUES ('court', 'third-district', 'Third District Court', 10, 1)`);
  await execute(db, `INSERT INTO court_lookups (category, value, display_label, display_order, is_active)
    VALUES ('court', 'justice-court', 'Justice Court', 20, 0)`);
  await execute(db, `INSERT INTO court_lookups (category, value, display_label, display_order, is_active)
    VALUES ('judge', 'smith', 'Judge Smith', 10, 1)`);
});

describe('GET /api/court/lookups/categories', () => {
  it('returns distinct categories with counts', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/court/lookups/categories', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ category: string; count: number }>;
    const court = body.find((c) => c.category === 'court');
    const judge = body.find((c) => c.category === 'judge');
    expect(court?.count).toBe(2);
    expect(judge?.count).toBe(1);
  });
});
