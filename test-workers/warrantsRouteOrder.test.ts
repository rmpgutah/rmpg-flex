// test-workers/warrantsRouteOrder.test.ts
//
// Regression guard for LITERAL PATHS SHADOWED BY /:id.
//
// GET /warrants/summary-report and PUT /warrants/batch-update were registered
// BELOW warrants.get('/:id') and were therefore dead in production for as long
// as they existed — both returned 400 {"error":"Invalid warrant id"}, verified
// against live api.rmpgutah.us on 2026-07-30. They sat there on the strength of a
// code comment claiming Hono's radix trie "prioritizes static segments
// regardless of declaration order". Production did not behave that way.
//
// These tests assert the SPECIFIC failure mode (that exact 400 body), not merely
// "responds 2xx" — a route that 500s on a missing table would satisfy a loose
// assertion while still being shadowed.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import warrants from '../src/routes/warrants';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string } } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 7, role: 'admin' });
  await next();
});
app.route('/api/warrants', warrants);

const SHADOW_ERROR = 'Invalid warrant id';

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, warrant_number TEXT, type TEXT DEFAULT 'arrest',
    status TEXT NOT NULL DEFAULT 'active', subject_person_id INTEGER, subject_name TEXT,
    subject_first_name TEXT, subject_last_name TEXT, charge_description TEXT, bail_amount REAL,
    offense_level TEXT, issuing_court TEXT, source TEXT, archived_at TEXT, expires_at TEXT,
    served_at TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS warrant_watch_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, started_at TEXT, completed_at TEXT,
    persons_checked INTEGER DEFAULT 0, new_warrants_found INTEGER DEFAULT 0,
    warrants_cleared INTEGER DEFAULT 0, errors INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running', error_message TEXT
  )`);
  await execute(db, `INSERT INTO warrants (id, warrant_number, status) VALUES (10, 'W-10', 'active')`);
});

describe('literal warrant paths are not shadowed by /:id', () => {
  it('GET /summary-report reaches its own handler, not /:id', async () => {
    const res = await app.request('/api/warrants/summary-report', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as Record<string, unknown>;
    // The shadowing signature: /:id ran, parseInt('summary-report') was NaN, 400.
    expect(body.error).not.toBe(SHADOW_ERROR);
    expect(res.status).not.toBe(400);
    // And it really is the summary handler — byStatus is unique to its response.
    expect(body).toHaveProperty('byStatus');
  });

  it('PUT /batch-update reaches its own handler, not /:id', async () => {
    const res = await app.request('/api/warrants/batch-update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [10], status: 'recalled' }),
    }, env as unknown as Record<string, unknown>);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).not.toBe(SHADOW_ERROR);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, updated: 1 });
  });

  it('PUT /batch-update still validates its own body (proves the right handler ran)', async () => {
    // /:id would also 400 here — but with the shadow message. Asserting the
    // handler's OWN validation message pins which branch executed.
    const res = await app.request('/api/warrants/batch-update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [], status: '' }),
    }, env as unknown as Record<string, unknown>);
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(400);
    expect(body.error).toBe('ids and status required');
    expect(body.error).not.toBe(SHADOW_ERROR);
  });

  it('/:id still works for a real numeric id (no collateral damage)', async () => {
    const res = await app.request('/api/warrants/10', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
  });

  it('/:id still rejects a genuinely non-numeric id', async () => {
    const res = await app.request('/api/warrants/not-a-number', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(400);
    expect(body.error).toBe(SHADOW_ERROR);
  });
});
