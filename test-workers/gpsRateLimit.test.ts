// Route-level regression test (Miniflare/workerd) for the GPS-specific rate
// limit on POST /api/dispatch/gps. The generic per-user limit (600 req/300s,
// src/middleware/rateLimit.ts) is deliberately generous and explicitly NOT
// tuned to catch GPS abuse — this is a tighter, endpoint-specific limit.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import gps from '../src/routes/dispatch/gps';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 2, role: 'officer', username: 'test-officer-2' });
  c.set('userId', 2);
  await next();
});
app.route('/api/dispatch/gps', gps);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_sign TEXT UNIQUE NOT NULL, officer_id INTEGER,
    status TEXT NOT NULL DEFAULT 'available', current_call_id INTEGER,
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
  await execute(db, "INSERT INTO users (id, has_take_home) VALUES (2, 0)");
  await execute(db, "INSERT INTO units (call_sign, officer_id, status) VALUES ('D200', 2, 'available')");
});

describe('POST /api/dispatch/gps — rate limit', () => {
  // Must match the window passed to rateLimitAllow in src/routes/dispatch/gps.ts.
  const WINDOW_SECONDS = 30;
  const currentWindow = () => Math.floor(Date.now() / 1000 / WINDOW_SECONDS);

  async function burst(n: number): Promise<number> {
    let lastStatus = 0;
    for (let i = 0; i < n; i++) {
      const res = await app.request('/api/dispatch/gps', {
        method: 'POST',
        body: JSON.stringify({ points: [{ lat: 40.76 + i * 0.0001, lng: -111.89 }] }),
        headers: { 'Content-Type': 'application/json' },
      }, env as unknown as Record<string, unknown>);
      lastStatus = res.status;
    }
    return lastStatus;
  }

  it('rejects the 31st request within 30s with 429', async () => {
    // rateLimitAllow (src/utils/rateLimit.ts) is a FIXED-window limiter: its
    // key embeds `now - (now % 30)`, so the counter resets outright at every
    // 30s boundary. A burst that straddles one leaves its final request in a
    // fresh window where 201 is the CORRECT answer — which made this
    // assertion a coin flip on a loaded runner (reproduced locally as
    // fail/pass/pass across three consecutive runs of one commit).
    //
    // Retry only when the burst actually crossed a boundary. That is the
    // whole point: a burst that stayed inside one window is a valid
    // observation and is asserted on immediately, so a genuine regression
    // still fails here rather than being retried away.
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const windowAtStart = currentWindow();
      lastStatus = await burst(31);
      if (currentWindow() === windowAtStart) break;
    }
    expect(lastStatus).toBe(429);
  });
});
