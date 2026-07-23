// Route-level regression test (Miniflare/workerd) for POST /api/dispatch/gps.
// Verifies server-side bounds validation on accuracy/heading/speed (nulled,
// not dropped) and the speed-jump flag against the unit's last known
// position — defense-in-depth against a compromised/buggy client, since
// previously all such filtering was client-side only (useGpsTracking.ts).
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute, queryFirst } from '../src/utils/db';
import gps from '../src/routes/dispatch/gps';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'officer', username: 'test-officer' });
  c.set('userId', 1);
  await next();
});
app.route('/api/dispatch/gps', gps);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_sign TEXT UNIQUE NOT NULL, officer_id INTEGER,
    status TEXT NOT NULL DEFAULT 'available', current_call_id INTEGER, current_call_number TEXT,
    latitude REAL, longitude REAL, gps_heading REAL, gps_speed REAL, gps_accuracy REAL,
    gps_updated_at TEXT, gps_source TEXT, vehicle_id TEXT, updated_at TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, has_take_home INTEGER DEFAULT 0)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS fleet_vehicles (id INTEGER PRIMARY KEY, assigned_unit_id INTEGER)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS gps_breadcrumbs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, unit_id INTEGER, officer_id INTEGER,
    latitude REAL, longitude REAL, accuracy REAL, heading REAL, speed REAL,
    call_sign TEXT, activity TEXT, activity_confidence TEXT, recorded_at TEXT, flagged_reason TEXT
  )`);
  await execute(db, "INSERT INTO users (id, has_take_home) VALUES (1, 0)");
  // Unit starts at SLC downtown, GPS updated 10s ago — a "next" fix hundreds
  // of miles away within 10s is a physically impossible jump.
  await execute(db,
    `INSERT INTO units (call_sign, officer_id, status, latitude, longitude, gps_updated_at)
     VALUES ('D190', 1, 'available', 40.7608, -111.8910, datetime('now', '-10 seconds'))`);
});

describe('POST /api/dispatch/gps — bounds validation', () => {
  it('nulls out-of-range accuracy/heading/speed but still stores the point', async () => {
    const res = await app.request('/api/dispatch/gps', {
      method: 'POST',
      body: JSON.stringify({ points: [{ lat: 40.761, lng: -111.891, accuracy: 999999, heading: 720, speed: 500 }] }),
      headers: { 'Content-Type': 'application/json' },
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(201);
    const body = await res.json() as { inserted?: number; accepted?: number };
    expect(body).toBeTruthy();

    const db = (env as unknown as { DB: D1Database }).DB;
    const row = await queryFirst<{ accuracy: number | null; heading: number | null; speed: number | null }>(db,
      'SELECT accuracy, heading, speed FROM gps_breadcrumbs ORDER BY id DESC LIMIT 1');
    expect(row?.accuracy).toBeNull();
    expect(row?.heading).toBeNull();
    expect(row?.speed).toBeNull();
  });

  it('accepts in-range accuracy/heading/speed unchanged', async () => {
    const res = await app.request('/api/dispatch/gps', {
      method: 'POST',
      body: JSON.stringify({ points: [{ lat: 40.762, lng: -111.892, accuracy: 12, heading: 90, speed: 15 }] }),
      headers: { 'Content-Type': 'application/json' },
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(201);

    const db = (env as unknown as { DB: D1Database }).DB;
    const row = await queryFirst<{ accuracy: number | null; heading: number | null; speed: number | null }>(db,
      'SELECT accuracy, heading, speed FROM gps_breadcrumbs ORDER BY id DESC LIMIT 1');
    expect(row?.accuracy).toBe(12);
    expect(row?.heading).toBe(90);
    expect(row?.speed).toBe(15);
  });

  it('flags a physically-impossible speed jump from the unit last known position', async () => {
    // Unit's last known fix (SLC) is ~10s old; this point is ~500 miles away
    // in Denver — implies a speed far beyond the 60 m/s threshold.
    const res = await app.request('/api/dispatch/gps', {
      method: 'POST',
      body: JSON.stringify({ points: [{ lat: 39.7392, lng: -104.9903, accuracy: 10 }] }),
      headers: { 'Content-Type': 'application/json' },
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(201);

    const db = (env as unknown as { DB: D1Database }).DB;
    const row = await queryFirst<{ flagged_reason: string | null }>(db,
      'SELECT flagged_reason FROM gps_breadcrumbs ORDER BY id DESC LIMIT 1');
    expect(row?.flagged_reason).toBe('speed_jump');
  });
});
