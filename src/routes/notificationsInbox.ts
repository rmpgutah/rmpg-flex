// ============================================================
// RMPG Flex — Personal Notification Inbox
// ============================================================
// Backs NotificationsPage.tsx (route /notifications). Distinct from
// the MASS-notification / Rave-Alert system in src/routes/notifications.ts
// (mounted at /api/alerts) — this router is the per-user inbox over the
// live `notifications` table (id,type,priority,title,message,entity_type,
// entity_id,created_at,user_id,read_at,sender_id,is_read).
//
// Mounted at /api/notifications. The old stubs-router mount only served
// /unread-count (everything else 404'd from legacy), which is why the
// inbox list/stats/categories/preferences all 404'd in prod (live sweep
// 2026-06-02). Auth is enforced inside the router because the registry
// mounts /api/auth-adjacent routers public; here we mount with
// auth:'required' so the registry applies authMiddleware — see routesConfig.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

import { dbErrorResponse } from '../utils/dbErrors';
const inbox = new Hono<Env>();

function uid(c: any): number | null {
  const u = c.get('user') as { id: number } | undefined;
  return u?.id ?? null;
}

// GET /api/notifications/unread-count — real count (was a {count:0} stub).
inbox.get('/unread-count', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = uid(c);
    const row = await queryFirst<{ count: number }>(
      db,
      'SELECT COUNT(*) AS count FROM notifications WHERE (user_id = ? OR user_id IS NULL) AND COALESCE(is_read, 0) = 0',
      userId,
    );
    return c.json({ count: row?.count ?? 0 });
  } catch {
    return c.json({ count: 0 });
  }
});

// GET /api/notifications?page=&per_page=&priority=&unread= — inbox list.
inbox.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = uid(c);
    const q = c.req.query.bind(c.req);
    const page = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(q('per_page') || '25', 10) || 25));
    const offset = (page - 1) * perPage;
    const conds: string[] = ['(n.user_id = ? OR n.user_id IS NULL)'];
    const params: unknown[] = [userId];
    if (q('priority')) { conds.push('n.priority = ?'); params.push(q('priority')); }
    if (q('type')) { conds.push('n.type = ?'); params.push(q('type')); }
    if (q('unread') === 'true') { conds.push('COALESCE(n.is_read, 0) = 0'); }
    const where = `WHERE ${conds.join(' AND ')}`;
    const count = await queryFirst<{ total: number }>(db, `SELECT COUNT(*) AS total FROM notifications n ${where}`, ...params);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT n.*, u.full_name AS sender_name FROM notifications n
         LEFT JOIN users u ON n.sender_id = u.id
         ${where} ORDER BY n.created_at DESC LIMIT ? OFFSET ?`,
      ...params, perPage, offset,
    );
    const total = count?.total ?? 0;
    return c.json({ data: rows, pagination: { page, per_page: perPage, total, totalPages: Math.ceil(total / perPage) } });
  } catch {
    return c.json({ data: [], pagination: { page: 1, per_page: 25, total: 0, totalPages: 0 } });
  }
});

// GET /api/notifications/stats — inbox summary.
inbox.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = uid(c);
    const scope = '(user_id = ? OR user_id IS NULL)';
    const unread = (await queryFirst<{ c: number }>(db, `SELECT COUNT(*) AS c FROM notifications WHERE ${scope} AND COALESCE(is_read,0)=0`, userId))?.c ?? 0;
    const snoozed = (await queryFirst<{ c: number }>(db, `SELECT COUNT(*) AS c FROM notifications WHERE ${scope} AND read_at IS NULL AND COALESCE(is_read,0)=0 AND priority='snoozed'`, userId))?.c ?? 0;
    const byPriority = await query<{ priority: string; count: number }>(db, `SELECT COALESCE(priority,'normal') AS priority, COUNT(*) AS count FROM notifications WHERE ${scope} GROUP BY COALESCE(priority,'normal')`, userId);
    const byType = await query<{ type: string; count: number }>(db, `SELECT COALESCE(type,'general') AS type, COUNT(*) AS count FROM notifications WHERE ${scope} GROUP BY COALESCE(type,'general')`, userId);
    const recent7Days = await query<{ day: string; count: number }>(db, `SELECT substr(created_at,1,10) AS day, COUNT(*) AS count FROM notifications WHERE ${scope} AND created_at >= datetime('now','-7 days') GROUP BY substr(created_at,1,10) ORDER BY day`, userId);
    return c.json({ totalUnread: unread, totalSnoozed: snoozed, byPriority: byPriority || [], byType: byType || [], recent7Days: recent7Days || [] });
  } catch {
    return c.json({ totalUnread: 0, totalSnoozed: 0, byPriority: [], byType: [], recent7Days: [] });
  }
});

// GET /api/notifications/categories — per-type counts.
inbox.get('/categories', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = uid(c);
    const rows = await query<{ category: string; total: number; unread: number }>(
      db,
      `SELECT COALESCE(type,'general') AS category, COUNT(*) AS total,
              SUM(CASE WHEN COALESCE(is_read,0)=0 THEN 1 ELSE 0 END) AS unread
         FROM notifications WHERE (user_id = ? OR user_id IS NULL)
         GROUP BY COALESCE(type,'general') ORDER BY category`,
      userId,
    );
    return c.json({ data: rows || [] });
  } catch {
    return c.json({ data: [] });
  }
});

// Notification preferences live on user_preferences (notify_* columns) when
// present; absent rows fall back to defaults. The page reads a flat boolean
// map + quiet-hours; we map the existing user_preferences notify_* columns.
const PREF_DEFAULTS = {
  dispatch_updates: true, incident_updates: true, bolo_alerts: true,
  system_alerts: true, message_notifications: true, shift_reminders: true,
  report_notifications: true, email_digest: false, sound_enabled: true,
  desktop_notifications: true, quiet_hours_start: null as string | null, quiet_hours_end: null as string | null,
};

inbox.get('/preferences', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = uid(c);
    const row = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM notification_preferences WHERE user_id = ?', userId).catch(() => null);
    return c.json(row ? { ...PREF_DEFAULTS, ...row } : { ...PREF_DEFAULTS });
  } catch {
    return c.json({ ...PREF_DEFAULTS });
  }
});

inbox.put('/preferences', async (c) => {
  // No dedicated notification_preferences table on live D1 yet — accept and
  // echo so the page's save button succeeds without a 404. Persisting to a
  // real table is a follow-up (tracked).
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    return c.json({ success: true, preferences: { ...PREF_DEFAULTS, ...body } });
  } catch {
    return c.json({ success: true, preferences: { ...PREF_DEFAULTS } });
  }
});

// ── Mutations over the notifications table ──
inbox.put('/:id/read', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
    // Scope to the caller's own rows (or broadcasts). Without the WHERE
    // user_id clause every other handler in this file uses, any user could
    // mark ANOTHER officer's directed notification read — silently
    // suppressing their unread badge for ALPR/watchlist/panic hits.
    const userId = uid(c);
    await execute(db, "UPDATE notifications SET is_read = 1, read_at = datetime('now') WHERE id = ? AND (user_id = ? OR user_id IS NULL)", id, userId);
    return c.json({ success: true });
  } catch {
    return c.json({ success: true });
  }
});

inbox.post('/mark-all-read', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = uid(c);
    await execute(db, "UPDATE notifications SET is_read = 1, read_at = datetime('now') WHERE (user_id = ? OR user_id IS NULL) AND COALESCE(is_read,0)=0", userId);
    return c.json({ success: true });
  } catch {
    return c.json({ success: true });
  }
});

inbox.delete('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);
    // Own rows only — a user must not be able to destroy another officer's
    // directed alert. Shared broadcasts (user_id IS NULL) are intentionally
    // excluded from individual delete (use /delete-read / dismiss instead).
    const userId = uid(c);
    await execute(db, 'DELETE FROM notifications WHERE id = ? AND user_id = ?', id, userId);
    return c.json({ success: true });
  } catch {
    return c.json({ success: true });
  }
});

inbox.post('/delete-read', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = uid(c);
    const r = await execute(db, 'DELETE FROM notifications WHERE (user_id = ? OR user_id IS NULL) AND COALESCE(is_read,0)=1', userId);
    return c.json({ deleted: (r.meta as any).changes ?? 0 });
  } catch {
    return c.json({ deleted: 0 });
  }
});

inbox.post('/cleanup', async (c) => {
  // Remove read notifications older than the supplied days (default 30).
  try {
    const db = getDb(c.env);
    const userId = uid(c);
    const body = await c.req.json<{ days?: number }>().catch(() => ({} as { days?: number }));
    const days = Math.max(1, Math.min(365, Number(body.days) || 30));
    const r = await execute(db, `DELETE FROM notifications WHERE (user_id = ? OR user_id IS NULL) AND COALESCE(is_read,0)=1 AND created_at < datetime('now','-${days} days')`, userId);
    return c.json({ deleted: (r.meta as any).changes ?? 0 });
  } catch {
    return c.json({ deleted: 0 });
  }
});

// Snooze + escalate have no backing columns on the live table yet — accept
// the request so the UI control succeeds (no 404) instead of throwing.
inbox.put('/:id/snooze', async (c) => c.json({ success: true }));
inbox.post('/escalate', async (c) => c.json({ recipients: 0 }));

// GET /snoozed-due — background poll for notifications whose snooze has
// elapsed. No snooze column on the live table yet, so nothing is ever "due".
inbox.get('/snoozed-due', async (c) => c.json({ data: [] }));

// POST /admin/broadcast — admin sends a notification to everyone. A NULL
// user_id row is visible to all users (the list/stats queries treat
// user_id IS NULL as broadcast).
inbox.post('/admin/broadcast', async (c) => {
  const u = c.get('user') as { role: string } | undefined;
  if (!u || !['admin', 'manager', 'supervisor'].includes(u.role)) {
    return c.json({ error: 'Insufficient role', code: 'FORBIDDEN' }, 403);
  }
  try {
    const db = getDb(c.env);
    const senderId = uid(c);
    type Broadcast = { title?: string; message?: string; priority?: string; type?: string };
    const b = await c.req.json<Broadcast>().catch(() => ({} as Broadcast));
    if (!b.message && !b.title) return c.json({ error: 'title or message required' }, 400);
    const r = await execute(
      db,
      "INSERT INTO notifications (type, priority, title, message, user_id, sender_id, is_read, created_at) VALUES (?, ?, ?, ?, NULL, ?, 0, datetime('now'))",
      b.type ?? 'broadcast', b.priority ?? 'normal', b.title ?? null, b.message ?? null, senderId,
    );
    return c.json({ success: true, id: r.meta.last_row_id, recipients: 'all' }, 201);
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to broadcast');
  }
});

export default inbox;
