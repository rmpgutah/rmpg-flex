// Route-level regression test (Miniflare/workerd) for /api/fleet/:vehicleId/expenses
// and /api/fleet/expenses/:id — backing FleetExpensesTab.tsx.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import fleet from '../src/routes/fleet';

function buildApp(role: string) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, role, username: 'test-user' });
    c.set('userId', 1);
    await next();
  });
  app.route('/api/fleet', fleet);
  return app;
}

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS fleet_vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_name TEXT, archived_at TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS fleet_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER NOT NULL, expense_date TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN (
      'registration','tolls','parking','car_wash','tickets','towing','permits',
      'insurance','equipment','decals_wraps','storage','roadside_assistance',
      'inspection','electronics','accessories','misc'
    )),
    amount REAL NOT NULL, vendor TEXT, description TEXT, receipt_path TEXT, odometer_reading INTEGER,
    recurring INTEGER NOT NULL DEFAULT 0, recurring_frequency TEXT, notes TEXT, created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), archived_at TEXT
  )`);
  await execute(db, `INSERT INTO fleet_vehicles (id, vehicle_name) VALUES (1, 'Unit 7')`);
  await execute(db, `INSERT INTO fleet_expenses (vehicle_id, expense_date, category, amount, vendor)
    VALUES (1, '2026-06-01', 'tolls', 4.50, 'UDOT Express Lanes')`);
  await execute(db, `INSERT INTO fleet_expenses (vehicle_id, expense_date, category, amount, vendor)
    VALUES (1, '2026-06-15', 'registration', 89.00, 'Utah DMV')`);
});

describe('GET /api/fleet/:vehicleId/expenses', () => {
  it('lists expenses for a vehicle, newest first', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/fleet/1/expenses', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ category: string; expense_date: string }> };
    expect(body.data).toHaveLength(2);
    expect(body.data[0].expense_date).toBe('2026-06-15');
  });

  it('returns an empty list for a vehicle with no expenses', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/fleet/999/expenses', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});

describe('POST /api/fleet/:vehicleId/expenses', () => {
  it('rejects non-manager roles (router-level write gate)', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/fleet/1/expenses', {
      method: 'POST',
      body: JSON.stringify({ expense_date: '2026-07-01', category: 'towing', amount: 150 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('creates an expense as manager', async () => {
    const app = buildApp('manager');
    const res = await app.request('/api/fleet/1/expenses', {
      method: 'POST',
      body: JSON.stringify({ expense_date: '2026-07-01', category: 'towing', amount: 150, vendor: 'AAA' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: number };
    expect(typeof body.id).toBe('number');

    const listRes = await app.request('/api/fleet/1/expenses', {}, env as unknown as Record<string, unknown>);
    const list = await listRes.json() as { data: Array<{ category: string; created_by: number | null }> };
    expect(list.data.map((r) => r.category)).toContain('towing');
    const created = list.data.find((r) => r.category === 'towing');
    expect(created?.created_by).toBe(1);
  });

  it('rejects an invalid category', async () => {
    const app = buildApp('manager');
    const res = await app.request('/api/fleet/1/expenses', {
      method: 'POST',
      body: JSON.stringify({ expense_date: '2026-07-01', category: 'not_a_real_category', amount: 10 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(409);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('db_constraint');
  });

  it('rejects a request missing amount', async () => {
    const app = buildApp('manager');
    const res = await app.request('/api/fleet/1/expenses', {
      method: 'POST',
      body: JSON.stringify({ expense_date: '2026-07-01', category: 'misc' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/fleet/expenses/:id', () => {
  it('rejects non-manager roles', async () => {
    const app = buildApp('officer');
    const res = await app.request('/api/fleet/expenses/1', {
      method: 'PUT',
      body: JSON.stringify({ amount: 999 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('updates an expense as manager', async () => {
    const app = buildApp('manager');
    const res = await app.request('/api/fleet/expenses/1', {
      method: 'PUT',
      body: JSON.stringify({ amount: 5.00, vendor: 'Updated Vendor' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    const listRes = await app.request('/api/fleet/1/expenses', {}, env as unknown as Record<string, unknown>);
    const list = await listRes.json() as { data: Array<{ id: number; amount: number; vendor: string }> };
    const updated = list.data.find((r) => r.id === 1);
    expect(updated?.amount).toBe(5.00);
    expect(updated?.vendor).toBe('Updated Vendor');
  });

  it('returns 404 for a missing id', async () => {
    const app = buildApp('manager');
    const res = await app.request('/api/fleet/expenses/9999', {
      method: 'PUT',
      body: JSON.stringify({ amount: 1 }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(404);
  });
});
