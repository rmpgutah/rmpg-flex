// Route-level regression test (Miniflare/workerd) for GET
// /api/dispatch/trips/score-trend. Confirms the harsh-event trend read works
// and — critically — that registering '/score-trend' BEFORE the '/:id' param
// route in src/routes/dispatch/trips.ts means it is matched literally rather
// than falling into the param route with id="score-trend".
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import dispatchTrips from '../src/routes/dispatch/trips';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-officer' });
  c.set('userId', 1);
  await next();
});
app.route('/api/dispatch/trips', dispatchTrips);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS unit_trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id INTEGER,
    officer_id INTEGER,
    vehicle_id INTEGER,
    trip_type TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    call_id INTEGER, call_number TEXT, call_type TEXT, prev_trip_id INTEGER,
    start_time TEXT, start_lat REAL, start_lng REAL, start_mileage REAL,
    end_time TEXT, end_lat REAL, end_lng REAL, end_mileage REAL,
    close_reason TEXT, distance_m REAL, max_speed REAL, speed_sum REAL,
    fix_count INTEGER, max_lat_g REAL,
    harsh_accel_count INTEGER NOT NULL DEFAULT 0,
    harsh_brake_count INTEGER NOT NULL DEFAULT 0,
    harsh_corner_count INTEGER NOT NULL DEFAULT 0,
    stop_count INTEGER, anchor_lat REAL, anchor_lng REAL,
    last_move_at TEXT, last_fix_ts TEXT,
    prev_lat REAL, prev_lng REAL, prev_mph REAL, prev_bearing REAL,
    duration_s REAL, avg_speed REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  )`);

  // Three closed trips for unit 42, oldest first — the endpoint returns
  // newest-first (ORDER BY start_time DESC), matching the API's existing
  // /trips listing convention.
  await execute(db,
    `INSERT INTO unit_trips (unit_id, officer_id, status, start_time, harsh_accel_count, harsh_brake_count, harsh_corner_count)
     VALUES (42, 7, 'closed', '2026-07-01T08:00:00Z', 0, 0, 0)`);
  await execute(db,
    `INSERT INTO unit_trips (unit_id, officer_id, status, start_time, harsh_accel_count, harsh_brake_count, harsh_corner_count)
     VALUES (42, 7, 'closed', '2026-07-02T08:00:00Z', 1, 1, 0)`);
  await execute(db,
    `INSERT INTO unit_trips (unit_id, officer_id, status, start_time, harsh_accel_count, harsh_brake_count, harsh_corner_count)
     VALUES (42, 7, 'closed', '2026-07-03T08:00:00Z', 3, 2, 1)`);
  // An active trip for the same unit — must be excluded (status != 'closed').
  await execute(db,
    `INSERT INTO unit_trips (unit_id, officer_id, status, start_time, harsh_accel_count, harsh_brake_count, harsh_corner_count)
     VALUES (42, 7, 'active', '2026-07-04T08:00:00Z', 9, 9, 9)`);
  // A different unit — must be excluded when filtering by unit_id=42.
  await execute(db,
    `INSERT INTO unit_trips (unit_id, officer_id, status, start_time, harsh_accel_count, harsh_brake_count, harsh_corner_count)
     VALUES (99, 8, 'closed', '2026-07-01T09:00:00Z', 5, 5, 5)`);
});

describe('GET /api/dispatch/trips/score-trend', () => {
  it('is matched literally, not swallowed by the /:id param route', async () => {
    const res = await app.request('/api/dispatch/trips/score-trend?unit_id=42', {}, env as unknown as Record<string, unknown>);
    // If /:id had matched first, id="score-trend" would hit `SELECT ... WHERE
    // id = ?` with a non-numeric bind, returning 404 (no row), not a JSON array.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns only closed trips for the requested unit, newest first', async () => {
    const res = await app.request('/api/dispatch/trips/score-trend?unit_id=42', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as Array<{ start_time: string; harsh_accel_count: number }>;
    expect(body).toHaveLength(3);
    expect(body[0].start_time).toBe('2026-07-03T08:00:00Z');
    expect(body[2].start_time).toBe('2026-07-01T08:00:00Z');
  });

  it('filters by officer_id', async () => {
    const res = await app.request('/api/dispatch/trips/score-trend?officer_id=8', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as Array<{ harsh_accel_count: number }>;
    expect(body).toHaveLength(1);
    expect(body[0].harsh_accel_count).toBe(5);
  });

  it('respects the limit param', async () => {
    const res = await app.request('/api/dispatch/trips/score-trend?unit_id=42&limit=1', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as unknown[];
    expect(body).toHaveLength(1);
  });

  it('requires unit_id or officer_id', async () => {
    const res = await app.request('/api/dispatch/trips/score-trend', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
  });
});
