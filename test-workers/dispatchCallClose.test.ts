// Route-level regression test (Miniflare/workerd) for POST
// /api/dispatch/calls/:id/status. Bug: clearing/closing/cancelling a call
// updated calls_for_service.status but never released the units that were
// assigned to it — units stayed 'dispatched' with current_call_id pointing
// at the now-dead call forever (assign-unit sets that pair; nothing except
// the per-unit unassign-unit route ever reversed it). The client's
// handleStatusChange already refreshes units immediately after a
// cleared/closed/cancelled transition expecting them to come back
// 'available' — this test proves the server side actually does that now.
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
    call_number TEXT UNIQUE,
    incident_type TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'P3',
    status TEXT NOT NULL DEFAULT 'pending',
    location_address TEXT,
    assigned_unit_ids TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    dispatched_at TEXT, enroute_at TEXT, onscene_at TEXT,
    cleared_at TEXT, closed_at TEXT, disposition TEXT,
    updated_at TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_sign TEXT UNIQUE NOT NULL,
    officer_id INTEGER,
    status TEXT NOT NULL DEFAULT 'available',
    current_call_id INTEGER,
    last_status_change TEXT
  )`);
});

describe('POST /api/dispatch/calls/:id/status — releases assigned units on close', () => {
  it('clearing a call frees every unit that was assigned to it', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, "INSERT INTO units (call_sign, status) VALUES ('P12', 'available'), ('S3', 'available')");
    const call = await execute(db,
      "INSERT INTO calls_for_service (call_number, incident_type, status, assigned_unit_ids) VALUES ('2026-000900', 'alarm', 'onscene', '[1,2]')");
    const callId = (call as unknown as D1Result).meta.last_row_id;
    await execute(db, "UPDATE units SET status = 'dispatched', current_call_id = ? WHERE id IN (1,2)", callId);

    const res = await app.request(
      `/api/dispatch/calls/${callId}/status`,
      { method: 'POST', body: JSON.stringify({ status: 'cleared', disposition: 'RESOLVED' }) },
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);

    const units = await db.prepare('SELECT id, status, current_call_id FROM units ORDER BY id').all();
    for (const u of units.results as { id: number; status: string; current_call_id: number | null }[]) {
      expect(u.status).toBe('available');
      expect(u.current_call_id).toBeNull();
    }
  });

  it('a non-terminal transition (dispatched) does NOT release units', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    await execute(db, "INSERT INTO units (call_sign, status) VALUES ('P44', 'dispatched')");
    const unitRow = await db.prepare("SELECT id FROM units WHERE call_sign = 'P44'").first() as { id: number };
    const call = await execute(db,
      "INSERT INTO calls_for_service (call_number, incident_type, status, assigned_unit_ids) VALUES ('2026-000901', 'patrol', 'dispatched', ?)",
      JSON.stringify([unitRow.id]));
    const callId = (call as unknown as D1Result).meta.last_row_id;
    await execute(db, 'UPDATE units SET current_call_id = ? WHERE id = ?', callId, unitRow.id);

    const res = await app.request(
      `/api/dispatch/calls/${callId}/status`,
      { method: 'POST', body: JSON.stringify({ status: 'enroute' }) },
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);

    const unit = await db.prepare('SELECT status, current_call_id FROM units WHERE id = ?').bind(unitRow.id).first() as { status: string; current_call_id: number };
    expect(unit.status).toBe('dispatched');
    expect(unit.current_call_id).toBe(callId);
  });
});
