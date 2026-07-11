// Panic alerts — Workers route. WelfareWatchDO (added in main earlier)
// handles auto-prompt escalation timers; this surface is the dispatcher's
// view + the officer's panic button.
//
// What's here: create, list active, acknowledge, resolve, cancel,
// false-alarm. Each transition broadcasts on the panic channel and
// pushes targeted messages to supervisors/admins for voice alerts.
//
// What's deferred: in-process re-broadcast / auto-dispatch escalation
// timers. Workers have no setInterval; that belongs on a Durable
// Object Alarm in WelfareWatchDO or a sibling DO. The schema column
// `escalation_level` is already in place.

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { sendToUser, broadcastAll } from '../ws';
import { requireRole } from '../../middleware/auth';

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
  }>().catch(() => ({} as any));

  // Look up the officer's current unit so the alert carries call_sign
  // for dispatcher voice ("Officer Smith, Unit 12, panic activation").
  const unit = await queryFirst<{ id: number; call_sign: string; current_call_id: number | null }>(
    db, 'SELECT id, call_sign, current_call_id FROM units WHERE officer_id = ? LIMIT 1', userId,
  );
  
  // Dedupe: check for a recent panic CAD call, bounded to the last 30
  // minutes so a fresh activation never silently attaches to a stale call
  // from days/weeks ago.
  const recentCalls = await query<{ id: number }>(
    db,
    `SELECT id FROM calls_for_service
     WHERE source = 'panic' AND dispatcher_id = ?
       AND created_at > datetime('now', '-30 minutes')
     ORDER BY created_at DESC LIMIT 1`,
    userId,
  );
  
  let targetCallId = body.call_id ?? unit?.current_call_id ?? null;
  if (!targetCallId && recentCalls.length > 0) {
    targetCallId = recentCalls[0].id;
  } else if (!targetCallId) {
    // Create new CAD call if none exists
    const ins = await execute(
      db,
      `INSERT INTO calls_for_service (incident_type, priority, status, location_address, latitude, longitude,
         description, source, officer_safety_alert, created_at, updated_at)
       VALUES ('panic_alarm', 'P1', 'active', ?, ?, ?, ?, 'panic', 1, datetime('now'), datetime('now'))`,
      body.location_address ?? 'Panic location',
      body.latitude ?? null, body.longitude ?? null,
      'Officer Panic Activation'
    );
    targetCallId = Number(ins.meta.last_row_id);
  }

  const result = await execute(
    db,
    `INSERT INTO panic_alerts (user_id, unit_id, call_id, latitude, longitude, location_address, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    userId, unit?.id ?? null,
    targetCallId,
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

  // Record audit log for panic activation
  try {
    await execute(db,
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)`,
      userId, 'panic_activated', 'panic_alert', panicId, `Panic activated`, c.req.header('cf-connecting-ip') || 'unknown'
    );
  } catch { /* audit non-fatal */ }

  // Distinctive panic channel — client wires the continuous tone here.
  // broadcastAll fans to every connected client; the panic_alert type
  // is what voice/tone subscribers listen for.
  broadcastAll('panic_alert', { action: 'panic_activated', panic: created });

  // Push to dispatcher/supervisor roles by user id. We don't have a
  // sendToRole helper in main yet, so do a quick role-scoped lookup.
  const targets = await query<{ id: number }>(
    db,
    `SELECT id FROM users WHERE role IN ('dispatcher','supervisor','manager','admin') AND status = 'active'`,
  );
  for (const t of targets) {
    sendToUser(t.id, 'panic_alert', { action: 'panic_activated', panic: created });
  }

  // Automated backup dispatch: assign 2 nearest available units to the
  // officer's location. Requires a real GPS fix — without one, "nearest"
  // would silently rank units by distance to (0,0) ("null island") and
  // could auto-dispatch units to a bogus location, so we skip entirely
  // when latitude/longitude weren't provided.
  try {
    if (body.latitude != null && body.longitude != null) {
      const available = await query<{ id: number; call_sign: string; latitude: number; longitude: number }>(
        db,
        `SELECT id, call_sign, latitude, longitude FROM units
          WHERE status = 'available' AND latitude IS NOT NULL AND longitude IS NOT NULL
          ORDER BY (CASE WHEN latitude IS NULL OR longitude IS NULL THEN 999
                    ELSE ((latitude - ?) * (latitude - ?) + (longitude - ?) * (longitude - ?)) END)
          LIMIT 2`,
        body.latitude, body.latitude, body.longitude, body.longitude,
      );
      if (available.length > 0) {
        const backupCallId = targetCallId;
        for (const unit of available) {
          await execute(db,
            `UPDATE units SET status = 'dispatched', current_call_id = ? WHERE id = ?`,
            backupCallId, unit.id);
        }
        await execute(db,
          `UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?`,
          JSON.stringify(available.map((u) => u.id)), backupCallId);
        await execute(db,
          `UPDATE panic_alerts SET backup_call_id = ?, backup_units = ? WHERE id = ?`,
          backupCallId, JSON.stringify(available.map((u) => u.call_sign)), panicId);
        broadcastAll('dispatch_update', {
          action: 'backup_dispatched',
          panic_id: panicId,
          backup_call_id: backupCallId,
          units: available.map((u) => u.call_sign),
        });
      }
    } else {
      console.log('[panic] skipped auto-backup dispatch: no GPS coordinates on activation');
    }
  } catch (err) {
    console.error('[panic] auto-backup dispatch failed:', err);
  }

  return c.json(created, 201);
});

// POST /dispatch/panic/:id/acknowledge — dispatcher confirms receipt
panic.post('/panic/:id/acknowledge', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const userId = c.get('userId') as number;
  const result = await execute(
    db,
    `UPDATE panic_alerts
     SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ? AND status = 'active'`,
    userId, id,
  );
  if (result.meta.changes === 0) {
    const exists = await queryFirst(db, 'SELECT id FROM panic_alerts WHERE id = ?', id);
    return c.json({ error: exists ? 'Alert is not in a state that can be acknowledged' : 'Not found' }, exists ? 409 : 404);
  }
  const updated = await queryFirst(db, 'SELECT * FROM panic_alerts WHERE id = ?', id);
  broadcastAll('panic_alert', { action: 'panic_acknowledged', panic: updated });
  return c.json(updated);
});

// POST /dispatch/panic/:id/resolve — incident over, no further action.
// Dismissing someone ELSE's active alert requires dispatcher-tier+.
panic.post('/panic/:id/resolve', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const userId = c.get('userId') as number;
  const body = await c.req.json<{ notes?: string }>().catch(() => ({} as any));
  const result = await execute(
    db,
    `UPDATE panic_alerts
     SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now'),
         resolution_notes = ?, updated_at = datetime('now')
     WHERE id = ? AND status IN ('active', 'acknowledged')`,
    userId, body.notes ?? null, id,
  );
  if (result.meta.changes === 0) {
    const exists = await queryFirst(db, 'SELECT id FROM panic_alerts WHERE id = ?', id);
    return c.json({ error: exists ? 'Alert is not in a state that can be resolved' : 'Not found' }, exists ? 409 : 404);
  }
  const updated = await queryFirst(db, 'SELECT * FROM panic_alerts WHERE id = ?', id);
  broadcastAll('panic_alert', { action: 'panic_resolved', panic: updated });
  return c.json(updated);
});

// POST /dispatch/panic/:id/cancel — officer cancels their own alert.
// No requireRole here — the ownership check below is the correct floor
// (any role may cancel THEIR OWN alert; a role gate would be redundant).
panic.post('/panic/:id/cancel', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const userId = c.get('userId') as number;
  // Allow self-cancel only if the requesting user is the originator.
  const row = await queryFirst<{ user_id: number }>(
    db, 'SELECT user_id FROM panic_alerts WHERE id = ?', id,
  );
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.user_id !== userId) {
    return c.json({ error: 'Only the originating officer may cancel' }, 403);
  }
  const result = await execute(
    db,
    `UPDATE panic_alerts
     SET status = 'cancelled', resolved_by = ?, resolved_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ? AND status IN ('active', 'acknowledged')`,
    userId, id,
  );
  if (result.meta.changes === 0) {
    return c.json({ error: 'Alert is not in a state that can be cancelled' }, 409);
  }
  const updated = await queryFirst(db, 'SELECT * FROM panic_alerts WHERE id = ?', id);
  broadcastAll('panic_alert', { action: 'panic_cancelled', panic: updated });
  return c.json(updated);
});

// POST /dispatch/panic/:id/false-alarm — dispatcher-tier+ marks it as false.
panic.post('/panic/:id/false-alarm', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const userId = c.get('userId') as number;
  const result = await execute(
    db,
    `UPDATE panic_alerts
     SET status = 'false_alarm', resolved_by = ?, resolved_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ? AND status IN ('active', 'acknowledged')`,
    userId, id,
  );
  if (result.meta.changes === 0) {
    const exists = await queryFirst(db, 'SELECT id FROM panic_alerts WHERE id = ?', id);
    return c.json({ error: exists ? 'Alert is not in a state that can be marked false-alarm' : 'Not found' }, exists ? 409 : 404);
  }
  const updated = await queryFirst(db, 'SELECT * FROM panic_alerts WHERE id = ?', id);
  broadcastAll('panic_alert', { action: 'panic_false_alarm', panic: updated });
  return c.json(updated);
});

// POST /request-backup — officer requests backup from the quick-action
// (RadialMenu) menu. Unlike /panic this is a transient broadcast, not a
// tracked alert row: it fans a dispatch_update to every client with the
// requesting officer's unit + GPS location and writes a non-fatal audit
// row. Mirrors the welfare/help broadcast pattern. Nobody implemented
// this before (legacy + rewrite both 404'd), so the RadialMenu "Backup"
// action silently failed.
panic.post('/request-backup', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const body = await c.req.json<{ latitude?: number; longitude?: number; message?: string }>()
      .catch(() => ({} as { latitude?: number; longitude?: number; message?: string }));

    const officer = await queryFirst<{ full_name: string; badge_number: string | null }>(
      db, 'SELECT full_name, badge_number FROM users WHERE id = ?', userId,
    );
    const unit = await queryFirst<{ id: number; call_sign: string; current_call_id: number | null }>(
      db, 'SELECT id, call_sign, current_call_id FROM units WHERE officer_id = ? LIMIT 1', userId,
    );

    const payload = {
      action: 'backup_requested',
      user_id: userId,
      officer_name: officer?.full_name ?? 'Unknown officer',
      badge_number: officer?.badge_number ?? null,
      call_sign: unit?.call_sign ?? null,
      call_id: unit?.current_call_id ?? null,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      message: body.message ?? 'Backup requested',
      at: new Date().toISOString(),
    };

    try {
      await execute(db,
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES (?, 'backup_requested', 'user', ?, ?, ?)`,
        userId, userId,
        `Backup requested${unit?.call_sign ? ` by ${unit.call_sign}` : ''}${body.message ? `: ${body.message}` : ''}`,
        c.req.header('cf-connecting-ip') || 'unknown');
    } catch { /* audit is non-fatal */ }

    broadcastAll('dispatch_update', payload);
    return c.json({ success: true, broadcast: payload });
  } catch (err) {
    console.error('[dispatch] request-backup error', err);
    return c.json({ error: 'Failed to request backup', code: 'REQUEST_BACKUP_ERR' }, 500);
  }
});

export default panic;
