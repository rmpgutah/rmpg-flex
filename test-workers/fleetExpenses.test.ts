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
