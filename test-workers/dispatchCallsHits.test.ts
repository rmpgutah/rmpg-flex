// Route-level regression test (Miniflare/workerd) for GET /api/dispatch/calls/hits.
// Companion to the intel screening engine (src/utils/intelScreen.ts) for the
// Dispatch CAD board: returns the set of non-archived call IDs with a hit
// worth a queue-scanning glance (stolen/watchlisted vehicle, a linked person
// with an active warrant/watchlist entry, or a linked person matched to the
// NSOPW sex-offender registry) via call_vehicles/call_persons, so the board
// can badge a row without running screenPerson/screenVehicle per call.
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

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS calls_for_service (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_number TEXT UNIQUE, incident_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS call_vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_id INTEGER NOT NULL, vehicle_id INTEGER NOT NULL, role TEXT DEFAULT 'subject'
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS call_persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_id INTEGER NOT NULL, person_id INTEGER NOT NULL, role TEXT DEFAULT 'subject'
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS vehicles_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plate_number TEXT, is_stolen INTEGER, stolen_status TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS intel_watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, reason TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, subject_person_id INTEGER, person_id INTEGER, status TEXT, warrant_number TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS national_sex_offenders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, person_id INTEGER, jurisdiction TEXT, last_name TEXT
  )`);

  // Call 1: linked to a stolen vehicle → HIT
  await execute(db, "INSERT INTO calls_for_service (call_number, incident_type, status) VALUES ('2026-000960', 'traffic_stop', 'onscene')");
  await execute(db, "INSERT INTO vehicles_records (plate_number, is_stolen) VALUES ('ABC123', 1)");
  await execute(db, "INSERT INTO call_vehicles (call_id, vehicle_id) VALUES (1, 1)");

  // Call 2: linked to a person with an active warrant → HIT
  await execute(db, "INSERT INTO calls_for_service (call_number, incident_type, status) VALUES ('2026-000961', 'suspicious_person', 'dispatched')");
  await execute(db, "INSERT INTO warrants (subject_person_id, status, warrant_number) VALUES (55, 'active', 'WR-9001')");
  await execute(db, "INSERT INTO call_persons (call_id, person_id) VALUES (2, 55)");

  // Call 3: linked to a clean vehicle and a person with only a CLEARED warrant → no hit
  await execute(db, "INSERT INTO calls_for_service (call_number, incident_type, status) VALUES ('2026-000962', 'alarm', 'pending')");
  await execute(db, "INSERT INTO vehicles_records (plate_number, is_stolen) VALUES ('CLEAN1', 0)");
  await execute(db, "INSERT INTO call_vehicles (call_id, vehicle_id) VALUES (3, 2)");
  await execute(db, "INSERT INTO warrants (subject_person_id, status, warrant_number) VALUES (56, 'served', 'WR-9002')");
  await execute(db, "INSERT INTO call_persons (call_id, person_id) VALUES (3, 56)");

  // Call 4: linked to a watchlisted person → HIT
  await execute(db, "INSERT INTO calls_for_service (call_number, incident_type, status) VALUES ('2026-000963', 'welfare_check', 'pending')");
  await execute(db, "INSERT INTO intel_watchlist (entity_type, entity_id, active, reason) VALUES ('person', 77, 1, 'gang intel')");
  await execute(db, "INSERT INTO call_persons (call_id, person_id) VALUES (4, 77)");

  // Call 5: archived, otherwise would hit (stolen vehicle) — must be excluded
  await execute(db, "INSERT INTO calls_for_service (call_number, incident_type, status) VALUES ('2026-000964', 'traffic_stop', 'archived')");
  await execute(db, "INSERT INTO vehicles_records (plate_number, is_stolen) VALUES ('OLD999', 1)");
  await execute(db, "INSERT INTO call_vehicles (call_id, vehicle_id) VALUES (5, 3)");

  // Call 6: linked to a person matched to the NSOPW sex-offender registry → HIT
  await execute(db, "INSERT INTO calls_for_service (call_number, incident_type, status) VALUES ('2026-000965', 'welfare_check', 'pending')");
  await execute(db, "INSERT INTO national_sex_offenders (person_id, jurisdiction, last_name) VALUES (88, 'UT', 'DOE')");
  await execute(db, "INSERT INTO call_persons (call_id, person_id) VALUES (6, 88)");
});

describe('GET /api/dispatch/calls/hits', () => {
  it('returns call IDs with a hit worth a glance, excludes clean and archived calls', async () => {
    const res = await app.request('/api/dispatch/calls/hits', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { call_ids: number[] };
    const ids = body.call_ids.sort();

    expect(ids).toContain(1); // stolen vehicle
    expect(ids).toContain(2); // active warrant
    expect(ids).toContain(4); // watchlisted person
    expect(ids).toContain(6); // NSOPW match
    expect(ids).not.toContain(3); // clean vehicle + served warrant
    expect(ids).not.toContain(5); // archived, would otherwise hit
  });
});
