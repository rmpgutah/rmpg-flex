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
import { emitAlert } from '../../utils/alertHub';
import { evaluateNotificationRules } from '../notificationEngine';

const panic = new Hono<Env>();

// Clear the EMERGENCY overlay on the panicking officer's unit. Called on the
// terminal transitions (resolve/cancel/false-alarm) — NOT on acknowledge,
// where the unit stays emergent (Spillman: ack silences the alarm only).
async function clearUnitEmergency(db: ReturnType<typeof getDb>, panicRow: Record<string, unknown> | null): Promise<void> {
  const officerId = (panicRow?.officer_id ?? panicRow?.user_id) as number | undefined;
  if (!officerId) return;
  await execute(
    db,
    `UPDATE units SET emergency_active = 0, emergency_call_id = NULL, emergency_since = NULL
     WHERE officer_id = ? AND emergency_active = 1`,
    officerId,
  ).catch((err) => console.error('[panic] clear unit emergency failed (non-fatal)', err));
}

// Cascade-resolve a panic when its underlying CAD call reaches a terminal
// status (cleared/closed/cancelled/archived). Reused by the call-status handler
// (calls.ts) so closing a panic call also (a) resolves any still-active
// panic_alerts row tied to it and (b) clears the EMERGENCY overlay on whatever
// unit is flashing red for this call. Best-effort: callers wrap this and never
// let a failure block the status change.
export async function resolvePanicForCall(
  db: ReturnType<typeof getDb>,
  callId: number | string,
): Promise<void> {
  await execute(
    db,
    `UPDATE panic_alerts SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now')
     WHERE call_id = ? AND status = 'active'`,
    callId,
  );
  await execute(
    db,
    `UPDATE units SET emergency_active = 0, emergency_call_id = NULL, emergency_since = NULL
     WHERE emergency_call_id = ?`,
    callId,
  );
}

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
  // Accept both shapes the clients send: PanicButton/RadialMenu post
  // `trigger_method`; older callers post `source`. location_address is
  // optional (clients don't reverse-geocode) — we synthesize a GPS string.
  const body = await c.req.json<{
    latitude?: number; longitude?: number; location_address?: string;
    trigger_method?: string; source?: string; message?: string; call_id?: number;
  }>().catch(() => ({} as Record<string, never>));

  // Treat a non-finite OR zero coordinate as "no fix" — phones that fail to get
  // a lock frequently post (0,0) or null, and a panic at the equator/prime-
  // meridian is not a real scenario for an SLC security operation.
  const rawLat = Number(body.latitude);
  const rawLng = Number(body.longitude);
  let lat = Number.isFinite(rawLat) && rawLat !== 0 ? rawLat : null;
  let lng = Number.isFinite(rawLng) && rawLng !== 0 ? rawLng : null;
  const triggerMethod = body.trigger_method ?? body.source ?? 'ui_button';

  // Officer identity (for the CAD description + dispatcher voice) and the
  // officer's current unit (so we can assign it to the panic call). The unit's
  // last-known GPS is the officer-safety fallback when the panic payload has no
  // coordinates (button mashed before a fix, indoors, etc.).
  const officer = await queryFirst<{ full_name: string; badge_number: string | null }>(
    db, 'SELECT full_name, badge_number FROM users WHERE id = ? LIMIT 1', userId,
  );
  const unit = await queryFirst<{ id: number; call_sign: string; current_call_id: number | null; latitude: number | null; longitude: number | null }>(
    db, 'SELECT id, call_sign, current_call_id, latitude, longitude FROM units WHERE officer_id = ? LIMIT 1', userId,
  );

  // GPS fallback: if the client sent no usable coordinates, plot the panic at
  // the officer's unit's last-known position so dispatch still has a location to
  // roll backup to (better than "Unknown location"). Same zero/non-finite guard.
  let usedUnitGps = false;
  if (lat == null || lng == null) {
    const uLat = Number(unit?.latitude);
    const uLng = Number(unit?.longitude);
    if (Number.isFinite(uLat) && uLat !== 0 && Number.isFinite(uLng) && uLng !== 0) {
      lat = uLat;
      lng = uLng;
      usedUnitGps = true;
    }
  }

  const locationAddress = body.location_address
    ?? (lat != null && lng != null
      ? `GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)}${usedUnitGps ? ' (last-known unit position)' : ''}`
      : 'Unknown location');

  // ── Auto-create the P1 officer_assist CAD call (parity with the original
  // handler). The panic must produce a dispatchable incident, not just an
  // alert row: dispatcher boards surface it via their 20s cross-device poll
  // (DispatchPage CROSS_DEVICE_SYNC_MS), which is how EVERY call propagates
  // cross-device today — the WS broadcast below only reaches same-isolate
  // clients (see ws.ts; the live /api/ws socket is owned by the other
  // worker). Best-effort: a CAD-call failure must NEVER block the panic row
  // itself, so it's wrapped and the panic still records + broadcasts.
  // SQL columns/CHECKs verified against live: priority IN ('P1'..'P4'),
  // source IN (...,'panic',...), units.status 'dispatched' all valid.
  let callId: number | null = body.call_id ?? null;
  if (callId == null) {
    try {
      const callNumber = `PAN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
      const description = `PANIC ALARM — Officer ${officer?.full_name ?? 'Unknown'}`
        + ` (Badge: ${officer?.badge_number || 'N/A'}) triggered emergency alert.`
        + (body.message ? ` Message: ${body.message}` : '');
      const callResult = await execute(
        db,
        `INSERT INTO calls_for_service
           (call_number, incident_type, priority, status, caller_name, location_address,
            latitude, longitude, description, source, dispatcher_id, created_at, dispatched_at)
         VALUES (?, 'officer_assist', 'P1', 'dispatched', ?, ?, ?, ?, ?, 'panic', ?, datetime('now'), datetime('now'))`,
        callNumber, officer?.full_name ?? null, locationAddress, lat, lng, description, userId,
      );
      callId = Number(callResult.meta.last_row_id);
      // Assign the officer's own unit to their panic call.
      if (unit?.id) {
        await execute(
          db,
          `UPDATE units SET status = 'dispatched', current_call_id = ?, last_status_change = datetime('now') WHERE id = ?`,
          callId, unit.id,
        );
        await execute(
          db, `UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?`,
          JSON.stringify([unit.id]), callId,
        );
      }
    } catch (err) {
      console.error('[panic] CAD call create failed (non-fatal)', err);
      callId = body.call_id ?? unit?.current_call_id ?? null;
    }
  }

  const result = await execute(
    db,
    // Schema reality (live panic_alerts): officer_id is NOT NULL (no default);
    // the trigger column is `trigger_method` (NOT `source`); and there is NO
    // `unit_id` column — the unit is resolved via the officer on read.
    // created_at/updated_at = UTC.
    `INSERT INTO panic_alerts (officer_id, user_id, call_id, latitude, longitude, location_address, trigger_method, message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    userId, userId, callId, lat, lng, locationAddress, triggerMethod, body.message ?? null,
  );
  const panicId = Number(result.meta.last_row_id);

  // ── Spillman parity: put the officer's unit into the EMERGENCY overlay
  // state (flashing red on the Status Monitor / map). It's an overlay on top
  // of the normal status enum — cleared on resolve/cancel/false-alarm (NOT on
  // acknowledge: ack silences the alarm but the unit stays emergent). The unit
  // GET (SELECT u.*) carries these columns to the board automatically.
  if (unit?.id) {
    await execute(
      db,
      `UPDATE units SET emergency_active = 1, emergency_call_id = ?, emergency_since = datetime('now') WHERE id = ?`,
      callId, unit.id,
    ).catch((err) => console.error('[panic] set unit emergency failed (non-fatal)', err));
  }

  const created = await queryFirst<Record<string, unknown>>(
    db,
    // call_number is joined so the dispatcher overlay's P1 card renders
    // (PanicButton reads incomingAlert.call_number).
    `SELECT p.*, u.full_name as user_name, u.badge_number, un.call_sign, cfs.call_number
     FROM panic_alerts p
     LEFT JOIN users u ON u.id = COALESCE(p.user_id, p.officer_id)
     LEFT JOIN units un ON un.officer_id = p.officer_id
     LEFT JOIN calls_for_service cfs ON cfs.id = p.call_id
     WHERE p.id = ?`,
    panicId,
  ).catch(() => null);

  // Everything below is best-effort fan-out. The panic row is already
  // committed; a failure here must NOT surface as a 500 to the officer
  // (they'd think the alert failed and re-fire / waste seconds). Wrap it.
  try {
    // Agency-wide instant alarm via the global AlertHubDO — reaches EVERY
    // connected console/MDT (the shared bus that replaces the dead
    // per-isolate broadcastAll). The DO also persists this panic and
    // re-broadcasts it every 15s until a dispatcher acknowledges — the
    // forced-acknowledgment behaviour authentic Spillman Flex requires.
    await emitAlert(c.env, 'panic_alert', { action: 'panic_activated', panic: created });

    // Alert Rules engine — fire the 'unit_panic' trigger so any admin-
    // configured panic rules notify their targets.
    await evaluateNotificationRules(db, 'unit_panic', {
      title: 'PANIC ACTIVATED',
      message: `Officer panic alert${(created as Record<string, unknown>)?.user_name ? ' — ' + (created as Record<string, unknown>).user_name : ''}`,
      priority: 'critical',
      entity_type: 'panic_alert',
      entity_id: panicId,
    }, c.env);
  } catch (err) {
    console.error('[panic] post-insert fan-out failed (non-fatal)', err);
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
  // Ack silences the agency-wide reminder (AlertHubDO stops nagging) but the
  // unit stays emergent until a terminal transition.
  await emitAlert(c.env, 'panic_alert', { action: 'panic_acknowledged', panic: updated });
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
  await clearUnitEmergency(db, updated as Record<string, unknown> | null);
  await emitAlert(c.env, 'panic_alert', { action: 'panic_resolved', panic: updated });
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
  await clearUnitEmergency(db, updated as Record<string, unknown> | null);
  await emitAlert(c.env, 'panic_alert', { action: 'panic_cancelled', panic: updated });
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
  await clearUnitEmergency(db, updated as Record<string, unknown> | null);
  await emitAlert(c.env, 'panic_alert', { action: 'panic_false_alarm', panic: updated });
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

    // Fan to the whole fleet via the shared hub (the per-isolate broadcast
    // never reached anyone — same dead path the panic alert had).
    await emitAlert(c.env, 'dispatch_update', payload);
    return c.json({ success: true, broadcast: payload });
  } catch (err) {
    console.error('[dispatch] request-backup error', err);
    return c.json({ error: 'Failed to request backup', code: 'REQUEST_BACKUP_ERR' }, 500);
  }
});

export default panic;
