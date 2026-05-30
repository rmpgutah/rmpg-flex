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
     LEFT JOIN users u ON u.id = COALESCE(p.user_id, p.officer_id)
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

  const result = await execute(
    db,
    // Schema reality (live panic_alerts): officer_id is NOT NULL (no default);
    // the trigger column is `trigger_method` (NOT `source`); and there is NO
    // `unit_id` column — the unit is resolved via the officer on read. The
    // previous INSERT named unit_id + source and omitted officer_id, so it
    // would fail on every panic (SQLITE constraint / no such column) if this
    // handler were ever routed live. created_at/updated_at = UTC.
    `INSERT INTO panic_alerts (officer_id, user_id, call_id, latitude, longitude, location_address, trigger_method, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    userId, userId, body.call_id ?? unit?.current_call_id ?? null,
    body.latitude ?? null, body.longitude ?? null, body.location_address ?? null,
    body.source ?? 'ui_button',
  );
  const panicId = Number(result.meta.last_row_id);
  const created = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT p.*, u.full_name as user_name, u.badge_number, un.call_sign
     FROM panic_alerts p
     LEFT JOIN users u ON u.id = COALESCE(p.user_id, p.officer_id)
     LEFT JOIN units un ON un.officer_id = p.officer_id
     WHERE p.id = ?`,
    panicId,
  );

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
  // Include `panic_id` explicitly: the client (PanicButton) reads it to
  // open the panic voice room (room panic-<panicId>) for the live mic
  // broadcast. The full row is spread in for the dispatcher overlay.
  return c.json({ ...(created as Record<string, unknown>), panic_id: panicId }, 201);
});

// POST /dispatch/panic/:id/acknowledge — dispatcher confirms receipt
panic.post('/panic/:id/acknowledge', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const userId = c.get('userId') as number;
  await execute(
    db,
    `UPDATE panic_alerts
     SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ? AND status = 'active'`,
    userId, id,
  );
  const updated = await queryFirst(db, 'SELECT * FROM panic_alerts WHERE id = ?', id);
  broadcastAll('panic_alert', { action: 'panic_acknowledged', panic: updated });
  return c.json(updated);
});

// POST /dispatch/panic/:id/resolve — incident over, no further action
panic.post('/panic/:id/resolve', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const userId = c.get('userId') as number;
  const body = await c.req.json<{ notes?: string }>().catch(() => ({} as any));
  await execute(
    db,
    `UPDATE panic_alerts
     SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now'),
         resolution_notes = ?, updated_at = datetime('now')
     WHERE id = ?`,
    userId, body.notes ?? null, id,
  );
  const updated = await queryFirst(db, 'SELECT * FROM panic_alerts WHERE id = ?', id);
  broadcastAll('panic_alert', { action: 'panic_resolved', panic: updated });
  return c.json(updated);
});

// POST /dispatch/panic/:id/cancel — officer cancels their own alert
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
  await execute(
    db,
    `UPDATE panic_alerts
     SET status = 'cancelled', resolved_by = ?, resolved_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ?`,
    userId, id,
  );
  const updated = await queryFirst(db, 'SELECT * FROM panic_alerts WHERE id = ?', id);
  broadcastAll('panic_alert', { action: 'panic_cancelled', panic: updated });
  return c.json(updated);
});

// POST /dispatch/panic/:id/false-alarm — supervisor marks it as false
panic.post('/panic/:id/false-alarm', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const userId = c.get('userId') as number;
  await execute(
    db,
    `UPDATE panic_alerts
     SET status = 'false_alarm', resolved_by = ?, resolved_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ?`,
    userId, id,
  );
  const updated = await queryFirst(db, 'SELECT * FROM panic_alerts WHERE id = ?', id);
  broadcastAll('panic_alert', { action: 'panic_false_alarm', panic: updated });
  return c.json(updated);
});

// GET /dispatch/panic/:id/audio — stream the archived distress broadcast.
// VoiceHubDO (panic room) stores the officer's audio at
// panic-audio/<id>.webm and sets panic_alerts.audio_file_id, so the
// lookup is a pure id→key map. Range support + ?token= for <audio>.
panic.get('/panic/:id/audio', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const key = `panic-audio/${id}.webm`;

  const rangeHeader = c.req.header('Range');
  let r2Range: R2Range | undefined;
  let rangeStart = 0;
  let rangeEnd = -1;
  if (rangeHeader) {
    const m = rangeHeader.trim().match(/^bytes=(\d+)-(\d*)$/);
    if (m) {
      rangeStart = Number(m[1]);
      rangeEnd = m[2] ? Number(m[2]) : -1;
      r2Range = rangeEnd >= 0 ? { offset: rangeStart, length: rangeEnd - rangeStart + 1 } : { offset: rangeStart };
    }
  }

  const obj = r2Range
    ? await c.env.UPLOADS.get(key, { range: r2Range })
    : await c.env.UPLOADS.get(key);
  if (!obj) return c.json({ error: 'No panic recording' }, 404);

  const totalSize = obj.size;
  const headers: Record<string, string> = {
    'Content-Type': obj.httpMetadata?.contentType || 'audio/webm',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable',
  };
  if (r2Range) {
    const start = rangeStart;
    const end = rangeEnd >= 0 ? Math.min(rangeEnd, totalSize - 1) : totalSize - 1;
    headers['Content-Range'] = `bytes ${start}-${end}/${totalSize}`;
    headers['Content-Length'] = String(end - start + 1);
    return new Response(obj.body, { status: 206, headers });
  }
  headers['Content-Length'] = String(totalSize);
  return new Response(obj.body, { status: 200, headers });
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
