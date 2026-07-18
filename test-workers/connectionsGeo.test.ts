// test-workers/connectionsGeo.test.ts
//
// Read-only GPS-track and geo-point endpoints backing the map overlay
// panel. GPS never becomes graph NODES (too high-volume — see the
// design spec's non-goals) — this is purely a detail view for whatever
// node is currently selected in the graph.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import connections from '../src/routes/connections';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-analyst' });
  c.set('userId', 1);
  await next();
});
app.route('/api/connections', connections);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT, role TEXT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS units (id INTEGER PRIMARY KEY AUTOINCREMENT, call_sign TEXT, officer_id INTEGER)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS gps_breadcrumbs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, unit_id INTEGER, officer_id INTEGER,
    latitude REAL, longitude REAL, current_call_id INTEGER,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS alpr_captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plate TEXT, lat REAL, lng REAL,
    call_id INTEGER, incident_id INTEGER, vehicle_record_ids TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `INSERT INTO users (id, full_name, role) VALUES (1, 'Test Analyst', 'admin')`);
  await execute(db, `INSERT INTO units (id, call_sign, officer_id) VALUES (1, 'P12', 5)`);
  await execute(db, `INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude) VALUES (1, 5, 40.76, -111.89)`);
  await execute(db, `INSERT INTO alpr_captures (plate, lat, lng, call_id) VALUES ('8JAR3', 40.77, -111.90, 42)`);
});

describe('Map overlay endpoints', () => {
  it('GET /connections/person/5/gps-track returns breadcrumbs for the officer\'s units', async () => {
    const res = await app.request('/api/connections/person/5/gps-track', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ lat: number; lng: number }> };
    expect(body.data.length).toBe(1);
    expect(body.data[0].lat).toBeCloseTo(40.76);
  });

  it('GET /connections/call/42/geo-points returns ALPR pins for the call', async () => {
    const res = await app.request('/api/connections/call/42/geo-points', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ lat: number; lng: number; source: string }> };
    expect(body.data.length).toBe(1);
    expect(body.data[0].source).toBe('alpr');
  });
});
