// Route-level test (Miniflare/workerd) for POST /dispatch/calls/:id/hold and
// /:id/resume.
//
// These two routes used to be broken in two different ways at two different
// times:
//   1. Pre-2026-08: /hold unconditionally returned 409 HOLD_NOT_ENABLED,
//      citing "pending schema migration 0040" — even after migrations 0040
//      AND 0041 were both applied and tracked on live D1. The guard was
//      simply never removed once the migration landed.
//   2. The original real implementation (superseded by 0041) tried to model
//      hold as calls_for_service.status = 'on_hold'. That was reverted:
//      0041's header explains the live status CHECK constraint can't be
//      safely rebuilt without a full table swap, so hold is instead the
//      orthogonal calls_for_service_ext.held_at timestamp — status is left
//      untouched, and the CLIENT (dispatchMappers.ts) synthesizes the
//      display-only status='on_hold' from held_at.
//
// This test pins the CURRENT contract: hold sets held_at and leaves status
// alone; resume clears held_at; both return the merged call+ext row so the
// client's mapDbCall can re-derive the synthetic status immediately.
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
const CALL_ID = 5150;

beforeAll(async () => {
  await execute(db(), `CREATE TABLE IF NOT EXISTS calls_for_service (
    id INTEGER PRIMARY KEY, call_number TEXT, incident_type TEXT, priority TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN
      ('pending','dispatched','enroute','onscene','cleared','closed','cancelled','archived','on_hold')),
    location_address TEXT, assigned_unit_ids TEXT DEFAULT '[]',
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
     VALUES (?, '26-RMP-5150', 'alarm', 'P3', 'pending', '1 Test St',
             datetime('now'), datetime('now'))`, CALL_ID);
});

describe('POST /api/dispatch/calls/:id/hold', () => {
  it('no longer stubs a hardcoded 409 — sets held_at and leaves status alone', async () => {
    const res = await app.request(`/api/dispatch/calls/${CALL_ID}/hold`, { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).not.toBe('HOLD_NOT_ENABLED');
    expect(body.held_at).toBeTruthy();
    // Status is untouched — hold is orthogonal, not an enum value swap.
    expect(body.status).toBe('pending');

    const row = await queryFirst<{ held_at: string | null }>(db(), 'SELECT held_at FROM calls_for_service_ext WHERE id = ?', CALL_ID);
    expect(row?.held_at).toBeTruthy();
  });
});

describe('POST /api/dispatch/calls/:id/resume', () => {
  it('clears held_at back to NULL', async () => {
    // Precondition: the call is held from the previous test.
    const pre = await queryFirst<{ held_at: string | null }>(db(), 'SELECT held_at FROM calls_for_service_ext WHERE id = ?', CALL_ID);
    expect(pre?.held_at).toBeTruthy();

    const res = await app.request(`/api/dispatch/calls/${CALL_ID}/resume`, { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.held_at).toBeFalsy();

    const row = await queryFirst<{ held_at: string | null }>(db(), 'SELECT held_at FROM calls_for_service_ext WHERE id = ?', CALL_ID);
    expect(row?.held_at).toBeFalsy();
  });
});
