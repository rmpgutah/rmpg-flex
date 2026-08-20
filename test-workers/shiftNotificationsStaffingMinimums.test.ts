// Route-level test (Miniflare/workerd) for GET /api/shift-notifications.
//
// The understaffed check here used a flat `assignments.length < 2` for
// every shift type, while GET /staffing-levels (same file) used
// per-shift-type minimums ({day:2, swing:2, graveyard:1}). A graveyard
// shift with exactly 1 assignment met its own minimum but was still
// flagged "understaffed" by this endpoint — a contradicting verdict
// between the notification bell and the staffing-levels page for the
// same shift. Both endpoints now read from the shared
// SHIFT_STAFFING_MINIMUMS constant in src/routes/shiftPlans.ts.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { getDb, execute, queryFirst } from '../src/utils/db';
import shiftPlans from '../src/routes/shiftPlans';

const app = new Hono<{ Bindings: Record<string, unknown> }>();
app.route('/api', shiftPlans);

async function authHeaders(): Promise<Record<string, string>> {
  const { SignJWT } = await import('jose');
  const db = getDb(env as unknown as { DB: D1Database });
  await execute(db, `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT, role TEXT NOT NULL DEFAULT 'officer',
    status TEXT NOT NULL DEFAULT 'active'
  )`);

  const username = 'shift-notifications-admin';
  let row = await queryFirst<{ id: number }>(db, 'SELECT id FROM users WHERE username = ?', username);
  if (!row) {
    await execute(
      db,
      `INSERT INTO users (username, password_hash, full_name, role, status) VALUES (?, 'x', ?, 'admin', 'active')`,
      username,
      'Shift Notifications Admin',
    );
    row = await queryFirst<{ id: number }>(db, 'SELECT id FROM users WHERE username = ?', username);
  }

  const secret = new TextEncoder().encode(env.JWT_SECRET as string);
  const token = await new SignJWT({ userId: row!.id, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(secret);
  return { Authorization: `Bearer ${token}` };
}

function todayPlusDays(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

beforeAll(async () => {
  const db = getDb(env as unknown as { DB: D1Database });
  await execute(db, `CREATE TABLE IF NOT EXISTS shift_plans (
    id TEXT PRIMARY KEY, name TEXT, date TEXT, shift_type TEXT,
    assignments TEXT DEFAULT '[]', status TEXT DEFAULT 'draft',
    created_by INTEGER, created_at TEXT, updated_at TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS shift_swap_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT DEFAULT 'pending'
  )`);

  await execute(db, `DELETE FROM shift_plans WHERE id LIKE 'sn-test-%'`);

  const oneOfficer = JSON.stringify([{ officer_id: 1, name: 'Officer A' }]);

  // Graveyard with 1 assignment meets its minimum of 1 — should NOT be flagged.
  await execute(db,
    `INSERT INTO shift_plans (id, name, date, shift_type, assignments, status, created_at, updated_at)
     VALUES ('sn-test-grave', 'Test Grave', ?, 'graveyard', ?, 'active', datetime('now'), datetime('now'))`,
    todayPlusDays(1), oneOfficer);

  // Day with 1 assignment is below its minimum of 2 — should be flagged.
  await execute(db,
    `INSERT INTO shift_plans (id, name, date, shift_type, assignments, status, created_at, updated_at)
     VALUES ('sn-test-day', 'Test Day', ?, 'day', ?, 'active', datetime('now'), datetime('now'))`,
    todayPlusDays(2), oneOfficer);

  // Swing with 1 assignment is below its minimum of 2 — should be flagged.
  await execute(db,
    `INSERT INTO shift_plans (id, name, date, shift_type, assignments, status, created_at, updated_at)
     VALUES ('sn-test-swing', 'Test Swing', ?, 'swing', ?, 'active', datetime('now'), datetime('now'))`,
    todayPlusDays(3), oneOfficer);
});

describe('GET /api/shift-notifications staffing minimums', () => {
  it('does not flag a graveyard shift with 1 assignment as understaffed', async () => {
    const res = await app.request('/api/shift-notifications', { headers: await authHeaders() }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { notifications: Array<{ type: string; date?: string }> };
    const graveHit = body.notifications.find((n) => n.type === 'understaffed' && n.date === todayPlusDays(1));
    expect(graveHit).toBeUndefined();
  });

  it('still flags day and swing shifts with 1 assignment as understaffed', async () => {
    const res = await app.request('/api/shift-notifications', { headers: await authHeaders() }, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { notifications: Array<{ type: string; date?: string }> };
    const dayHit = body.notifications.find((n) => n.type === 'understaffed' && n.date === todayPlusDays(2));
    const swingHit = body.notifications.find((n) => n.type === 'understaffed' && n.date === todayPlusDays(3));
    expect(dayHit).toBeTruthy();
    expect(swingHit).toBeTruthy();
  });
});
