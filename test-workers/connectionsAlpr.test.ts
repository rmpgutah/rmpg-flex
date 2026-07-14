// test-workers/connectionsAlpr.test.ts
//
// Route-level test (Miniflare/workerd) confirming ALPR sightings surface
// as graph nodes/edges when traversing from a vehicle, call, or incident.
// alpr_captures is already FK'd to vehicles_records/calls_for_service/
// incidents (migrations 0108-0115) — this proves connections.ts actually
// walks those FKs, which it didn't before this task.
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
  await execute(db, `CREATE TABLE IF NOT EXISTS vehicles_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plate_number TEXT, state TEXT, make TEXT, model TEXT, year INTEGER,
    color TEXT, vin TEXT, owner_person_id INTEGER, flags TEXT
  )`);
  // Tables findConnections()'s vehicle case joins against before reaching the
  // ALPR queries — the whole case switch shares one outer try/catch, so a
  // missing table earlier in the case aborts the ALPR queries too.
  await execute(db, `CREATE TABLE IF NOT EXISTS record_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source_type TEXT, source_id TEXT, target_type TEXT, target_id TEXT, relationship TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS incident_vehicles (
    incident_id INTEGER, vehicle_id INTEGER, role TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS call_vehicles (
    call_id INTEGER, vehicle_id INTEGER, role TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS citations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, person_id INTEGER, incident_id INTEGER, call_id INTEGER, status TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS field_interviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, person_id INTEGER, associated_call_id INTEGER, associated_incident_id INTEGER
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS business_vehicles (
    business_id INTEGER, vehicle_id INTEGER, relationship TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS alpr_captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT, sighting_id INTEGER, capture_id TEXT, case_id INTEGER,
    plate TEXT, state TEXT, lat REAL, lng REAL, location_text TEXT, captured_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), call_id INTEGER, incident_id INTEGER,
    vehicle_record_ids TEXT DEFAULT '[]'
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS vehicle_sightings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plate TEXT, state TEXT, vehicle_id INTEGER,
    location_text TEXT, lat REAL, lng REAL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `INSERT INTO users (id, full_name, role) VALUES (1, 'Test Analyst', 'admin')`);
  await execute(db, `INSERT INTO vehicles_records (id, plate_number, make, model, year) VALUES (1, '8JAR3', 'Dodge', 'RAM', 2022)`);
  await execute(db, `INSERT INTO alpr_captures (id, plate, state, lat, lng, location_text, vehicle_record_ids) VALUES (1, '8JAR3', 'UT', 40.76, -111.89, 'Main St', '[1]')`);
});

describe('ALPR graph nodes', () => {
  it('GET /connections/graph?type=vehicle&id=1 includes the ALPR sighting node', async () => {
    const res = await app.request('/api/connections/graph?type=vehicle&id=1&depth=1', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { nodes: Array<{ type: string; entityId: number; label: string }>; edges: Array<{ relationship: string }> };
    const alprNode = body.nodes.find((n) => n.type === 'alpr_sighting' && n.entityId === 1);
    expect(alprNode).toBeTruthy();
    expect(alprNode?.label).toContain('8JAR3');
    expect(body.edges.some((e) => e.relationship === 'alpr_capture')).toBe(true);
  });
});
