// Panic alerts — compact Workers port of server/src/routes/dispatch/panic.ts.
//
// What's here: create, list active, acknowledge, resolve, cancel,
// false-alarm. Each transition broadcasts on the `panic` channel
// and pushes targeted messages to supervisors/admins for voice alerts.
//
// What's deferred: in-process escalation timers (level 1 re-broadcast
// at 30s, level 2 auto-dispatch at 60s, level 3 supervisor email at 90s).
// Workers don't keep a process around — that work belongs on a Durable
// Object Alarm. The schema column `escalation_level` is already in
// place, so adding the DO alarm in a follow-up is a 1-file change.

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import {
  broadcastPanic,
  broadcastDispatchUpdate,
  sendToRoles,
} from '../../lib/broadcast';

const panic = new Hono<Env>();

// GET /dispatch/panic — list panic alerts, default active only
panic.get('/panic', async (c) => {
  const db = getDb(c.env);
  const status = c.req.query('status') || 'active';
  const rows = await query<Record<string, unknown>>(
    db,
    `SELECT p.*, u.full_name as user_name, u.badge_number,
            ack.full_name as acknowledged_by_name,
            res.full_name as resolved_by_name
     FROM panic_alerts p
     LEFT JOIN users u ON p.user_id = u.id
     LEFT JOIN users ack ON p.acknowledged_by = ack.id
     LEFT JOIN users res ON p.resolved_by = res.id
     WHERE (? = 'all' OR p.status = ?)
     ORDER BY p.created_at DESC LIMIT 500`,
    status, status,
  );
  return c.json(rows);
});

// POST /dispatch/panic — officer hits the panic button
panic.post('/panic', async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const body = await c.req.json<{
    latitude?: number; longitude?: number; location_address?: string;
    source?: string; call_id?: number;
  }>();

  // Look up the officer's current unit so the alert carries call_sign
  // for dispatcher voice ("Officer Smith, Unit 12, panic activation").
  const unit = await queryFirst<{ id: number; call_sign: string; current_call_id: number | null }>(
    db, 'SELECT id, call_sign, current_call_id FROM units WHERE officer_id = ? LIMIT 1', userId,
  );

  const result = await execute(
    db,
    `INSERT INTO panic_alerts (user_id, unit_id, call_id, latitude, longitude, location_address, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    userId, unit?.id ?? null, body.call_id ?? unit?.current_call_id ?? null,
    body.latitude ?? null, body.longitude ?? null, body.location_address ?? null,
    body.source ?? 'manual',
  );

  const panicId = Number(result.meta.last_row_id);
  const created = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT p.*, u.full_name as user_name, u.badge_number, un.call_sign
     FROM panic_alerts p
     LEFT JOIN users u ON p.user_id = u.id
     LEFT JOIN units un ON p.unit_id = un.id
     WHERE p.id = ?`,
    panicId,
  );

  // Broadcast on panic channel — distinctive client tone. Also push
  // targeted alerts to dispatchers + supervisors so their MDT voices
  // the activation regardless of which screen they're on.
  c.executionCtx.waitUntil(broadcastPanic(c.env, { action: 'panic_activated', panic: created }).then(() => {}));
  c.executionCtx.waitUntil(sendToRoles(c.env, ['dispatcher', 'supervisor', 'manager', 'admin'],
    'panic_alert', { action: 'panic_activated', panic: created }).then(() => {}));

  return c.json(created, 201);
});

// POST /dispatch/panic/:id/acknowledge — dispatcher confirms receipt
panic.post('/panic/:id/acknowledge', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const userId = c.get('userId') as number;
  await execute(
    db,
    `UPDATE panic_alerts SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND status = 'active'`,
    userId, id,
  );
  const updated = await queryFirst(db, 'SELECT * FROM panic_alerts WHERE id = ?', id);
  c.executionCtx.waitUntil(broadcastPanic(c.env, { action: 'panic_acknowledged', panic: updated }).then(() => {}));
  return c.json(updated);
});

// POST /dispatch/panic/:id/resolve — incident over, no further action
panic.post('/panic/:id/resolve', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const userId = c.get('userId') as number;
  const { notes } = await c.req.json<{ notes?: string }>().catch(() => ({ notes: undefined }));
  await execute(
    db,
    `UPDATE panic_alerts SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now'), resolution_notes = ?, updated_at = datetime('now')
     WHERE id = ?`,
    userId, notes ?? null, id,
  );
  const updated = await queryFirst(db, 'SELECT * FROM panic_alerts WHERE id = ?', id);
  c.executionCtx.waitUntil(broadcastPanic(c.env, { action: 'panic_resolved', panic: updated }).then(() => {}));
  return c.json(updated);
});

// POST /dispatch/panic/:id/cancel — officer cancels their own alert
panic.post('/panic/:id/cancel', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const userId = c.get('userId') as number;
  // Allow self-cancel only if the requesting user is the originator.
  const row = await queryFirst<{ user_id: number }>(db, 'SELECT user_id FROM panic_alerts WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.user_id !== userId) return c.json({ error: 'Only the originating officer may cancel' }, 403);
  await execute(db, `UPDATE panic_alerts SET status = 'cancelled', resolved_by = ?, resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, userId, id);
  const updated = await queryFirst(db, 'SELECT * FROM panic_alerts WHERE id = ?', id);
  c.executionCtx.waitUntil(broadcastPanic(c.env, { action: 'panic_cancelled', panic: updated }).then(() => {}));
  return c.json(updated);
});

// POST /dispatch/panic/:id/false-alarm — supervisor marks it as false
panic.post('/panic/:id/false-alarm', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const userId = c.get('userId') as number;
  await execute(db, `UPDATE panic_alerts SET status = 'false_alarm', resolved_by = ?, resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, userId, id);
  const updated = await queryFirst(db, 'SELECT * FROM panic_alerts WHERE id = ?', id);
  c.executionCtx.waitUntil(broadcastPanic(c.env, { action: 'panic_false_alarm', panic: updated }).then(() => {}));
  return c.json(updated);
});

export default panic;
