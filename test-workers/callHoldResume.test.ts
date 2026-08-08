// Route-level test (Miniflare/workerd) for POST /dispatch/calls/:id/hold and
// /:id/resume.
//
// These returned a hardcoded 409 for months after migration 0040
// ('on_hold' added to the status CHECK enum) had already landed on live D1
// — the guard comment cited a precondition that was already satisfied, so
// every hold request failed with "pending schema migration 0040" regardless
// of schema state. The eventual fix (migration 0041) moved hold to an
// orthogonal calls_for_service_ext.held_at flag instead of the status enum,
// so status is left untouched while held and resume simply clears the flag.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute, queryFirst } from '../src/utils/db';
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
const CALL_ID = 5151;

beforeAll(async () => {
  await execute(db(), `CREATE TABLE IF NOT EXISTS calls_for_service (
    id INTEGER PRIMARY KEY, call_number TEXT, incident_type TEXT, priority TEXT,
    status TEXT, location_address TEXT, assigned_unit_ids TEXT DEFAULT '[]',
    property_id INTEGER, dispatcher_id INTEGER, client_id INTEGER,
    created_at TEXT, updated_at TEXT
  )`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS calls_for_service_ext (
    id INTEGER PRIMARY KEY, held_at TEXT
  )`);

  await execute(db(), 'DELETE FROM calls_for_service WHERE id = ?', CALL_ID);
  await execute(db(), 'DELETE FROM calls_for_service_ext WHERE id = ?', CALL_ID);

  await execute(db(),
    `INSERT INTO calls_for_service (id, call_number, incident_type, priority, status,
       location_address, created_at, updated_at)
     VALUES (?, '26-RMP-5151', 'alarm', 'P2', 'dispatched', '1 Test St',
             datetime('now'), datetime('now'))`, CALL_ID);
});

describe('POST /api/dispatch/calls/:id/hold and /resume', () => {
  it('hold sets held_at and returns the merged row without touching status', async () => {
    const res = await app.request(`/api/dispatch/calls/${CALL_ID}/hold`, { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.held_at).toBeTruthy();
    expect(body.status).toBe('dispatched');

    const row = await queryFirst<{ held_at: string | null }>(db(), 'SELECT held_at FROM calls_for_service_ext WHERE id = ?', CALL_ID);
    expect(row?.held_at).toBeTruthy();
  });

  it('resume clears held_at and preserves the real status', async () => {
    const res = await app.request(`/api/dispatch/calls/${CALL_ID}/resume`, { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.held_at).toBeFalsy();
    expect(body.status).toBe('dispatched');

    const row = await queryFirst<{ held_at: string | null }>(db(), 'SELECT held_at FROM calls_for_service_ext WHERE id = ?', CALL_ID);
    expect(row?.held_at).toBeFalsy();
  });
});
