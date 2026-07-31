// Route-level test (Miniflare/workerd) for GET /api/fleet/financial/cpm-trend.
//
// The endpoint shipped `0 as maint_cost` hardcoded, so cost-per-mile reported
// FUEL-only cost while still exposing a maint_cost field. Live D1 has real
// maintenance spend, so every CPM figure was understated.
//
// The interesting part is the fix's shape: maintenance is joined as a
// per-MONTH total onto a per-VEHICLE-per-month fuel subquery, so the join
// repeats that single total once per vehicle in the month. Aggregating it with
// SUM would multiply maintenance by the vehicle count; MAX collapses the
// duplicates back to the true total. On live data today every month happens to
// have exactly ONE fuelled vehicle, which makes SUM and MAX indistinguishable
// there — the bug would only appear as the fleet grows. This test seeds TWO
// vehicles in the same month specifically so that regression is caught now
// rather than discovered later from a doubled cost report.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import fleet from '../src/routes/fleet';

const app = new Hono<{
  Bindings: Record<string, unknown>;
  Variables: { user: { id: number; role: string; username: string }; userId: number };
}>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-admin' });
  c.set('userId', 1);
  await next();
});
app.route('/api/fleet', fleet);

const db = () => (env as unknown as { DB: D1Database }).DB;

// Same month for both vehicles — that collision is the point of the fixture.
const MONTH_DAY = (d: string) => `2026-03-${d}`;

beforeAll(async () => {
  // Mirrors the live columns this endpoint touches, INCLUDING both of
  // fleet_maintenance's date columns (performed_at is the populated one on
  // live; service_date exists and is the fallback).
  await execute(db(), `CREATE TABLE IF NOT EXISTS fleet_maintenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, cost REAL,
    performed_at TEXT, service_date TEXT
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS fleet_fuel_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, gallons REAL,
    total_cost REAL, odometer INTEGER, fuel_date TEXT
  )`);
  await execute(db(), 'DELETE FROM fleet_maintenance');
  await execute(db(), 'DELETE FROM fleet_fuel_log');

  // Vehicle 1 drives 1000 miles on $100 of fuel; vehicle 2 drives 1000 on $100.
  await execute(db(), `INSERT INTO fleet_fuel_log (vehicle_id, total_cost, odometer, fuel_date) VALUES
    (1, 50, 1000, '${MONTH_DAY('01')}'), (1, 50, 2000, '${MONTH_DAY('20')}'),
    (2, 50, 5000, '${MONTH_DAY('02')}'), (2, 50, 6000, '${MONTH_DAY('21')}')`);

  // ONE maintenance record of 300 for the month. performed_at populated.
  await execute(db(), `INSERT INTO fleet_maintenance (vehicle_id, cost, performed_at) VALUES
    (1, 300, '${MONTH_DAY('15')}')`);
});

const getTrend = async () => {
  const res = await app.request('/api/fleet/financial/cpm-trend', {}, env as unknown as Record<string, unknown>);
  expect(res.status).toBe(200);
  const rows = await res.json() as Array<Record<string, number>>;
  return rows.find((r) => String(r.month) === '2026-03');
};

describe('GET /api/fleet/financial/cpm-trend', () => {
  it('reports the real maintenance cost instead of a hardcoded 0', async () => {
    const row = await getTrend();
    expect(row).toBeDefined();
    expect(Number(row!.maint_cost)).toBeCloseTo(300, 2);
  });

  it('does NOT multiply the monthly maintenance total by the vehicle count', async () => {
    // Two vehicles fuelled this month. A SUM over the joined rows would report
    // 600; the true total is 300.
    const row = await getTrend();
    expect(Number(row!.maint_cost)).not.toBeCloseTo(600, 2);
    expect(Number(row!.maint_cost)).toBeCloseTo(300, 2);
  });

  it('folds maintenance into cost-per-mile, not just fuel', async () => {
    const row = await getTrend();
    // Each vehicle: 2 × $50 fuel and 1000 miles. Month totals are therefore
    // $200 fuel and 2000 miles, so (200 + 300) / 2000 = $0.25/mile. Fuel alone
    // would be 0.10 — that gap is what the hardcoded 0 was hiding.
    expect(Number(row!.fuel_cost)).toBeCloseTo(200, 2);
    expect(Number(row!.miles)).toBe(2000);
    expect(Number(row!.cpm)).toBeCloseTo(0.25, 2);
  });

  it('falls back to service_date when performed_at is null', async () => {
    await execute(db(), `INSERT INTO fleet_maintenance (vehicle_id, cost, performed_at, service_date)
                         VALUES (2, 100, NULL, '${MONTH_DAY('16')}')`);
    const row = await getTrend();
    expect(Number(row!.maint_cost)).toBeCloseTo(400, 2);
    await execute(db(), 'DELETE FROM fleet_maintenance WHERE cost = 100');
  });
});
