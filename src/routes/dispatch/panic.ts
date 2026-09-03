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
import { emitAlert } from '../../utils/alertHub';
import { requireRole } from '../../middleware/auth';
import { getDecrypted } from '../../utils/encryptedR2';
import { log } from '../../utils/logger';

const panic = new Hono<Env>();

/** Live D1 still has the VPS-era panic_alerts shape (officer_id NOT NULL,
 *  no unit_id/source) on some isolates because CREATE TABLE IF NOT EXISTS
 *  in 0021 never ALTERs an existing table. POST /panic used to 500 on the
 *  first INSERT. Try the current column list, then the baseline list. */
async function insertPanicAlertRow(
  db: ReturnType<typeof getDb>,
  fields: {
    userId: number;
    unitId: number | null;
    callId: number | null;
    latitude: number | null;
    longitude: number | null;
    locationAddress: string | null;
    source: string;
    triggerMethod: string;
  },
) {
  const attempts: Array<{ sql: string; args: unknown[] }> = [
    {
      sql: `INSERT INTO panic_alerts (user_id, unit_id, call_id, latitude, longitude, location_address, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      args: [fields.userId, fields.unitId, fields.callId, fields.latitude, fields.longitude, fields.locationAddress, fields.source],
    },
    {
      sql: `INSERT INTO panic_alerts (officer_id, user_id, unit_id, call_id, latitude, longitude, location_address, source, trigger_method, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      args: [fields.userId, fields.userId, fields.unitId, fields.callId, fields.latitude, fields.longitude, fields.locationAddress, fields.source, fields.triggerMethod],
    },
    {
      sql: `INSERT INTO panic_alerts (officer_id, user_id, call_id, latitude, longitude, location_address, trigger_method, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      args: [fields.userId, fields.userId, fields.callId, fields.latitude, fields.longitude, fields.locationAddress, fields.triggerMethod],
    },
  ];
  let lastErr: unknown;
  for (const attempt of attempts) {
    try {
      return await execute(db, attempt.sql, ...attempt.args);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('panic_alerts insert failed');
}

async function insertPanicCfs(
  db: ReturnType<typeof getDb>,
  fields: {
    callNumber: string;
    userId: number;
    address: string;
    latitude: number | null;
    longitude: number | null;
  },
) {
  const withCaution = `INSERT INTO calls_for_service (call_number, dispatcher_id, incident_type, priority, status, location_address, latitude, longitude,
         description, source, officer_safety_caution, created_at, updated_at)
       VALUES (?, ?, 'panic_alarm', 'P1', 'pending', ?, ?, ?, ?, 'panic', 1, datetime('now'), datetime('now'))`;
  const withoutCaution = `INSERT INTO calls_for_service (call_number, dispatcher_id, incident_type, priority, status, location_address, latitude, longitude,
         description, source, created_at, updated_at)
       VALUES (?, ?, 'panic_alarm', 'P1', 'pending', ?, ?, ?, ?, 'panic', datetime('now'), datetime('now'))`;
  const args = [fields.callNumber, fields.userId, fields.address, fields.latitude, fields.longitude, 'Officer Panic Activation'];
  try {
    return await execute(db, withCaution, ...args);
  } catch (err) {
    log.warn('[panic] CFS insert retry without officer_safety_caution', { err: String(err) });
    return await execute(db, withoutCaution, ...args);
  }
}

// GET /dispatch/panic — list panic alerts, default active only
panic.get('/panic', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
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
  } catch (err) {
    return c.json({ error: 'Failed to load panic alerts' }, 500);
  }
});

// POST /dispatch/panic — officer hits the panic button (any authenticated role may trigger their own)
panic.post('/panic', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const body = await c.req.json<{
    latitude?: number; longitude?: number; location_address?: string;
    source?: string; call_id?: number; trigger_method?: string;
  }>().catch(() => ({} as {
    latitude?: number; longitude?: number; location_address?: string;
    source?: string; call_id?: number; trigger_method?: string;
  }));

  try {
  // Look up the officer's current unit so the alert carries call_sign
  // for dispatcher voice ("Officer Smith, Unit 12, panic activation").
  let unit: { id: number; call_sign: string; current_call_id: number | null } | null = null;
  try {
    unit = await queryFirst<{ id: number; call_sign: string; current_call_id: number | null }>(
      db, 'SELECT id, call_sign, current_call_id FROM units WHERE officer_id = ? LIMIT 1', userId,
    );
  } catch (err) {
    log.warn('[panic] units lookup failed (non-fatal)', { userId, err: String(err) });
  }
  
  // Dedupe: check for a recent panic CAD call, bounded to the last 30
  // minutes so a fresh activation never silently attaches to a stale call
  // from days/weeks ago.
  // Dedup via user_id on the panic_alerts table — dispatcher_id is never
  // populated on INSERT so querying it always returns zero rows.
  let recentCalls: { id: number }[] = [];
  try {
    recentCalls = await query<{ id: number }>(
      db,
      `SELECT cfs.id FROM calls_for_service cfs
       JOIN panic_alerts pa ON pa.call_id = cfs.id
       WHERE cfs.source = 'panic' AND pa.user_id = ?
         AND cfs.created_at > datetime('now', '-30 minutes')
       ORDER BY cfs.created_at DESC LIMIT 1`,
      userId,
    );
  } catch (err) {
    log.warn('[panic] dedupe lookup failed (non-fatal)', { userId, err: String(err) });
  }
  
  let targetCallId = body.call_id ?? unit?.current_call_id ?? null;
  if (!targetCallId && recentCalls.length > 0) {
    targetCallId = recentCalls[0].id;
  } else if (!targetCallId) {
    // Create new CAD call if none exists. Generate a CFS call number so the
    // panic call appears in number-based searches and exports.
    const panicYear = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', year: 'numeric' }).slice(-2);
    const panicPrefix = `CFS${panicYear}-`;
    const maxRows = await query<{ max: string | null }>(
      db, 'SELECT MAX(call_number) as max FROM calls_for_service WHERE call_number LIKE ?', `${panicPrefix}%`,
    );
    const panicMax = maxRows[0]?.max ?? null;
    const panicSeq = panicMax ? String(parseInt(panicMax.slice(panicPrefix.length), 10) + 1).padStart(5, '0') : '00001';
    const panicCallNumber = `${panicPrefix}${panicSeq}`;

    const ins = await insertPanicCfs(db, {
      callNumber: panicCallNumber,
      userId,
      address: body.location_address ?? 'Panic location',
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
    });
    targetCallId = Number(ins.meta.last_row_id);
  }

  const result = await insertPanicAlertRow(db, {
    userId,
    unitId: unit?.id ?? null,
    callId: targetCallId,
    latitude: body.latitude ?? null,
    longitude: body.longitude ?? null,
    locationAddress: body.location_address ?? null,
    source: body.source ?? 'manual',
    triggerMethod: body.trigger_method ?? 'ui_button',
  });
  const panicId = Number(result.meta.last_row_id);
  let created = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT p.*, u.full_name as user_name, u.badge_number, un.call_sign
     FROM panic_alerts p
     LEFT JOIN users u ON p.user_id = u.id
     LEFT JOIN units un ON p.unit_id = un.id
     WHERE p.id = ?`,
    panicId,
  ).catch(() => null);
  if (!created) {
    created = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT p.*, u.full_name as user_name, u.badge_number
       FROM panic_alerts p
       LEFT JOIN users u ON COALESCE(p.user_id, p.officer_id) = u.id
       WHERE p.id = ?`,
      panicId,
    );
  }

  // Record audit log for panic activation
  try {
    await execute(db,
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)`,
      userId, 'panic_activated', 'panic_alert', panicId, `Panic activated`, c.req.header('cf-connecting-ip') || 'unknown'
    );
  } catch { /* audit non-fatal */ }

  try {
    broadcastAll('panic_alert', { action: 'panic_activated', panic: created });
    await emitAlert(c.env, 'panic_alert', { action: 'panic_activated', panic: created });
    const targets = await query<{ id: number }>(
      db,
      `SELECT id FROM users WHERE role IN ('dispatcher','supervisor','manager','admin') AND status = 'active'`,
    );
    for (const t of targets) {
      sendToUser(t.id, 'panic_alert', { action: 'panic_activated', panic: created });
    }
  } catch (err) {
    log.error('[panic] fan-out after insert failed (alert row already stored)', { userId, panicId }, err as Error);
  }

  // Automated backup dispatch: assign 2 nearest available units to the
  // officer's location. Requires a real GPS fix — without one, "nearest"
  // would silently rank units by distance to (0,0) ("null island") and
  // could auto-dispatch units to a bogus location, so we skip entirely
  // when latitude/longitude weren't provided.
  try {
    if (body.latitude != null && body.longitude != null) {
      // H6: use haversine distance for nearest-unit selection (Euclidean treats
      // degrees as equal in both axes, which silently skews E/W more than N/S
      // at Utah latitudes ~40°N where 1° lng ≈ 0.77° lat).
      function haversineMi(lat1: number, lng1: number, lat2: number, lng2: number): number {
        const R = 3958.8;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }
      const allAvailable = await query<{ id: number; call_sign: string; latitude: number; longitude: number }>(
        db,
        `SELECT id, call_sign, latitude, longitude FROM units
          WHERE status = 'available' AND latitude IS NOT NULL AND longitude IS NOT NULL`,
      );
      const available = allAvailable
        .map((u) => ({ ...u, dist: haversineMi(body.latitude!, body.longitude!, u.latitude, u.longitude) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 2);
      if (available.length > 0) {
        const backupCallId = targetCallId;
        for (const unit of available) {
          await execute(db,
            `UPDATE units SET status = 'dispatched', current_call_id = ? WHERE id = ?`,
            backupCallId, unit.id);
        }
        await execute(db,
          `UPDATE calls_for_service SET assigned_unit_ids = ?, unit_call_signs = ? WHERE id = ?`,
          JSON.stringify(available.map((u) => u.id)),
          JSON.stringify(available.map((u) => u.call_sign)),
          backupCallId);
        const backupUnits = JSON.stringify(available.map((u) => u.call_sign));
        await execute(db,
          `UPDATE panic_alerts SET backup_call_id = ?, backup_units = ? WHERE id = ?`,
          backupCallId, backupUnits, panicId);
        // `created` was fetched before this block ran (it's what the
        // response body and the broadcasts above already used) — without
        // updating it here, the 201 response and every broadcast report
        // backup_call_id/backup_units as null even though the DB row (and
        // the units it dispatched) were genuinely updated. Patch the
        // in-memory snapshot rather than re-querying.
        if (created) {
          created.backup_call_id = backupCallId;
          created.backup_units = backupUnits;
        }
        broadcastAll('dispatch_update', {
          action: 'backup_dispatched',
          panic_id: panicId,
          backup_call_id: backupCallId,
          units: available.map((u) => u.call_sign),
        });
      }
    } else {
      log.info('[panic] skipped auto-backup dispatch: no GPS coordinates on activation', { userId });
    }
  } catch (err) {
    log.error('[panic] auto-backup dispatch failed', { userId }, err as Error);
  }

  return c.json(created, 201);
  } catch (err) {
    log.error('[panic] POST /panic failed', { userId }, err as Error);
    return c.json({ error: 'Failed to create panic alert', code: 'PANIC_CREATE_FAILED' }, 500);
  }
});

// POST /dispatch/panic/:id/acknowledge — dispatcher confirms receipt.
// Acknowledging flips an active alarm off the dispatcher's default active-panic
// monitor, so it must carry the same dispatcher-tier gate as resolve/false-alarm
// below — otherwise any authenticated role could acknowledge (and thereby
// suppress) another officer's live distress alarm.
panic.post('/panic/:id/acknowledge', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
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
  await emitAlert(c.env, 'panic_alert', { action: 'panic_acknowledged', panic: updated });
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
  await emitAlert(c.env, 'panic_alert', { action: 'panic_resolved', panic: updated });
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
  await emitAlert(c.env, 'panic_alert', { action: 'panic_cancelled', panic: updated });
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
  await emitAlert(c.env, 'panic_alert', { action: 'panic_false_alarm', panic: updated });
  return c.json(updated);
});

// POST /request-backup — officer requests backup from the quick-action
// (RadialMenu) menu. Unlike /panic this is a transient broadcast, not a
// tracked alert row: it fans a dispatch_update to every client with the
// requesting officer's unit + GPS location and writes a non-fatal audit
// row. Mirrors the welfare/help broadcast pattern. Nobody implemented
// this before (legacy + rewrite both 404'd), so the RadialMenu "Backup"
// action silently failed.
panic.post('/request-backup', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
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
    log.error('[dispatch] request-backup error', {}, err as Error);
    return c.json({ error: 'Failed to request backup', code: 'REQUEST_BACKUP_ERR' }, 500);
  }
});

// POST /dispatch/panic/:id/deactivate — admin/manager hard-clear of any
// terminal state. Used when a panic row is stuck in 'active' after comms
// are restored but no one can reach the acknowledge/resolve flow.
panic.post('/panic/:id/deactivate', requireRole('manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const userId = c.get('userId') as number;
  const result = await execute(
    db,
    `UPDATE panic_alerts
     SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now'),
         resolution_notes = 'Force-deactivated by admin', updated_at = datetime('now')
     WHERE id = ? AND status NOT IN ('resolved', 'cancelled', 'false_alarm')`,
    userId, id,
  );
  if (result.meta.changes === 0) {
    const exists = await queryFirst(db, 'SELECT id FROM panic_alerts WHERE id = ?', id);
    return c.json({ error: exists ? 'Alert is already in a terminal state' : 'Not found' }, exists ? 409 : 404);
  }
  const updated = await queryFirst(db, 'SELECT * FROM panic_alerts WHERE id = ?', id);
  broadcastAll('panic_alert', { action: 'panic_resolved', panic: updated });
  await emitAlert(c.env, 'panic_alert', { action: 'panic_resolved', panic: updated });
  return c.json(updated);
});

// GET /dispatch/panic/:id/audio — stream the archived distress recording.
// Only dispatcher-tier+ may replay a panic recording.
panic.get('/panic/:id/audio', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const row = await queryFirst<{ audio_file_id: number | null }>(
    db, 'SELECT audio_file_id FROM panic_alerts WHERE id = ?', id,
  );
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.audio_file_id == null) return c.json({ error: 'No audio recorded for this alert' }, 404);
  const key = `panic-audio/${id}.webm`;
  try {
    const result = await getDecrypted(c.env.UPLOADS, db, c.env, key);
    if (!result) return c.json({ error: 'Audio not found in storage' }, 404);
    return new Response(result.bytes, {
      headers: { 'Content-Type': 'audio/webm', 'Cache-Control': 'no-store' },
    });
  } catch {
    return c.json({ error: 'Failed to retrieve audio' }, 500);
  }
});

export default panic;
