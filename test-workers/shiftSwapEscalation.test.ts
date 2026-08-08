// Miniflare-backed test for sweepShiftSwapEscalations against a real
// D1 binding shaped like migration 0229_shift_swap_approval_workflow.sql.
// tests/shiftSwapEscalationSweep.test.ts hand-mocks D1 entirely, so it
// can never catch a schema mismatch (wrong column name, etc.) — this
// file runs the sweep's actual SQL against a real shift_swap_requests
// table + the real notification-rule engine.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { sweepShiftSwapEscalations } from '../src/utils/shiftSwapEscalationSweep';
import { getDb, execute, queryFirst } from '../src/utils/db';

describe('sweepShiftSwapEscalations (real D1 schema)', () => {
  beforeAll(async () => {
    const db = getDb(env as unknown as { DB: D1Database });

    await execute(db, `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT, role TEXT NOT NULL DEFAULT 'officer', status TEXT NOT NULL DEFAULT 'active'
    )`);

    await execute(db, `CREATE TABLE IF NOT EXISTS shift_swap_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL REFERENCES users(id),
      requester_name TEXT,
      target_id INTEGER REFERENCES users(id),
      target_name TEXT,
      plan_id TEXT,
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

    // Mirrors migration 0229's 'shift_swap_escalated' rule: targets
    // admin/manager roles.
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

  it('escalates a pending swap older than 24 hours and notifies admin/manager', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    const requesterId = await seedUser(db, 'esc-req-1', 'officer', 'Officer Escalation Requester One');
    const targetId = await seedUser(db, 'esc-tgt-1', 'officer', 'Officer Escalation Target One');
    const adminId = await seedUser(db, 'esc-admin-1', 'admin', 'Admin Escalation One');

    await execute(db,
      `INSERT INTO shift_swap_requests (requester_id, requester_name, target_id, target_name, shift_date, status, created_at)
       VALUES (?, 'Officer Escalation Requester One', ?, 'Officer Escalation Target One', '2026-09-08', 'pending', datetime('now', '-25 hours'))`,
      requesterId, targetId);
    const staleRow = await queryFirst<{ id: number }>(db, 'SELECT id FROM shift_swap_requests WHERE requester_id = ?', requesterId);
    const staleId = staleRow!.id;

    const result = await sweepShiftSwapEscalations(db);
    expect(result.escalated).toBeGreaterThanOrEqual(1);

    const row = await queryFirst<{ escalated_at: string | null }>(
      db, 'SELECT escalated_at FROM shift_swap_requests WHERE id = ?', staleId,
    );
    expect(row?.escalated_at).toBeTruthy();

    const notifRows = await db.prepare(
      `SELECT * FROM notifications WHERE entity_type = 'shift_swap_request' AND entity_id = ? AND user_id = ?`,
    ).bind(staleId, adminId).all();
    expect(notifRows.results.length).toBeGreaterThanOrEqual(1);
  });

  it('does not escalate a pending swap created less than 24 hours ago', async () => {
    const db = getDb(env as unknown as { DB: D1Database });
    const requesterId = await seedUser(db, 'esc-req-2', 'officer', 'Officer Escalation Requester Two');
    const targetId = await seedUser(db, 'esc-tgt-2', 'officer', 'Officer Escalation Target Two');

    await execute(db,
      `INSERT INTO shift_swap_requests (requester_id, requester_name, target_id, target_name, shift_date, status, created_at)
       VALUES (?, 'Officer Escalation Requester Two', ?, 'Officer Escalation Target Two', '2026-09-09', 'pending', datetime('now', '-2 hours'))`,
      requesterId, targetId);
    const freshRow = await queryFirst<{ id: number }>(db, 'SELECT id FROM shift_swap_requests WHERE requester_id = ?', requesterId);
    const freshId = freshRow!.id;

    await sweepShiftSwapEscalations(db);

    const row = await queryFirst<{ escalated_at: string | null }>(
      db, 'SELECT escalated_at FROM shift_swap_requests WHERE id = ?', freshId,
    );
    expect(row?.escalated_at).toBeNull();
  });
});
