// PATCH /serve-intake/schedule/:slotId — overlap detection, the force
// override, and who is allowed to use it.
//
// Ordinary reschedules are open to dispatchers; forcing an overlap
// deliberately double-books an officer, so it is supervisor-and-above. These
// run the real router against Miniflare's D1 so the peer-detection SQL is
// exercised, not just the pure helper in serveScheduleEdit.ts.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import serveIntake from '../src/routes/serveIntake';

type Role = 'dispatcher' | 'supervisor' | 'manager' | 'admin' | 'officer';

function appAs(role: Role) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: any }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 42, role, username: `test_${role}`, full_name: `Test ${role}` });
    c.set('userId', 42);
    await next();
  });
  app.route('/serve-intake', serveIntake);
  return app;
}

const db = () => env.DB as unknown as import('@cloudflare/workers-types').D1Database;

const patch = (role: Role, slotId: number, body: unknown, force = false) =>
  appAs(role).request(
    `/serve-intake/schedule/${slotId}${force ? '?force=1' : ''}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    env as unknown as Record<string, unknown>,
  );

const DAY = '2026-08-03';

beforeAll(async () => {
  await db().prepare(`CREATE TABLE IF NOT EXISTS serve_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_name TEXT, case_number TEXT, officer_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending', priority TEXT DEFAULT 'normal'
  )`).run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS serve_attempt_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_id INTEGER NOT NULL, attempt_number INTEGER DEFAULT 1,
    scheduled_date TEXT NOT NULL, window_start TEXT NOT NULL, window_end TEXT NOT NULL,
    window_label TEXT, notify_at TEXT, notify_before_secs INTEGER DEFAULT 3600,
    notified INTEGER DEFAULT 0, dismissed INTEGER DEFAULT 0,
    officer_id INTEGER, manually_moved INTEGER DEFAULT 0,
    moved_by_user_id INTEGER, moved_at TEXT, auto_replan_source INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
});

beforeEach(async () => {
  await db().prepare('DELETE FROM serve_attempt_schedules').run();
  await db().prepare('DELETE FROM serve_queue').run();
  await db().prepare(
    `INSERT INTO serve_queue (id, recipient_name, case_number, officer_id, status)
     VALUES (1, 'Jane Rodriguez', '240-1', 7, 'pending'), (2, 'Bob Chen', '240-2', 7, 'pending')`,
  ).run();
  // Slot 1 = the one being moved. Slot 2 = the incumbent it will collide with.
  await db().prepare(
    `INSERT INTO serve_attempt_schedules (id, queue_id, scheduled_date, window_start, window_end, officer_id, dismissed)
     VALUES (1, 1, ?, '14:00', '16:00', 7, 0), (2, 2, ?, '08:00', '10:00', 7, 0)`,
  ).bind(DAY, DAY).run();
});

const intoConflict = { scheduled_date: DAY, window_start: '08:00', window_end: '10:00' };

describe('overlap detection', () => {
  it('rejects an overlapping move with 409 and names the conflict', async () => {
    const res = await patch('supervisor', 1, intoConflict);
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string; conflicts: Array<{ id: number; recipient_name: string }> };
    expect(body.error).toBe('overlap');
    expect(body.conflicts.map((c) => c.id)).toEqual([2]);
    // The join is what lets the client say who, instead of the bare word "overlap".
    expect(body.conflicts[0].recipient_name).toBe('Bob Chen');
  });

  it('allows a non-overlapping move', async () => {
    const res = await patch('dispatcher', 1, { scheduled_date: DAY, window_start: '18:00', window_end: '20:00' });
    expect(res.status).toBe(200);
  });

  it('does NOT let a dismissed slot block the move', async () => {
    // GET /schedule hides dismissed rows, so before this fix a dismissed peer
    // was an invisible blocker: empty band on screen, "overlap" on drop.
    await db().prepare('UPDATE serve_attempt_schedules SET dismissed = 1 WHERE id = 2').run();
    const res = await patch('dispatcher', 1, intoConflict);
    expect(res.status).toBe(200);
  });

  it('does not treat a different officer as a conflict', async () => {
    await db().prepare('UPDATE serve_attempt_schedules SET officer_id = 9 WHERE id = 2').run();
    const res = await patch('dispatcher', 1, intoConflict);
    expect(res.status).toBe(200);
  });
});

describe('force override — role gate', () => {
  it.each<Role>(['supervisor', 'manager', 'admin'])('lets %s force the overlap through', async (role) => {
    const res = await patch(role, 1, intoConflict, true);
    expect(res.status).toBe(200);
    const row = await db().prepare('SELECT window_start FROM serve_attempt_schedules WHERE id = 1').first<{ window_start: string }>();
    expect(row!.window_start).toBe('08:00');
  });

  it('refuses a dispatcher forcing an overlap', async () => {
    const res = await patch('dispatcher', 1, intoConflict, true);
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('force_forbidden');
    // And the row must be untouched — a refused force cannot half-apply.
    const row = await db().prepare('SELECT window_start FROM serve_attempt_schedules WHERE id = 1').first<{ window_start: string }>();
    expect(row!.window_start).toBe('14:00');
  });

  it('still lets a dispatcher do an ordinary non-forced reschedule', async () => {
    // The force gate must not accidentally tighten the whole endpoint.
    const res = await patch('dispatcher', 1, { scheduled_date: DAY, window_start: '20:00', window_end: '22:00' });
    expect(res.status).toBe(200);
  });

  it('refuses an officer entirely — force or not', async () => {
    expect((await patch('officer', 1, intoConflict)).status).toBe(403);
    expect((await patch('officer', 1, intoConflict, true)).status).toBe(403);
  });
});
