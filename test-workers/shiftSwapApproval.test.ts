// Route-level smoke test (Miniflare/workerd) for the target-acceptance
// step added on top of the existing swap approve/deny flow: target
// accepts -> pending_supervisor -> supervisor approves; target rejects
// -> denied, requester notified; and the PUT gate that blocks a
// supervisor from approving a still-unaccepted swap.
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

describe('Shift swap target-acceptance workflow', () => {
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
      target_responded_at TEXT,
      escalated_at TEXT,
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

    await execute(db, `CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    // Seed the notification_rules rows relevant to this test (mirrored
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
    await execute(db,
      `INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
       VALUES ('Shift swap target accepted', 'A named target officer accepted a shift swap -- ready for supervisor review.', 'shift_swap_target_accepted', '{}', '["admin","manager","supervisor"]', '[]', 'in_app', 1, 'System')`);
    await execute(db,
      `INSERT INTO notification_rules (name, description, trigger_event, conditions, target_roles, target_user_ids, notification_type, is_active, created_by_name)
       VALUES ('Shift swap escalated', 'A shift swap request has been awaiting action for over 24 hours.', 'shift_swap_escalated', '{}', '["admin","manager"]', '[]', 'in_app', 1, 'System')`);
  });

  async function seedUser(db: D1Database, username: string, role: string, fullName: string): Promise<number> {
    await execute(db,
      `INSERT INTO users (username, password_hash, full_name, role, status) VALUES (?, 'x', ?, ?, 'active')`,
      username, fullName, role);
    const row = await queryFirst<{ id: number }>(db, 'SELECT id FROM users WHERE username = ?', username);
    return row!.id;
  }

  async function createTargetedSwap(db: D1Database, requesterId: number, requesterToken: string, targetId: number, shiftDate: string) {
    const res = await shiftPlansRouter.request('/shift-swaps', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${requesterToken}` },
      body: JSON.stringify({ shift_date: shiftDate, target_id: targetId, reason: 'test' }),
    }, testEnv());
    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; id: number };
    return body.id;
  }

  it('target accepts a swap, moving it to pending_supervisor and notifying approvers', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    const requesterId = await seedUser(db, 'respond-req-1', 'officer', 'Officer Requester One');
    const targetId = await seedUser(db, 'respond-tgt-1', 'officer', 'Officer Target One');
    const adminId = await seedUser(db, 'respond-admin-1', 'admin', 'Admin Respond One');

    const requesterToken = await mintAccessToken(requesterId, 'officer', 'respond-req-1', 'Officer Requester One');
    const swapId = await createTargetedSwap(db, requesterId, requesterToken, targetId, '2026-09-01');

    const targetToken = await mintAccessToken(targetId, 'officer', 'respond-tgt-1', 'Officer Target One');
    const respondRes = await shiftPlansRouter.request(`/shift-swaps/${swapId}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${targetToken}` },
      body: JSON.stringify({ accept: true }),
    }, testEnv());
    expect(respondRes.status).toBe(200);
    const respondBody = await respondRes.json() as { success: boolean };
    expect(respondBody.success).toBe(true);

    const row = await queryFirst<{ status: string; target_responded_at: string | null }>(
      db, 'SELECT status, target_responded_at FROM shift_swap_requests WHERE id = ?', swapId,
    );
    expect(row?.status).toBe('pending_supervisor');
    expect(row?.target_responded_at).toBeTruthy();

    const notifRows = await db.prepare(
      `SELECT * FROM notifications WHERE entity_type = 'shift_swap_request' AND entity_id = ? AND user_id = ?`,
    ).bind(swapId, adminId).all();
    expect(notifRows.results.length).toBeGreaterThanOrEqual(1);

    const adminToken = await mintAccessToken(adminId, 'admin', 'respond-admin-1', 'Admin Respond One');
    const putRes = await shiftPlansRouter.request(`/shift-swaps/${swapId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'approved' }),
    }, testEnv());
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json() as { success: boolean };
    expect(putBody.success).toBe(true);
  });

  it('target rejects a swap, moving it directly to denied and notifying the requester', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    const requesterId = await seedUser(db, 'respond-req-2', 'officer', 'Officer Requester Two');
    const targetId = await seedUser(db, 'respond-tgt-2', 'officer', 'Officer Target Two');

    const requesterToken = await mintAccessToken(requesterId, 'officer', 'respond-req-2', 'Officer Requester Two');
    const swapId = await createTargetedSwap(db, requesterId, requesterToken, targetId, '2026-09-02');

    const targetToken = await mintAccessToken(targetId, 'officer', 'respond-tgt-2', 'Officer Target Two');
    const respondRes = await shiftPlansRouter.request(`/shift-swaps/${swapId}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${targetToken}` },
      body: JSON.stringify({ accept: false }),
    }, testEnv());
    expect(respondRes.status).toBe(200);
    const respondBody = await respondRes.json() as { success: boolean };
    expect(respondBody.success).toBe(true);

    const row = await queryFirst<{ status: string; target_responded_at: string | null; review_notes: string | null }>(
      db, 'SELECT status, target_responded_at, review_notes FROM shift_swap_requests WHERE id = ?', swapId,
    );
    expect(row?.status).toBe('denied');
    expect(row?.target_responded_at).toBeTruthy();
    expect(row?.review_notes).toContain('Officer Target Two');
    expect(row?.review_notes?.toLowerCase()).toContain('declined');

    const notifRows = await db.prepare(
      `SELECT * FROM notifications WHERE entity_type = 'shift_swap_request' AND entity_id = ? AND user_id = ?`,
    ).bind(swapId, requesterId).all();
    expect(notifRows.results.length).toBe(1);
  });

  it('rejects PUT /shift-swaps/:id while a targeted swap is still awaiting the target response', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    const requesterId = await seedUser(db, 'respond-req-3', 'officer', 'Officer Requester Three');
    const targetId = await seedUser(db, 'respond-tgt-3', 'officer', 'Officer Target Three');
    const adminId = await seedUser(db, 'respond-admin-3', 'admin', 'Admin Respond Three');

    const requesterToken = await mintAccessToken(requesterId, 'officer', 'respond-req-3', 'Officer Requester Three');
    const swapId = await createTargetedSwap(db, requesterId, requesterToken, targetId, '2026-09-03');

    const adminToken = await mintAccessToken(adminId, 'admin', 'respond-admin-3', 'Admin Respond Three');
    const putRes = await shiftPlansRouter.request(`/shift-swaps/${swapId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'approved' }),
    }, testEnv());
    expect(putRes.status).toBe(400);
    const putBody = await putRes.json() as { error: string };
    expect(putBody.error.toLowerCase()).toContain('response');

    const row = await queryFirst<{ status: string }>(db, 'SELECT status FROM shift_swap_requests WHERE id = ?', swapId);
    expect(row?.status).toBe('pending');
  });

  it('POST /shift-swaps/:id/respond is target-only -- 403 for anyone else, including admin', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    const requesterId = await seedUser(db, 'respond-req-4', 'officer', 'Officer Requester Four');
    const targetId = await seedUser(db, 'respond-tgt-4', 'officer', 'Officer Target Four');
    const adminId = await seedUser(db, 'respond-admin-4', 'admin', 'Admin Respond Four');

    const requesterToken = await mintAccessToken(requesterId, 'officer', 'respond-req-4', 'Officer Requester Four');
    const swapId = await createTargetedSwap(db, requesterId, requesterToken, targetId, '2026-09-04');

    const adminToken = await mintAccessToken(adminId, 'admin', 'respond-admin-4', 'Admin Respond Four');
    const respondRes = await shiftPlansRouter.request(`/shift-swaps/${swapId}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ accept: true }),
    }, testEnv());
    expect(respondRes.status).toBe(403);
  });

  it('POST /shift-swaps/:id/respond 400s when there is no target_id to respond to', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    const requesterId = await seedUser(db, 'respond-req-5', 'officer', 'Officer Requester Five');
    const otherOfficerId = await seedUser(db, 'respond-other-5', 'officer', 'Officer Other Five');

    const requesterToken = await mintAccessToken(requesterId, 'officer', 'respond-req-5', 'Officer Requester Five');
    const res = await shiftPlansRouter.request('/shift-swaps', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${requesterToken}` },
      body: JSON.stringify({ shift_date: '2026-09-05', reason: 'test open swap' }),
    }, testEnv());
    expect(res.status).toBe(201);
    const body = await res.json() as { id: number };

    const otherToken = await mintAccessToken(otherOfficerId, 'officer', 'respond-other-5', 'Officer Other Five');
    const respondRes = await shiftPlansRouter.request(`/shift-swaps/${body.id}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${otherToken}` },
      body: JSON.stringify({ accept: true }),
    }, testEnv());
    expect(respondRes.status).toBe(400);
  });

  it('GET /shift-swaps: a plain officer who is the target of a swap can see it (not a blanket 403)', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    const requesterId = await seedUser(db, 'list-req-1', 'officer', 'Officer List Requester One');
    const targetId = await seedUser(db, 'list-tgt-1', 'officer', 'Officer List Target One');

    const requesterToken = await mintAccessToken(requesterId, 'officer', 'list-req-1', 'Officer List Requester One');
    const swapId = await createTargetedSwap(db, requesterId, requesterToken, targetId, '2026-09-06');

    const targetToken = await mintAccessToken(targetId, 'officer', 'list-tgt-1', 'Officer List Target One');
    const listRes = await shiftPlansRouter.request('/shift-swaps', {
      method: 'GET',
      headers: { authorization: `Bearer ${targetToken}` },
    }, testEnv());
    expect(listRes.status).toBe(200);
    const rows = await listRes.json() as Array<{ id: number }>;
    expect(rows.some((r) => r.id === swapId)).toBe(true);
  });

  it('GET /shift-swaps: a plain officer who is neither requester nor target sees an empty list, not other people\'s swaps or a 403', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    const requesterId = await seedUser(db, 'list-req-2', 'officer', 'Officer List Requester Two');
    const targetId = await seedUser(db, 'list-tgt-2', 'officer', 'Officer List Target Two');
    const bystanderId = await seedUser(db, 'list-bystander-2', 'officer', 'Officer List Bystander Two');

    const requesterToken = await mintAccessToken(requesterId, 'officer', 'list-req-2', 'Officer List Requester Two');
    await createTargetedSwap(db, requesterId, requesterToken, targetId, '2026-09-07');

    const bystanderToken = await mintAccessToken(bystanderId, 'officer', 'list-bystander-2', 'Officer List Bystander Two');
    const listRes = await shiftPlansRouter.request('/shift-swaps', {
      method: 'GET',
      headers: { authorization: `Bearer ${bystanderToken}` },
    }, testEnv());
    expect(listRes.status).toBe(200);
    const rows = await listRes.json() as Array<{ id: number }>;
    expect(rows.length).toBe(0);
  });
});
