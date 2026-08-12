// Route-level test (Miniflare/workerd) pinning ONE invariant in
// GET /api/dispatch/calls/:id — the overflow table must win a name collision.
//
// FOURTEEN column names exist on BOTH calls_for_service and
// calls_for_service_ext: the pso_* block (requestor name/phone/email,
// service_type, billing_code, authorization, attempt_number, service_windows)
// and the process_* block (service_type, served_to, served_address, attempts,
// served_at, service_result).
//
// On live D1 every one of those base-table copies is EMPTY (0 rows) while the
// ext copies hold the real data (68 served_to, 112 attempts, 55 results). The
// detail handler is correct today only because it spreads `...call` BEFORE
// `...ext`, so ext overwrites the NULLs. Swap those two lines — a completely
// innocuous-looking reorder — and the entire process-service block silently
// blanks on the call detail screen, with no error anywhere.
//
// No schema checker can catch this: the columns legitimately exist on both
// tables, so nothing is "missing". Only precedence is load-bearing, which is
// why it gets an explicit test rather than a comment.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import calls from '../src/routes/dispatch/calls';

const app = new Hono<{
  Bindings: Record<string, unknown>;
  Variables: { user: { id: number; role: string; username: string }; userId: number };
}>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-admin' });
  c.set('userId', 1);
  await next();
});
app.route('/api/dispatch/calls', calls);

const db = () => (env as unknown as { DB: D1Database }).DB;
const CALL_ID = 4242;

beforeAll(async () => {
  await execute(db(), `CREATE TABLE IF NOT EXISTS calls_for_service (
    id INTEGER PRIMARY KEY, call_number TEXT, incident_type TEXT, priority TEXT,
    status TEXT, location_address TEXT, assigned_unit_ids TEXT DEFAULT '[]',
    property_id INTEGER, dispatcher_id INTEGER, client_id INTEGER,
    created_at TEXT, updated_at TEXT,
    process_served_to TEXT, process_served_address TEXT, process_attempts INTEGER,
    process_service_result TEXT, pso_requestor_name TEXT
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS calls_for_service_ext (
    id INTEGER PRIMARY KEY, parent_call_id INTEGER,
    process_served_to TEXT, process_served_address TEXT, process_attempts INTEGER,
    process_service_result TEXT, pso_requestor_name TEXT
  )`);

  // The detail handler also reads these; without them it throws and the route
  // answers 503 rather than exercising the merge under test.
  await execute(db(), `CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, address TEXT, client_id INTEGER,
    gate_code TEXT, alarm_code TEXT, emergency_contact TEXT, post_orders TEXT, hazard_notes TEXT
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT, badge_number TEXT, role TEXT, status TEXT
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_sign TEXT, officer_id INTEGER, status TEXT
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_id INTEGER, incident_number TEXT,
    incident_type TEXT, status TEXT, created_at TEXT
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS serve_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_id INTEGER, status TEXT, case_number TEXT
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS call_visit_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_id INTEGER, visit_number INTEGER,
    responding_vehicle_id INTEGER, created_at TEXT
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS fleet_vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_number TEXT, assigned_unit_id INTEGER,
    status TEXT
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, entity_type TEXT, entity_id INTEGER,
    user_id INTEGER, details TEXT, created_at TEXT
  )`);

  await execute(db(), 'DELETE FROM calls_for_service WHERE id = ?', CALL_ID);
  await execute(db(), 'DELETE FROM calls_for_service_ext WHERE id = ?', CALL_ID);

  // Base row: the collision columns are NULL, exactly as on live.
  await execute(db(),
    `INSERT INTO calls_for_service (id, call_number, incident_type, priority, status,
       location_address, created_at, updated_at)
     VALUES (?, '26-RMP-4242', 'pso_client_request', 'P3', 'pending', '1 Test St',
             datetime('now'), datetime('now'))`, CALL_ID);

  // Overflow row: the real process-service record.
  await execute(db(),
    `INSERT INTO calls_for_service_ext (id, process_served_to, process_served_address,
       process_attempts, process_service_result, pso_requestor_name)
     VALUES (?, 'Jane Defendant', '55 Recipient Ave', 3, 'served', 'Acme Law LLP')`, CALL_ID);
});

describe('GET /api/dispatch/calls/:id — ext wins colliding column names', () => {
  const fetchCall = async () => {
    const res = await app.request(`/api/dispatch/calls/${CALL_ID}`, {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    return await res.json() as Record<string, unknown>;
  };

  it('returns the overflow row\'s process-service values, not the base NULLs', async () => {
    const body = await fetchCall();
    expect(body.process_served_to).toBe('Jane Defendant');
    expect(body.process_served_address).toBe('55 Recipient Ave');
    expect(body.process_attempts).toBe(3);
    expect(body.process_service_result).toBe('served');
  });

  it('returns the overflow row\'s pso_* values too', async () => {
    const body = await fetchCall();
    expect(body.pso_requestor_name).toBe('Acme Law LLP');
  });

  it('does not null out a colliding field (the reorder regression)', async () => {
    // Stated as its own assertion because this is the failure mode: not a
    // wrong value, but a silently absent one.
    const body = await fetchCall();
    for (const field of ['process_served_to', 'process_served_address',
                         'process_service_result', 'pso_requestor_name']) {
      expect(body[field], `${field} came back empty — base-table NULL won the collision`).toBeTruthy();
    }
  });
});
