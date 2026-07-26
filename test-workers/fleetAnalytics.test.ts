// test-workers/fleetAnalytics.test.ts
//
// Route-level test (Miniflare/workerd) for GET /api/fleet/analytics —
// specifically the ?vehicle_id= scoping added so the per-vehicle
// Analytics tab stops showing fleet-wide aggregates under per-vehicle
// labels. Two vehicles are seeded with clearly different maintenance
// and fuel numbers so a swapped or missing bind (wrong vehicle, or no
// scoping at all) fails the assertions rather than coincidentally
// passing.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import fleet from '../src/routes/fleet';
import { FLEET_ONLY_BLOCKS } from '../src/utils/fleetAnalyticsScope';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-admin' });
  c.set('userId', 1);
  await next();
});
app.route('/api/fleet', fleet);

let vehicleA: number;
let vehicleB: number;

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;

  await execute(db, `CREATE TABLE IF NOT EXISTS fleet_vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_number TEXT, make TEXT, model TEXT, year INTEGER,
    current_mileage INTEGER, status TEXT, archived_at TEXT, assigned_unit_id INTEGER,
    next_service_due TEXT, next_service_mileage INTEGER
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS fleet_maintenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, type TEXT, cost REAL, performed_at TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS fleet_fuel_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, gallons REAL, total_cost REAL,
    odometer INTEGER, fuel_date TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS fleet_inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, overall_result TEXT, inspection_date TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS gps_breadcrumbs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, unit_id INTEGER, speed REAL, recorded_at TEXT
  )`);

  // Vehicle A: high-cost maintenance, low MPG.
  const a = await db.prepare(
    `INSERT INTO fleet_vehicles (vehicle_number, make, model, year, current_mileage, status, archived_at)
     VALUES ('A-100', 'Ford', 'Explorer', 2019, 50000, 'in_service', NULL)`,
  ).run();
  vehicleA = Number(a.meta.last_row_id);

  // Vehicle B: low-cost maintenance, high MPG.
  const b = await db.prepare(
    `INSERT INTO fleet_vehicles (vehicle_number, make, model, year, current_mileage, status, archived_at)
     VALUES ('B-200', 'Chevrolet', 'Tahoe', 2021, 20000, 'in_service', NULL)`,
  ).run();
  vehicleB = Number(b.meta.last_row_id);

  // Maintenance: A totals 9000, B totals 100. Distinct 'type' per vehicle
  // so top_issues can't coincidentally match across vehicles.
  await db.prepare(
    `INSERT INTO fleet_maintenance (vehicle_id, type, cost, performed_at) VALUES (?, 'brakes', 9000, datetime('now'))`,
  ).bind(vehicleA).run();
  await db.prepare(
    `INSERT INTO fleet_maintenance (vehicle_id, type, cost, performed_at) VALUES (?, 'oil_change', 100, datetime('now'))`,
  ).bind(vehicleB).run();

  // Fuel logs: A drives 200 miles on 20 gal (10 MPG); B drives 800 miles on
  // 20 gal (40 MPG) — deliberately far apart so a wrong-vehicle MPG can't
  // pass by coincidence.
  await db.prepare(
    `INSERT INTO fleet_fuel_log (vehicle_id, gallons, total_cost, odometer, fuel_date) VALUES (?, 10, 40, 10000, date('now', '-10 days'))`,
  ).bind(vehicleA).run();
  await db.prepare(
    `INSERT INTO fleet_fuel_log (vehicle_id, gallons, total_cost, odometer, fuel_date) VALUES (?, 10, 40, 10200, date('now'))`,
  ).bind(vehicleA).run();
  await db.prepare(
    `INSERT INTO fleet_fuel_log (vehicle_id, gallons, total_cost, odometer, fuel_date) VALUES (?, 10, 30, 5000, date('now', '-10 days'))`,
  ).bind(vehicleB).run();
  await db.prepare(
    `INSERT INTO fleet_fuel_log (vehicle_id, gallons, total_cost, odometer, fuel_date) VALUES (?, 10, 30, 5800, date('now'))`,
  ).bind(vehicleB).run();
});

describe('GET /api/fleet/analytics — unscoped (fleet-wide)', () => {
  it('reports scope=fleet, null fleet_comparison, and no omissions', async () => {
    const res = await app.request('/api/fleet/analytics', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { scope: string; fleet_comparison: unknown; omitted_for_vehicle_scope: string[] };
    expect(body.scope).toBe('fleet');
    expect(body.fleet_comparison).toBeNull();
    expect(body.omitted_for_vehicle_scope).toEqual([]);
  });
});

describe('GET /api/fleet/analytics — scoped to a single vehicle', () => {
  it('returns ONLY that vehicle\'s maintenance total and its own MPG, not the fleet total', async () => {
    const res = await app.request(`/api/fleet/analytics?vehicle_id=${vehicleA}`, {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      fleet_summary: { total_maintenance_cost: number; avg_mpg: number | null };
      top_issues: Array<{ type: string; total_cost: number }>;
    };
    // Vehicle A's own maintenance total is 9000 — NOT the fleet total (9100).
    expect(body.fleet_summary.total_maintenance_cost).toBe(9000);
    // Vehicle A's own MPG is 10 (200 miles / 20 gal) — NOT vehicle B's 40
    // and not some fleet-wide blend.
    expect(body.fleet_summary.avg_mpg).toBe(10);
    // top_issues should show only vehicle A's 'brakes' entry, not B's 'oil_change'.
    expect(body.top_issues).toHaveLength(1);
    expect(body.top_issues[0].type).toBe('brakes');
    expect(body.top_issues[0].total_cost).toBe(9000);
  });

  it('reports scope=vehicle, a non-null fleet_comparison, and correctly zeroed omissions', async () => {
    const res = await app.request(`/api/fleet/analytics?vehicle_id=${vehicleA}`, {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as Record<string, unknown> & {
      scope: string;
      fleet_comparison: unknown;
      omitted_for_vehicle_scope: string[];
    };
    expect(body.scope).toBe('vehicle');
    expect(body.fleet_comparison).not.toBeNull();
    expect(body.omitted_for_vehicle_scope.length).toBeGreaterThan(0);

    // Every block FLEET_ONLY_BLOCKS names is either absent from the payload
    // or present with its documented zero value.
    const ZERO_VALUES: Record<string, unknown> = {
      mileage_distribution: [],
      status_breakdown: [],
      utilization: { assigned: 0, unassigned: 0, rate: 0 },
      service_compliance: { compliant: 0, overdue: 0, rate: 100 },
      cost_per_mile_ranking: [],
      fuel_economy_ranking: [],
      oldest_vehicle_year: null,
    };
    for (const name of FLEET_ONLY_BLOCKS) {
      expect(body.omitted_for_vehicle_scope).toContain(name);
      if (name in body) {
        expect(body[name]).toEqual(ZERO_VALUES[name]);
      }
    }
  });

  it('scopes maintenance_forecast and avg_daily_miles to the single vehicle', async () => {
    // Give vehicle A a service target so it shows up in the forecast.
    const db = (env as unknown as { DB: D1Database }).DB;
    await db.prepare(`UPDATE fleet_vehicles SET next_service_mileage = 60000 WHERE id = ?`).bind(vehicleA).run();

    const res = await app.request(`/api/fleet/analytics?vehicle_id=${vehicleA}`, {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as {
      maintenance_forecast: Array<{ id: number }>;
      avg_daily_miles: number | null;
    };
    // Only vehicle A's forecast row — not one per active vehicle in the fleet.
    expect(body.maintenance_forecast.every((r) => r.id === vehicleA)).toBe(true);
    // Vehicle A's own daily-miles rate (200 miles / 10 days = 20), not a fleet blend.
    expect(body.avg_daily_miles).toBe(20);
  });
});

describe('GET /api/fleet/analytics — invalid vehicle_id', () => {
  it('falls back to fleet-wide rather than erroring', async () => {
    const res = await app.request('/api/fleet/analytics?vehicle_id=abc', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { scope: string };
    expect(body.scope).toBe('fleet');
  });
});
