// test-workers/warrantsStatusTransitions.test.ts
// Route-level regression test (Miniflare/workerd) for the warrant status
// state machine (PUT /:id, PUT /:id/serve, POST /:id/reopen) added in the
// 2026-07-21 warrant-tab backend rebuild.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { execute, queryFirst } from '../src/utils/db';
import warrants from '../src/routes/warrants';

function buildApp(role: string) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 1, role, username: 'test-user' });
    c.set('userId', 1);
    await next();
  });
  app.route('/api/warrants', warrants);
  return app;
}

async function seedWarrant(db: D1Database, status: string): Promise<number> {
  const result = await execute(
    db,
    `INSERT INTO warrants (warrant_number, type, status, subject_name, charge_description, created_at, updated_at)
     VALUES (?, 'arrest', ?, 'Test Subject', 'test charge', datetime('now'), datetime('now'))`,
    `TEST-${Math.random()}`, status,
  );
  return Number(result.meta.last_row_id);
}

beforeEach(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS warrants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, warrant_number TEXT UNIQUE, type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', subject_name TEXT, subject_first_name TEXT,
    subject_last_name TEXT, subject_dob TEXT, subject_person_id INTEGER, charge_description TEXT,
    issuing_court TEXT, issuing_judge TEXT, bail_amount REAL, offense_level TEXT, expires_at TEXT,
    notes TEXT, statute_id INTEGER, statute_citation TEXT, source TEXT DEFAULT 'manual',
    entered_by INTEGER, created_by INTEGER, priority TEXT, served_at TEXT, served_by INTEGER,
    served_location TEXT, archived_at TEXT, issued_date TEXT, created_at TEXT, updated_at TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now')),
    user_id INTEGER, action TEXT, entity_type TEXT, entity_id TEXT, details TEXT
  )`);
  await execute(db, 'DELETE FROM warrants');
  await execute(db, 'DELETE FROM audit_log');
});

describe('PUT /api/warrants/:id — status transitions', () => {
  it('allows active -> quashed', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id = await seedWarrant(db, 'active');
    const app = buildApp('officer');
    const res = await app.request(`/api/warrants/${id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'quashed' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('quashed');
  });

  it('rejects served -> active directly (must use /reopen)', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id = await seedWarrant(db, 'served');
    const app = buildApp('officer');
    const res = await app.request(`/api/warrants/${id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_status_transition');
  });

  it('rejects an unknown status value', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id = await seedWarrant(db, 'active');
    const app = buildApp('officer');
    const res = await app.request(`/api/warrants/${id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_status');
  });

  it('allows a same-status no-op edit (e.g. updating notes)', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id = await seedWarrant(db, 'active');
    const app = buildApp('officer');
    const res = await app.request(`/api/warrants/${id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'active', notes: 'updated notes' }),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/warrants/:id/serve', () => {
  it('rejects serving an already-recalled warrant', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id = await seedWarrant(db, 'recalled');
    const app = buildApp('officer');
    const res = await app.request(`/api/warrants/${id}/serve`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/warrants/:id/reopen', () => {
  it('admin can reopen a terminal-status warrant back to active, and it is audit-logged', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id = await seedWarrant(db, 'quashed');
    const app = buildApp('admin');
    const res = await app.request(`/api/warrants/${id}/reopen`, { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('active');

    const logRow = await queryFirst<{ action: string; entity_id: string }>(
      db, `SELECT action, entity_id FROM audit_log WHERE action = 'warrant_reopen' AND entity_id = ?`, String(id),
    );
    expect(logRow).toBeTruthy();
  });

  it('officer cannot reopen (403)', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id = await seedWarrant(db, 'quashed');
    const app = buildApp('officer');
    const res = await app.request(`/api/warrants/${id}/reopen`, { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(403);
  });

  it('rejects reopening an already-active warrant', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id = await seedWarrant(db, 'active');
    const app = buildApp('admin');
    const res = await app.request(`/api/warrants/${id}/reopen`, { method: 'POST' }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('not_terminal');
  });
});

describe('GET /api/warrants/:id — lazy auto-expiry', () => {
  it('flips an overdue active warrant to expired on read, and persists the write', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id = await seedWarrant(db, 'active');
    // Backdate expires_at into the past.
    await execute(db, `UPDATE warrants SET expires_at = datetime('now', '-1 day') WHERE id = ?`, id);

    const app = buildApp('officer');
    const res = await app.request(`/api/warrants/${id}`, {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('expired');

    // Confirm the row was actually updated in D1, not just faked in the response.
    const row = await queryFirst<{ status: string }>(db, 'SELECT status FROM warrants WHERE id = ?', id);
    expect(row?.status).toBe('expired');
  });

  it('leaves a still-current active warrant alone', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id = await seedWarrant(db, 'active');
    await execute(db, `UPDATE warrants SET expires_at = datetime('now', '+30 days') WHERE id = ?`, id);

    const app = buildApp('officer');
    const res = await app.request(`/api/warrants/${id}`, {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('active');
  });
});

describe('GET /api/warrants — lazy auto-expiry (list)', () => {
  it('flips overdue active warrants in the returned page', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id = await seedWarrant(db, 'active');
    await execute(db, `UPDATE warrants SET expires_at = datetime('now', '-1 day') WHERE id = ?`, id);

    const app = buildApp('officer');
    const res = await app.request(`/api/warrants?per_page=50`, {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: number; status: string }> };
    const row = body.data.find((w) => w.id === id);
    expect(row?.status).toBe('expired');

    const dbRow = await queryFirst<{ status: string }>(db, 'SELECT status FROM warrants WHERE id = ?', id);
    expect(dbRow?.status).toBe('expired');
  });
});
