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
  // Tables findConnections()'s call/incident cases join against before
  // reaching the ALPR queries — same shared-outer-try-per-case caveat as
  // the vehicle case above.
  await execute(db, `CREATE TABLE IF NOT EXISTS calls_for_service (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_number TEXT, incident_type TEXT, priority TEXT,
    status TEXT, location_address TEXT, property_id INTEGER, case_id INTEGER, created_at TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS call_persons (
    call_id INTEGER, person_id INTEGER, role TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS trespass_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, person_id INTEGER, property_id INTEGER,
    originating_call_id INTEGER, originating_incident_id INTEGER
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS serve_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT, recipient_person_id INTEGER, property_id INTEGER, call_id INTEGER
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS call_businesses (
    call_id INTEGER, business_id INTEGER, role TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, incident_number TEXT, incident_type TEXT, status TEXT,
    priority TEXT, location_address TEXT, call_id INTEGER, property_id INTEGER
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS incident_persons (
    incident_id INTEGER, person_id INTEGER, role TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT, incident_id INTEGER
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS case_incident_links (
    case_id INTEGER, incident_id INTEGER
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS supplemental_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, incident_id INTEGER, report_type TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS incident_links (
    incident_id INTEGER, linked_type TEXT, linked_id TEXT
  )`);
  await execute(db, `INSERT INTO users (id, full_name, role) VALUES (1, 'Test Analyst', 'admin')`);
  await execute(db, `INSERT INTO vehicles_records (id, plate_number, make, model, year) VALUES (1, '8JAR3', 'Dodge', 'RAM', 2022)`);
  // Deliberately id=15 too — a superset-id capture that must NOT match a
  // substring search for vehicle id=1 (see false-positive test below).
  await execute(db, `INSERT INTO vehicles_records (id, plate_number, make, model, year) VALUES (15, 'ZZZ111', 'Ford', 'F150', 2020)`);
  await execute(db, `INSERT INTO alpr_captures (id, plate, state, lat, lng, location_text, vehicle_record_ids) VALUES (1, '8JAR3', 'UT', 40.76, -111.89, 'Main St', '[1]')`);
  await execute(db, `INSERT INTO alpr_captures (id, plate, state, lat, lng, location_text, vehicle_record_ids) VALUES (2, 'ZZZ111', 'UT', 40.70, -111.85, 'Elsewhere', '[15]')`);

  await execute(db, `INSERT INTO calls_for_service (id, call_number, incident_type, status, created_at) VALUES (1, 'CFS-1', 'traffic_stop', 'closed', datetime('now'))`);
  await execute(db, `INSERT INTO alpr_captures (id, plate, state, lat, lng, location_text, call_id, vehicle_record_ids) VALUES (3, '8JAR3', 'UT', 40.76, -111.89, 'Main St', 1, '[]')`);

  await execute(db, `INSERT INTO incidents (id, incident_number, incident_type, status) VALUES (1, 'INC-1', 'burglary', 'open')`);
  await execute(db, `INSERT INTO alpr_captures (id, plate, state, lat, lng, location_text, incident_id, vehicle_record_ids) VALUES (4, '8JAR3', 'UT', 40.76, -111.89, 'Main St', 1, '[]')`);

  // Collision fixture: alpr_captures and vehicle_sightings both independently
  // AUTOINCREMENT from 1, so alpr_captures id=1 (already inserted above, for
  // vehicle id=1 / plate 8JAR3) and a vehicle_sightings id=1 row for a
  // COMPLETELY DIFFERENT vehicle must not be confused with each other.
  await execute(db, `INSERT INTO vehicles_records (id, plate_number, make, model, year) VALUES (2, 'BBB222', 'Toyota', 'Camry', 2019)`);
  await execute(db, `INSERT INTO vehicle_sightings (id, plate, state, vehicle_id, lat, lng, location_text) VALUES (1, 'BBB222', 'UT', 2, 40.71, -111.90, 'Side St')`);
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

  it('does NOT match vehicle id=1 against an alpr_captures row whose vehicle_record_ids is [15] (substring false positive)', async () => {
    const res = await app.request('/api/connections/graph?type=vehicle&id=1&depth=1', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { nodes: Array<{ type: string; entityId: number }> };
    // capture id=2 (vehicle_record_ids='[15]') must not surface as a node
    // when traversing from vehicle id=1 — a naive '%1%' substring match
    // would incorrectly include it.
    const falsePositive = body.nodes.find((n) => n.type === 'alpr_sighting' && n.entityId === 2);
    expect(falsePositive).toBeUndefined();
    // sanity: vehicle id=15 itself DOES pick up capture id=2.
    const res15 = await app.request('/api/connections/graph?type=vehicle&id=15&depth=1', {}, env as unknown as Record<string, unknown>);
    const body15 = await res15.json() as { nodes: Array<{ type: string; entityId: number }> };
    expect(body15.nodes.find((n) => n.type === 'alpr_sighting' && n.entityId === 2)).toBeTruthy();
  });

  it('GET /connections/graph?type=call&id=1 includes the ALPR sighting node', async () => {
    const res = await app.request('/api/connections/graph?type=call&id=1&depth=1', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { nodes: Array<{ type: string; entityId: number; label: string }>; edges: Array<{ relationship: string }> };
    const alprNode = body.nodes.find((n) => n.type === 'alpr_sighting' && n.entityId === 3);
    expect(alprNode).toBeTruthy();
    expect(alprNode?.label).toContain('8JAR3');
    expect(body.edges.some((e) => e.relationship === 'alpr_capture')).toBe(true);
  });

  it('GET /connections/graph?type=incident&id=1 includes the ALPR sighting node', async () => {
    const res = await app.request('/api/connections/graph?type=incident&id=1&depth=1', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { nodes: Array<{ type: string; entityId: number; label: string }>; edges: Array<{ relationship: string }> };
    const alprNode = body.nodes.find((n) => n.type === 'alpr_sighting' && n.entityId === 4);
    expect(alprNode).toBeTruthy();
    expect(alprNode?.label).toContain('8JAR3');
    expect(body.edges.some((e) => e.relationship === 'alpr_capture')).toBe(true);
  });

  it('does not confuse alpr_captures id=1 with vehicle_sightings id=1 for a different vehicle (id-collision regression)', async () => {
    // vehicle id=1 → alpr_captures id=1 (plate 8JAR3). Its node id must be
    // the POSITIVE entityId, and its label must reflect the alpr_captures
    // row, not the colliding vehicle_sightings id=1 row (plate BBB222).
    const res1 = await app.request('/api/connections/graph?type=vehicle&id=1&depth=1', {}, env as unknown as Record<string, unknown>);
    expect(res1.status).toBe(200);
    const body1 = await res1.json() as { nodes: Array<{ type: string; entityId: number; label: string }> };
    const captureNode = body1.nodes.find((n) => n.type === 'alpr_sighting' && n.entityId === 1);
    expect(captureNode).toBeTruthy();
    expect(captureNode?.label).toContain('8JAR3');
    expect(captureNode?.label).not.toContain('BBB222');

    // vehicle id=2 → vehicle_sightings id=1 (plate BBB222). Its node id must
    // be the NEGATIVE entityId (-1), and its label must reflect the
    // vehicle_sightings row, not the colliding alpr_captures id=1 row
    // (plate 8JAR3) — this is the exact scenario that was previously
    // broken (loadNode always checked alpr_captures first, unconditionally).
    const res2 = await app.request('/api/connections/graph?type=vehicle&id=2&depth=1', {}, env as unknown as Record<string, unknown>);
    expect(res2.status).toBe(200);
    const body2 = await res2.json() as { nodes: Array<{ type: string; entityId: number; label: string; id: string }> };
    const sightingNode = body2.nodes.find((n) => n.type === 'alpr_sighting' && n.entityId === -1);
    expect(sightingNode).toBeTruthy();
    expect(sightingNode?.id).toBe('alpr_sighting--1');
    expect(sightingNode?.label).toContain('BBB222');
    expect(sightingNode?.label).not.toContain('8JAR3');
  });
});
