// Route-level regression test (Miniflare/workerd) for GET /api/dispatch/units.
// Adds camera_device_id/camera_ignition_state (from cpg_device_mappings) to
// the unit list response, for the CAD board's ClearPathGPS/FlexCam dashcam
// indicator — a unit with an active device mapping shows a camera icon.
// Uses scalar subqueries (not a LEFT JOIN) so a unit never duplicates even
// if cpg_device_mappings somehow has more than one active row for it.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import dispatchUnits from '../src/routes/dispatch/units';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-dispatcher' });
  c.set('userId', 1);
  await next();
});
app.route('/api/dispatch/units', dispatchUnits);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT, call_sign TEXT UNIQUE NOT NULL, officer_id INTEGER,
    status TEXT NOT NULL DEFAULT 'available', current_call_id INTEGER, current_call_number TEXT,
    latitude REAL, longitude REAL, vehicle_id INTEGER, capabilities TEXT, last_status_change TEXT, audio_mode TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, full_name TEXT, badge_number TEXT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS calls_for_service (
    id INTEGER PRIMARY KEY, call_number TEXT, incident_type TEXT, priority TEXT, location_address TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS fleet_vehicles (
    id INTEGER PRIMARY KEY, assigned_unit_id INTEGER, vehicle_number TEXT, make TEXT, model TEXT, status TEXT,
    current_mileage REAL, next_service_mileage REAL, next_service_date TEXT, insurance_expiry TEXT,
    registration_expiry TEXT, fuel_level REAL, pursuit_rated INTEGER
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS time_entries (id INTEGER PRIMARY KEY, officer_id INTEGER, clock_in TEXT, clock_out TEXT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS cpg_device_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, cpg_device_id TEXT NOT NULL, unit_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1, ignition_state TEXT
  )`);

  await execute(db, "INSERT INTO units (call_sign, status) VALUES ('D190', 'available')");
  await execute(db, "INSERT INTO units (call_sign, status) VALUES ('C580', 'off_duty')");
  await execute(db, "INSERT INTO cpg_device_mappings (cpg_device_id, unit_id, is_active, ignition_state) VALUES ('cpg-dev-1', 1, 1, 'on')");
  // Inactive mapping for the same unit — must NOT surface (is_active = 0).
  await execute(db, "INSERT INTO cpg_device_mappings (cpg_device_id, unit_id, is_active, ignition_state) VALUES ('cpg-dev-old', 1, 0, 'off')");
});

describe('GET /api/dispatch/units — camera_device_id/camera_ignition_state', () => {
  it('surfaces the active device mapping for a unit that has one, null for a unit that does not', async () => {
    const res = await app.request('/api/dispatch/units', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const rows = await res.json() as Array<{ call_sign: string; camera_device_id: string | null; camera_ignition_state: string | null }>;

    const d190 = rows.find((r) => r.call_sign === 'D190')!;
    expect(d190.camera_device_id).toBe('cpg-dev-1');
    expect(d190.camera_ignition_state).toBe('on');

    const c580 = rows.find((r) => r.call_sign === 'C580')!;
    expect(c580.camera_device_id).toBeNull();
  });
});
