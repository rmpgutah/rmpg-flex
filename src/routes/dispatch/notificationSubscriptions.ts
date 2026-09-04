// ============================================================
// Dispatch — Push Notification Subscriptions
// POST   /subscribe      — store a WebPush subscription
// GET    /subscriptions  — list all (admin only)
// DELETE /subscriptions/:id — remove
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute, columnExists } from '../../utils/db';
import { requireRole } from '../../middleware/auth';
import { log } from '../../utils/logger';

const notifSubs = new Hono<Env>();

// Boot reconciler — creates table + columns if they don't exist.
async function reconcile(db: import('@cloudflare/workers-types').D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS notification_subscriptions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    subscription TEXT    NOT NULL,
    notify_on    TEXT    NOT NULL DEFAULT '[]',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  )`).run();
}

// POST /api/dispatch/notifications/subscribe
// Any authenticated officer/dispatcher can register their own push subscription.
// The stored user_id is always the authenticated caller's own id — the body's
// user_id field is intentionally ignored to prevent one user from registering a
// subscription attributed to another account (IDOR).
notifSubs.post('/subscribe',
  requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'),
  async (c) => {
  const db = getDb(c.env);
  await reconcile(db);
  let body: { subscription: unknown; notify_on?: string[] };
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'invalid JSON' }, 400); }
  const { subscription, notify_on = [] } = body;
  if (!subscription || typeof subscription !== 'object') {
    return c.json({ ok: false, error: 'subscription is required' }, 400);
  }
  // Always use the authenticated user's own id — never the caller-supplied one
  const uid = c.get('userId') as number | undefined;
  if (!uid) return c.json({ ok: false, error: 'user_id required' }, 400);

  const subJson = JSON.stringify(subscription);
  const notifyOnJson = JSON.stringify(notify_on);

  const res = await execute(db,
    `INSERT INTO notification_subscriptions (user_id, subscription, notify_on) VALUES (?, ?, ?)`,
    uid, subJson, notifyOnJson);
  log.info('[notif-sub] registered subscription', { user_id: uid, id: res.meta.last_row_id });
  return c.json({ ok: true, id: res.meta.last_row_id });
});

// GET /api/dispatch/notifications/subscriptions  — admin only
notifSubs.get('/subscriptions',
  requireRole('admin', 'manager'),
  async (c) => {
    const db = getDb(c.env);
    await reconcile(db);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT ns.id, ns.user_id, ns.notify_on, ns.created_at, ns.updated_at,
              u.full_name, u.call_sign
         FROM notification_subscriptions ns
         LEFT JOIN users u ON u.id = ns.user_id
         ORDER BY ns.created_at DESC`);
    return c.json({ ok: true, subscriptions: rows });
  });

// DELETE /api/dispatch/notifications/subscriptions/:id
notifSubs.delete('/subscriptions/:id',
  requireRole('admin', 'manager', 'supervisor'),
  async (c) => {
    const db = getDb(c.env);
    await reconcile(db);
    const id = Number(c.req.param('id'));
    if (!id) return c.json({ ok: false, error: 'invalid id' }, 400);
    const res = await execute(db, `DELETE FROM notification_subscriptions WHERE id = ?`, id);
    if ((res.meta.changes ?? 0) === 0) return c.json({ ok: false, error: 'not found' }, 404);
    return c.json({ ok: true });
  });

export default notifSubs;
