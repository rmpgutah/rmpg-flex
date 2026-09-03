// Route-level regression tests (Miniflare/workerd) for POST /api/dispatch/panic.
// Two bugs fixed here:
// 1. Auto-backup-dispatch defaulted missing latitude/longitude to (0,0)
//    ("null island") and still ran the nearest-unit query against it,
//    silently auto-dispatching backup units based on nonsense distances.
//    Now it skips auto-backup-dispatch entirely when GPS is missing.
// 2. Status-transition routes (resolve/false-alarm) never checked whether
//    the UPDATE actually changed a row, so calling them on an
//    already-resolved/nonexistent alert still reported fabricated success.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import panic from '../src/routes/dispatch/panic';

function appAs(role: string) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, role, username: 'test-user' });
    c.set('userId', 1);
    await next();
  });
  app.route('/api/dispatch', panic);
  return app;
}

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS panic_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    unit_id INTEGER,
    call_id INTEGER,
    latitude REAL, longitude REAL, location_address TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'active',
    escalation_level INTEGER NOT NULL DEFAULT 0,
    acknowledged_by INTEGER, acknowledged_at TEXT,
    resolved_by INTEGER, resolved_at TEXT, resolution_notes TEXT,
    backup_call_id INTEGER, backup_units TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS calls_for_service (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_number TEXT UNIQUE, incident_type TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'P3', status TEXT NOT NULL DEFAULT 'pending',
    location_address TEXT, latitude REAL, longitude REAL,
    -- officer_safety_caution, NOT officer_safety_alert: this fixture used to
    -- declare a column live D1 does not have, so it green-lit a route INSERT
    -- that always failed in production.
    description TEXT, source TEXT, officer_safety_caution INTEGER,
    dispatcher_id INTEGER, assigned_unit_ids TEXT DEFAULT '[]', unit_call_signs TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_sign TEXT UNIQUE NOT NULL, officer_id INTEGER,
    status TEXT NOT NULL DEFAULT 'available',
    current_call_id INTEGER, latitude REAL, longitude REAL
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT, badge_number TEXT,
    role TEXT NOT NULL DEFAULT 'officer', status TEXT NOT NULL DEFAULT 'active'
  )`);
});

describe('POST /api/dispatch/panic — auto-backup-dispatch GPS guard', () => {
  it('does NOT auto-dispatch backup units when latitude/longitude are omitted', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, "INSERT INTO units (call_sign, status, latitude, longitude) VALUES ('B1', 'available', 40.0, -111.0), ('B2', 'available', 40.1, -111.1)");

    const app = appAs('officer');
    const res = await app.request(
      '/api/dispatch/panic',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.backup_call_id).toBeFalsy();
    expect(body.backup_units).toBeFalsy();

    // Confirm no unit was actually dispatched as a side effect.
    const dispatched = await db.prepare("SELECT COUNT(*) as n FROM units WHERE status = 'dispatched'").first() as { n: number };
    expect(dispatched.n).toBe(0);
  });

  it('DOES auto-dispatch backup units when real coordinates are provided', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, "DELETE FROM units");
    await execute(db, "INSERT INTO units (call_sign, status, latitude, longitude) VALUES ('B3', 'available', 40.76, -111.89)");

    const app = appAs('officer');
    const res = await app.request(
      '/api/dispatch/panic',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ latitude: 40.76, longitude: -111.89 }) },
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.backup_call_id).toBeTruthy();
    expect(body.backup_units).toContain('B3');
  });
});

describe('POST /api/dispatch/panic/:id/resolve and /false-alarm — role gating + no-op detection', () => {
  it('rejects an officer-role attempt to resolve a panic alert (403)', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const ins = await execute(db, "INSERT INTO panic_alerts (user_id, source) VALUES (2, 'manual')");
    const id = (ins as unknown as D1Result).meta.last_row_id;

    const app = appAs('officer');
    const res = await app.request(
      `/api/dispatch/panic/${id}/resolve`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(403);
  });

  it('allows a dispatcher-role to resolve, then rejects re-resolving the same alert (409, not fabricated success)', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const ins = await execute(db, "INSERT INTO panic_alerts (user_id, source) VALUES (3, 'manual')");
    const id = (ins as unknown as D1Result).meta.last_row_id;

    const app = appAs('dispatcher');
    const first = await app.request(
      `/api/dispatch/panic/${id}/resolve`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      env as unknown as Record<string, unknown>,
    );
    expect(first.status).toBe(200);

    const second = await app.request(
      `/api/dispatch/panic/${id}/resolve`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      env as unknown as Record<string, unknown>,
    );
    expect(second.status).toBe(409);
  });

  it('allows resolving an already-ACKNOWLEDGED alert (not just active) — full active->acknowledged->resolved lifecycle', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const ins = await execute(db, "INSERT INTO panic_alerts (user_id, source) VALUES (5, 'manual')");
    const id = (ins as unknown as D1Result).meta.last_row_id;

    const dispatcherApp = appAs('dispatcher');
    const ack = await dispatcherApp.request(
      `/api/dispatch/panic/${id}/acknowledge`,
      { method: 'POST' },
      env as unknown as Record<string, unknown>,
    );
    expect(ack.status).toBe(200);

    const resolve = await dispatcherApp.request(
      `/api/dispatch/panic/${id}/resolve`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      env as unknown as Record<string, unknown>,
    );
    expect(resolve.status).toBe(200);
  });

  it('returns 404 (not fabricated success) when resolving a nonexistent alert id', async () => {
    const app = appAs('dispatcher');
    const res = await app.request(
      '/api/dispatch/panic/999999/resolve',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(404);
  });
});

describe('panic dedup lookup — 30-minute time bound', () => {
  it('does not reuse a panic-sourced call older than 30 minutes for a fresh activation', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const stale = await execute(db,
      `INSERT INTO calls_for_service (call_number, incident_type, status, source, dispatcher_id, created_at)
       VALUES ('STALE-001', 'panic_alarm', 'active', 'panic', 4, datetime('now', '-2 hours'))`);
    const staleId = (stale as unknown as D1Result).meta.last_row_id;

    const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
    app.use('*', async (c, next) => { c.set('user', { id: 4, role: 'officer', username: 'stale-tester' }); c.set('userId', 4); await next(); });
    app.route('/api/dispatch', panic);

    const res = await app.request(
      '/api/dispatch/panic',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      env as unknown as Record<string, unknown>,
    );
    const body = await res.json() as any;
    expect(body.call_id).not.toBe(staleId);
  });
});
