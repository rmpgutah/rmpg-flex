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

describe('GET /api/court/lookups', () => {
  it('returns only active items by default, ordered by display_order', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/court/lookups?category=court', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ value: string; is_active: number }>;
    expect(body).toHaveLength(1);
    expect(body[0].value).toBe('third-district');
  });

  it('includes inactive items when includeInactive=true', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/court/lookups?category=court&includeInactive=true', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as Array<{ value: string }>;
    expect(body).toHaveLength(2);
    expect(body.map((r) => r.value)).toEqual(['third-district', 'justice-court']);
  });
});

describe('POST /api/court/lookups', () => {
  it('rejects non-admin roles', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/court/lookups', {
      method: 'POST',
      body: JSON.stringify({ category: 'outcome', value: 'guilty', display_label: 'Guilty' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('creates a new lookup row as admin', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/court/lookups', {
      method: 'POST',
      body: JSON.stringify({ category: 'outcome', value: 'guilty', display_label: 'Guilty', display_order: 10 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: number };
    expect(typeof body.id).toBe('number');

    const listRes = await app.request('/api/court/lookups?category=outcome', {}, env as unknown as Record<string, unknown>);
    const list = await listRes.json() as Array<{ value: string }>;
    expect(list.map((r) => r.value)).toContain('guilty');
  });

  it('rejects a request missing value', async () => {
    const app = buildApp('admin');
    const res = await app.request('/api/court/lookups', {
      method: 'POST',
      body: JSON.stringify({ category: 'outcome' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
  });
});
