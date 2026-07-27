// Route-level regression test (Miniflare/workerd) for DELETE
// /api/dispatch/calls/:id.
//
// Bug: the handler ran a bare `DELETE FROM calls_for_service WHERE id = ?`.
// D1 runs with PRAGMA foreign_keys=1, and most children of calls_for_service
// (call_persons, call_vehicles, incidents, impounds, radio_transmissions,
// nav_trip_log, units.current_call_id) declare a bare REFERENCES — i.e.
// NO ACTION — so a single child row makes SQLite REJECT the parent delete with
// "FOREIGN KEY constraint failed". The route's blanket catch turned that into
// an unexplained 500, and the client's retry loop replayed a request that could
// never succeed (observed live: DELETE /api/dispatch/calls/147 → 500 ×4).
//
// These tests pin the fix: dependents are detached first, pure link rows go
// away with the call, and standalone records survive with a NULLed pointer.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import dispatchCalls from '../src/routes/dispatch/calls';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-dispatcher' });
  c.set('userId', 1);
  await next();
});
app.route('/api/dispatch/calls', dispatchCalls);

const db = () => (env as unknown as { DB: D1Database }).DB;

beforeAll(async () => {
  await execute(db(), `CREATE TABLE IF NOT EXISTS calls_for_service (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_number TEXT UNIQUE,
    incident_type TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'P3',
    status TEXT NOT NULL DEFAULT 'pending',
    location_address TEXT,
    assigned_unit_ids TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  )`);
  // Mirrors the live FK shape: bare REFERENCES === ON DELETE NO ACTION.
  await execute(db(), `CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_sign TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'available',
    current_call_id INTEGER,
    emergency_call_id INTEGER,
    last_status_change TEXT,
    FOREIGN KEY (current_call_id) REFERENCES calls_for_service(id)
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS call_persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    FOREIGN KEY (call_id) REFERENCES calls_for_service(id)
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS call_vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id INTEGER NOT NULL,
    vehicle_id INTEGER NOT NULL,
    FOREIGN KEY (call_id) REFERENCES calls_for_service(id)
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_number TEXT,
    call_id INTEGER,
    FOREIGN KEY (call_id) REFERENCES calls_for_service(id)
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS impounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id INTEGER REFERENCES calls_for_service(id)
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS radio_transmissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id INTEGER REFERENCES calls_for_service(id)
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS nav_trip_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id INTEGER REFERENCES calls_for_service(id)
  )`);
});

async function makeCall(callNumber: string): Promise<number> {
  const res = await execute(db(),
    "INSERT INTO calls_for_service (call_number, incident_type, status) VALUES (?, 'alarm', 'pending')",
    callNumber);
  return (res as unknown as D1Result).meta.last_row_id as number;
}

describe('DELETE /api/dispatch/calls/:id', () => {
  it('enforces foreign keys (guards the premise of these tests)', async () => {
    const row = await db().prepare('PRAGMA foreign_keys').first<{ foreign_keys: number }>();
    expect(row?.foreign_keys).toBe(1);
  });

  it('deletes a call that has a linked person instead of 500ing on the FK', async () => {
    const callId = await makeCall('2026-000950');
    await execute(db(), 'INSERT INTO call_persons (call_id, person_id) VALUES (?, 42)', callId);

    const res = await app.request(`/api/dispatch/calls/${callId}`, { method: 'DELETE' },
      env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    const call = await db().prepare('SELECT id FROM calls_for_service WHERE id = ?').bind(callId).first();
    expect(call).toBeNull();
    const link = await db().prepare('SELECT id FROM call_persons WHERE call_id = ?').bind(callId).first();
    expect(link).toBeNull();
  });

  it('removes pure link rows but preserves standalone records with a NULLed pointer', async () => {
    const callId = await makeCall('2026-000951');
    await execute(db(), 'INSERT INTO call_vehicles (call_id, vehicle_id) VALUES (?, 7)', callId);
    await execute(db(), "INSERT INTO incidents (incident_number, call_id) VALUES ('I-1', ?)", callId);
    await execute(db(), 'INSERT INTO impounds (call_id) VALUES (?)', callId);
    await execute(db(), 'INSERT INTO radio_transmissions (call_id) VALUES (?)', callId);
    await execute(db(), 'INSERT INTO nav_trip_log (call_id) VALUES (?)', callId);

    const res = await app.request(`/api/dispatch/calls/${callId}`, { method: 'DELETE' },
      env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    expect(await db().prepare('SELECT id FROM call_vehicles WHERE call_id = ?').bind(callId).first()).toBeNull();
    // The incident report itself must survive — only its call pointer is cleared.
    const incident = await db().prepare("SELECT call_id FROM incidents WHERE incident_number = 'I-1'").first();
    expect(incident).not.toBeNull();
    expect((incident as { call_id: number | null }).call_id).toBeNull();
    for (const table of ['impounds', 'radio_transmissions', 'nav_trip_log']) {
      const orphan = await db().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE call_id = ?`).bind(callId).first<{ n: number }>();
      expect(orphan?.n).toBe(0);
    }
  });

  it('releases a unit that was still working the deleted call', async () => {
    const callId = await makeCall('2026-000952');
    await execute(db(), "INSERT INTO units (call_sign, status, current_call_id) VALUES ('D9', 'dispatched', ?)", callId);

    const res = await app.request(`/api/dispatch/calls/${callId}`, { method: 'DELETE' },
      env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    const unit = await db().prepare("SELECT status, current_call_id FROM units WHERE call_sign = 'D9'")
      .first<{ status: string; current_call_id: number | null }>();
    expect(unit?.status).toBe('available');
    expect(unit?.current_call_id).toBeNull();
  });

  it('rejects a non-numeric id with 400 rather than a 500', async () => {
    const res = await app.request('/api/dispatch/calls/not-a-number', { method: 'DELETE' },
      env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
  });
});
