// test-workers/serveMileage.test.ts
//
// Route-level test (Miniflare/workerd) for the serve mileage attribution
// repair: GET /stats/summary must return a real number (not the old
// hardcoded null), and GET /mileage/mine must split one officer's driven
// mileage across two overlapping-window jobs without double-counting —
// pinning the cross-job billing bug fixed by serveMileage.ts at the HTTP
// layer, not just the unit-test layer (tests/serveMileage.test.ts).
//
// Follows the local-Hono-app + hardcoded c.set('user', ...) convention used
// by test-workers/fleetAnalytics.test.ts and test-workers/auth.test.ts
// (NOT a SELF.fetch/JWT-signing approach — that pattern exists elsewhere
// for end-to-end auth-middleware coverage, which is not what this file
// verifies). Two different officer ids are needed across tests (501 vs
// 502 to prove per-officer scoping), so the app is built per-test via
// appAs(userId) rather than once at module scope.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import serve from '../src/routes/serve';

function appAs(userId: number) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: userId, role: 'officer', username: `officer-${userId}` });
    c.set('userId', userId);
    await next();
  });
  app.route('/api/serve', serve);
  return app;
}

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;

  await execute(db, `CREATE TABLE IF NOT EXISTS serve_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT, recipient_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending', deadline TEXT, closed_at TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS serve_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, serve_queue_id INTEGER, officer_id INTEGER,
    attempt_at TEXT, status TEXT DEFAULT 'attempted'
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS gps_breadcrumbs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, unit_id INTEGER, officer_id INTEGER,
    latitude REAL, longitude REAL, recorded_at TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS serve_routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, officer_id INTEGER, route_date TEXT, total_distance_miles REAL
  )`);

  await execute(db, `INSERT INTO serve_queue (id, recipient_name, status) VALUES
    (9001, 'Test Recipient A', 'in_progress'), (9002, 'Test Recipient B', 'in_progress')`);
  await execute(db, `INSERT INTO serve_attempts (id, serve_queue_id, officer_id, attempt_at, status) VALUES
    (7001, 9001, 501, '2026-08-01 09:00:00', 'attempted'),
    (7002, 9002, 501, '2026-08-01 09:30:00', 'attempted')`);
  await execute(db, `INSERT INTO gps_breadcrumbs (unit_id, officer_id, latitude, longitude, recorded_at) VALUES
    (1, 501, 40.7000, -111.8900, '2026-08-01 08:50:00'),
    (1, 501, 40.7150, -111.8900, '2026-08-01 09:05:00'),
    (1, 501, 40.7300, -111.8900, '2026-08-01 09:20:00'),
    (1, 501, 40.7450, -111.8900, '2026-08-01 09:40:00'),
    (1, 501, 40.7600, -111.8900, '2026-08-01 09:45:00')`);
  // NOTE (2026-08-02): the 09:45 point was added when the "hop must start
  // inside the segment" guard was restored in serveMileage.ts. A hop is now
  // attributed only when BOTH endpoints fall inside one attempt's window, so
  // the 08:50->09:05 commute and the boundary-straddling 09:20->09:40 hop are
  // unattributed. Without a second in-window point after 09:30, job 9002's
  // share would legitimately be 0 and this fixture could no longer exercise
  // the cross-job split it exists to pin.
});

describe('GET /api/serve/stats/summary', () => {
  it('returns a real mileage number for the seeded day, not null', async () => {
    const app = appAs(501);
    const res = await app.request('/api/serve/stats/summary?date=2026-08-01', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { mileage: number | null };
    expect(body.mileage).not.toBeNull();
    expect(body.mileage).toBeGreaterThan(0);
  });
});

describe('GET /api/serve/mileage/mine', () => {
  it('splits mileage across both jobs without double-counting', async () => {
    const app = appAs(501);
    const res = await app.request('/api/serve/mileage/mine?date=2026-08-01', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { miles: number; by_job: Array<{ serve_queue_id: number; miles: number }> };
    expect(body.by_job).toHaveLength(2);
    const job9001 = body.by_job.find(j => j.serve_queue_id === 9001)!;
    const job9002 = body.by_job.find(j => j.serve_queue_id === 9002)!;
    expect(job9001.miles + job9002.miles).toBeCloseTo(body.miles, 1);
    // The old +-2h-window bug would have made job9001.miles alone equal the
    // FULL trail (all 4 breadcrumbs fall inside its window) — assert it
    // does not consume the other job's share.
    expect(job9001.miles).toBeLessThan(body.miles);
    // ...and job9002 must genuinely be nonzero -- it's not enough for
    // job9001 to be "less than the total" by some rounding fluke while
    // job9002 stays 0 (which would also satisfy the assertion above but
    // would NOT prove the split actually happened).
    expect(job9002.miles).toBeGreaterThan(0);
  });

  it('never returns another officer\'s mileage (no officer_id query param accepted)', async () => {
    const app = appAs(502); // officer 502 has no attempts/breadcrumbs seeded
    const res = await app.request('/api/serve/mileage/mine?date=2026-08-01', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { miles: number };
    expect(body.miles).toBe(0);
  });

  it('ignores an officer_id query param override and still scopes to the authenticated officer', async () => {
    // Officer 502 attempts to request officer 501's data via a query param;
    // the route must ignore it and return officer 502's own (empty) result.
    const app = appAs(502);
    const res = await app.request('/api/serve/mileage/mine?date=2026-08-01&officer_id=501', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { miles: number };
    expect(body.miles).toBe(0);
  });
});
