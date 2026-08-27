// test-workers/connectionsDateFilter.test.ts
//
// Confirms GET /connections/graph?date_from=&date_to= excludes dated
// nodes (incident/call/citation/etc.) outside the range while always
// including undated node types (person/vehicle/property/...) — an
// investigator shouldn't lose a person from the graph just because
// they're time-filtering incidents.
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
  await execute(db, `CREATE TABLE IF NOT EXISTS persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, last_name TEXT,
    dob TEXT, address TEXT, city TEXT, state TEXT, phone TEXT, flags TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, incident_number TEXT, incident_type TEXT,
    occurred_date TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), status TEXT,
    priority TEXT, location_address TEXT, call_id INTEGER
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS incident_persons (id INTEGER PRIMARY KEY AUTOINCREMENT, incident_id INTEGER, person_id INTEGER, role TEXT)`);
  await execute(db, `INSERT INTO users (id, full_name, role) VALUES (1, 'Test Analyst', 'admin')`);
  await execute(db, `INSERT INTO persons (id, first_name, last_name) VALUES (1, 'Jane', 'Doe')`);
  await execute(db, `INSERT INTO incidents (id, incident_number, incident_type, occurred_date) VALUES (1, 'INC-1', 'theft', '2026-01-15')`);
  await execute(db, `INSERT INTO incidents (id, incident_number, incident_type, occurred_date) VALUES (2, 'INC-2', 'assault', '2026-06-15')`);
  await execute(db, `INSERT INTO incident_persons (incident_id, person_id, role) VALUES (1, 1, 'suspect'), (2, 1, 'suspect')`);
});

describe('Date-range filtering', () => {
  it('excludes an out-of-range incident but keeps the undated person node', async () => {
    const res = await app.request(
      '/api/connections/graph?type=person&id=1&depth=1&date_from=2026-06-01&date_to=2026-06-30',
      {}, env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { nodes: Array<{ type: string; entityId: number }> };
    expect(body.nodes.some((n) => n.type === 'person' && n.entityId === 1)).toBe(true);
    expect(body.nodes.some((n) => n.type === 'incident' && n.entityId === 2)).toBe(true);
    expect(body.nodes.some((n) => n.type === 'incident' && n.entityId === 1)).toBe(false);
  });
});
