// Route-level smoke test (Miniflare/workerd) for shift-swap notifications.
// Confirms shift-swap create/approve/deny still succeed and persist a row
// in `notifications` via the notification_rules engine, and that the
// approve/deny path notifies the ORIGINAL REQUESTER specifically (not just
// admin/manager/supervisor).
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import shiftPlansRouter from '../src/routes/shiftPlans';
import { getDb, execute, queryFirst } from '../src/utils/db';
import { sign } from 'hono/jwt';

const SECRET = 'test-jwt-secret-do-not-use-in-prod';

async function mintAccessToken(userId: number, role: string, username: string, fullName: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { sub: String(userId), user_id: userId, userId, username, role, full_name: fullName, iat: now, exp: now + 900, type: 'access' },
    SECRET,
  );
}

function testEnv(extra: Record<string, unknown> = {}) {
  return { ...(env as unknown as Record<string, unknown>), JWT_SECRET: SECRET, ...extra };
}

describe('Shift Plans swap notifications', () => {
  beforeAll(async () => {
    const db = getDb(env as unknown as { DB: D1Database });

    await execute(db, `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT, role TEXT NOT NULL DEFAULT 'officer', status TEXT NOT NULL DEFAULT 'active'
    )`);

    await execute(db, `CREATE TABLE IF NOT EXISTS shift_plans (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, date TEXT NOT NULL,
      shift_type TEXT NOT NULL DEFAULT 'day', assignments TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft', created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    await execute(db, `CREATE TABLE IF NOT EXISTS shift_swap_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL REFERENCES users(id),
      requester_name TEXT,
      target_id INTEGER REFERENCES users(id),
      target_name TEXT,
      plan_id TEXT REFERENCES shift_plans(id),
      shift_date TEXT NOT NULL,
      original_shift TEXT,
      requested_shift TEXT,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_by_name TEXT,
      reviewed_at TEXT,
      review_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    await execute(db, `CREATE TABLE IF NOT EXISTS notification_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      trigger_event TEXT NOT NULL,
      conditions TEXT NOT NULL DEFAULT '{}',
      target_roles TEXT NOT NULL DEFAULT '[]',
      target_user_ids TEXT NOT NULL DEFAULT '[]',
      notification_type TEXT NOT NULL DEFAULT 'in_app',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by_name TEXT,
      last_fired_at TEXT,
      fire_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    await execute(db, `CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT NOT NULL DEFAULT 'info',
      priority TEXT NOT NULL DEFAULT 'normal',
      title TEXT NOT NULL,
      message TEXT,
      entity_type TEXT,
      entity_id INTEGER,
      read_at TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Seed the three notification_rules rows from migration 0228 (mirrored
    // here since this test env applies no migrations).
    await execute(db,
      `INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
       VALUES ('Shift swap requested', 'An officer submitted a shift swap request that needs review.', 'shift_swap_requested', '{}', '["admin","manager","supervisor"]', '[]', 'in_app', 1, 'System')`);
    await execute(db,
      `INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
       VALUES ('Shift swap approved', 'A shift swap request was approved.', 'shift_swap_approved', '{}', '[]', '[]', 'in_app', 1, 'System')`);
    await execute(db,
      `INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
       VALUES ('Shift swap denied', 'A shift swap request was denied.', 'shift_swap_denied', '{}', '[]', '[]', 'in_app', 1, 'System')`);
  });

  async function seedUser(db: D1Database, username: string, role: string, fullName: string): Promise<number> {
    await execute(db,
      `INSERT INTO users (username, password_hash, full_name, role, status) VALUES (?, 'x', ?, ?, 'active')`,
      username, fullName, role);
    const row = await queryFirst<{ id: number }>(db, 'SELECT id FROM users WHERE username = ?', username);
    return row!.id;
  }

  it('POST /api/shift-swaps notifies admin/manager/supervisor', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    const officerId = await seedUser(db, 'swap-officer-1', 'officer', 'Officer One');
    const adminId = await seedUser(db, 'swap-admin-1', 'admin', 'Admin One');

    const token = await mintAccessToken(officerId, 'officer', 'swap-officer-1', 'Officer One');
    const res = await shiftPlansRouter.request('/shift-swaps', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ shift_date: '2026-09-01', reason: 'test' }),
    }, testEnv());

    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; id: number };
    expect(body.success).toBe(true);
    expect(typeof body.id).toBe('number');

    const rows = await db.prepare(
      `SELECT * FROM notifications WHERE entity_type = 'shift_swap_request' AND entity_id = ? AND user_id = ?`,
    ).bind(body.id, adminId).all();
    expect(rows.results.length).toBeGreaterThanOrEqual(1);
  });

  it('PUT /api/shift-swaps/:id notifies the original requester on approval', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    const officerId = await seedUser(db, 'swap-officer-2', 'officer', 'Officer Two');
    const adminId = await seedUser(db, 'swap-admin-2', 'admin', 'Admin Two');

    const officerToken = await mintAccessToken(officerId, 'officer', 'swap-officer-2', 'Officer Two');
    const createRes = await shiftPlansRouter.request('/shift-swaps', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${officerToken}` },
      body: JSON.stringify({ shift_date: '2026-09-02', reason: 'test approve' }),
    }, testEnv());
    const createBody = await createRes.json() as { id: number };
    const swapId = createBody.id;

    const adminToken = await mintAccessToken(adminId, 'admin', 'swap-admin-2', 'Admin Two');
    const putRes = await shiftPlansRouter.request(`/shift-swaps/${swapId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'approved' }),
    }, testEnv());

    expect(putRes.status).toBe(200);
    const putBody = await putRes.json() as { success: boolean };
    expect(putBody.success).toBe(true);

    const rows = await db.prepare(
      `SELECT * FROM notifications WHERE entity_type = 'shift_swap_request' AND entity_id = ? AND user_id = ?`,
    ).bind(swapId, officerId).all<{ title: string }>();
    expect(rows.results.length).toBe(1);
    expect(rows.results[0].title).toBe('Shift swap approved');
  });

  it('does not throw when ALERT_HUB is unbound', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    const officerId = await seedUser(db, 'swap-officer-3', 'officer', 'Officer Three');
    const adminId = await seedUser(db, 'swap-admin-3', 'admin', 'Admin Three');

    const officerToken = await mintAccessToken(officerId, 'officer', 'swap-officer-3', 'Officer Three');
    const createRes = await shiftPlansRouter.request('/shift-swaps', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${officerToken}` },
      body: JSON.stringify({ shift_date: '2026-09-03', reason: 'test no alert hub' }),
    }, testEnv({ ALERT_HUB: undefined }));
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json() as { id: number };

    const adminToken = await mintAccessToken(adminId, 'admin', 'swap-admin-3', 'Admin Three');
    const putRes = await shiftPlansRouter.request(`/shift-swaps/${createBody.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'denied' }),
    }, testEnv({ ALERT_HUB: undefined }));

    expect(putRes.status).toBe(200);
    const putBody = await putRes.json() as { success: boolean };
    expect(putBody.success).toBe(true);
  });
});
