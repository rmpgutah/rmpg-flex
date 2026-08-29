// Route-level regression test (Miniflare/workerd) for GET /api/dispatch/calls.
// Bug: the Dispatch page's "Cleared" tab (filterTab 'cleared') filters the
// client's shared `calls` array for status in ('cleared','closed','cancelled'),
// but that array is populated exclusively from `/dispatch/calls?limit=200`
// (DispatchPage.tsx fetchData()) with NO status/archived query param. This
// route silently rewrites the WHERE clause to an explicit active-status
// allowlist whenever neither `status` nor `archived` is supplied (see the
// `active === 'true' || (!status && !archived)` branch below), which excludes
// cleared/closed/cancelled rows entirely — they were never "pulled" from the
// DB in the first place, not merely filtered out client-side. The "Archived"
// tab has its own dedicated `?archived=true` fetch; no equivalent exists for
// cleared/closed/cancelled, so those calls silently vanish from the Cleared
// tab after the periodic 20s silent refresh replaces `calls` in place.
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
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_number TEXT UNIQUE, incident_type TEXT NOT NULL, secondary_type TEXT,
    priority TEXT NOT NULL DEFAULT 'P3', priority_score REAL, status TEXT NOT NULL DEFAULT 'pending',
    previous_status TEXT, status_changed_at TEXT, source TEXT, dispatch_code TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), received_at TEXT,
    dispatched_at TEXT, enroute_at TEXT, onscene_at TEXT, cleared_at TEXT, closed_at TEXT,
    archived_at TEXT, updated_at TEXT, response_time_seconds INTEGER, onscene_duration_seconds INTEGER,
    location_address TEXT, latitude REAL, longitude REAL,
    cross_street TEXT, location_building TEXT, location_floor TEXT, location_room TEXT,
    caller_name TEXT, caller_phone TEXT, contact_method TEXT,
    dispatcher_id INTEGER, property_id INTEGER, client_id INTEGER,
    case_id INTEGER, case_number TEXT, contract_id INTEGER,
    description TEXT, notes TEXT, disposition TEXT, action_taken TEXT,
    assigned_unit_ids TEXT DEFAULT '[]', unit_call_signs TEXT,
    sector_id INTEGER, sector_name TEXT, zone_id TEXT, zone_name TEXT, zone_beat TEXT,
    beat_id TEXT, beat_name TEXT, beat_descriptor TEXT,
    weapons_involved TEXT, injuries_reported TEXT, domestic_violence TEXT,
    weather_conditions TEXT,
    starting_mileage REAL, ending_mileage REAL, overdue_notified INTEGER
  )`);
  // Shared Miniflare D1: an earlier file's CREATE TABLE IF NOT EXISTS can win
  // with a thinner schema. LIST_VIEW_SELECT then 500s (no such column).
  for (const sql of [
    'ALTER TABLE calls_for_service ADD COLUMN weather_conditions TEXT',
    'ALTER TABLE calls_for_service ADD COLUMN onscene_duration_seconds INTEGER',
    'ALTER TABLE calls_for_service ADD COLUMN response_time_seconds INTEGER',
  ]) {
    await execute(db, sql).catch(() => {});
  }
  await execute(db, `CREATE TABLE IF NOT EXISTS calls_for_service_ext (id INTEGER PRIMARY KEY, pinned INTEGER DEFAULT 0)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS properties (id INTEGER PRIMARY KEY, name TEXT, client_id INTEGER)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, full_name TEXT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY, name TEXT)`);

  await execute(db, "INSERT INTO calls_for_service (call_number, incident_type, status) VALUES ('2026-000950', 'alarm', 'pending')");
  await execute(db, "INSERT INTO calls_for_service (call_number, incident_type, status, cleared_at, disposition) VALUES ('2026-000951', 'alarm', 'cleared', datetime('now'), 'RESOLVED')");
  await execute(db, "INSERT INTO calls_for_service (call_number, incident_type, status, closed_at, disposition) VALUES ('2026-000952', 'patrol', 'closed', datetime('now'), 'UNFOUNDED')");
});

describe('GET /api/dispatch/calls — default pull (no status/archived param)', () => {
  it('includes cleared and closed calls, not just active-status ones', async () => {
    const res = await app.request('/api/dispatch/calls?limit=200', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ call_number: string; status: string }> };
    const numbers = body.data.map((r) => r.call_number);

    expect(numbers).toContain('2026-000950'); // pending — was already working
    expect(numbers).toContain('2026-000951'); // cleared — the bug: this was missing
    expect(numbers).toContain('2026-000952'); // closed — the bug: this was missing
  });
});
