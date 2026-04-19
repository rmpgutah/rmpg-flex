import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../../models/database';
import { authenticateToken, requireRole } from '../../middleware/auth';
import { broadcastDispatchUpdate, broadcastUnitUpdate, broadcastPanic } from '../../utils/websocket';
import { generateCallNumber } from '../../utils/caseNumbers';
import { localNow } from '../../utils/timeUtils';
import { reverseGeocodeAddress } from '../../utils/geocode';
import { auditLog } from '../../utils/auditLogger';
import { buildThreatContext } from '../../utils/threatContext';
import { findNearestUnits } from '../../utils/proximityAlerts';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// ── In-memory escalation timer map (wired in Task 3) ──
const escalationTimers = new Map<number, NodeJS.Timeout[]>();

export function cancelEscalationTimer(panicId: number): void {
  const timers = escalationTimers.get(panicId);
  if (timers) {
    timers.forEach(t => clearTimeout(t));
    escalationTimers.delete(panicId);
  }
}

export { escalationTimers };

// ── Escalation Engine (Task 3) ─────────────────────────────
// After a panic is created, three escalation tiers fire on timers:
//   Level 1 — Re-broadcast the panic (configurable, default 30s)
//   Level 2 — Auto-dispatch nearest available units (default 60s)
//   Level 3 — Email all supervisors/admins/managers (default 90s)
// Timers are cancelled when the panic is acknowledged, resolved,
// cancelled, or marked as false alarm.

function startEscalationTimer(panicId: number): void {
  const db = getDb();
  const getConfig = (key: string, fallback: number): number => {
    const row = db.prepare('SELECT config_value FROM system_config WHERE config_key = ?').get(key) as any;
    return row ? parseInt(row.config_value) : fallback;
  };

  const esc1Ms = getConfig('panic_escalation_1_seconds', 30) * 1000;
  const esc2Ms = getConfig('panic_escalation_2_seconds', 60) * 1000;
  const esc3Ms = getConfig('panic_escalation_3_seconds', 90) * 1000;

  const timers: NodeJS.Timeout[] = [];

  // Level 1: Re-broadcast after esc1Ms
  timers.push(setTimeout(() => {
    try {
      const db2 = getDb();
      const panic = db2.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
      if (!panic || panic.status !== 'active') return;
      db2.prepare('UPDATE panic_alerts SET escalation_level = 1, updated_at = ? WHERE id = ?')
        .run(localNow(), panicId);
      broadcastPanic({ type: 'panic_escalated', data: { panic_id: panicId, level: 1 } });
      console.log(`[Panic] Escalation level 1 triggered for panic #${panicId}`);
    } catch (err) {
      console.error(`[Panic] Escalation level 1 error for panic #${panicId}:`, err);
    }
  }, esc1Ms));

  // Level 2: Auto-dispatch nearest units after esc2Ms
  timers.push(setTimeout(() => {
    try {
      const db2 = getDb();
      const panic = db2.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
      if (!panic || panic.status !== 'active') return;
      db2.prepare('UPDATE panic_alerts SET escalation_level = 2, updated_at = ? WHERE id = ?')
        .run(localNow(), panicId);
      autoDispatchNearestUnits(panicId, panic);
      broadcastPanic({ type: 'panic_escalated', data: { panic_id: panicId, level: 2 } });
      console.log(`[Panic] Escalation level 2 triggered for panic #${panicId} — auto-dispatching nearest units`);
    } catch (err) {
      console.error(`[Panic] Escalation level 2 error for panic #${panicId}:`, err);
    }
  }, esc2Ms));

  // Level 3: Email supervisors after esc3Ms
  timers.push(setTimeout(async () => {
    try {
      const db2 = getDb();
      const panic = db2.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
      if (!panic || panic.status !== 'active') return;
      db2.prepare('UPDATE panic_alerts SET escalation_level = 3, updated_at = ? WHERE id = ?')
        .run(localNow(), panicId);
      await emailSupervisors(panicId, panic);
      broadcastPanic({ type: 'panic_escalated', data: { panic_id: panicId, level: 3 } });
      console.log(`[Panic] Escalation level 3 triggered for panic #${panicId} — emailing supervisors`);
    } catch (err) {
      console.error(`[Panic] Escalation level 3 error for panic #${panicId}:`, err);
    }
  }, esc3Ms));

  escalationTimers.set(panicId, timers);
}

function autoDispatchNearestUnits(panicId: number, panic: any): void {
  const db = getDb();
  if (!panic.latitude || !panic.longitude) return;

  const availableUnits = db.prepare(`
    SELECT * FROM units
    WHERE status IN ('available', 'on_patrol')
    AND latitude IS NOT NULL AND longitude IS NOT NULL
    ORDER BY (
      (latitude - ?) * (latitude - ?) +
      (longitude - ?) * (longitude - ?)
    ) ASC
    LIMIT 3
  `).all(panic.latitude, panic.latitude, panic.longitude, panic.longitude);

  const unitIds: number[] = [];
  const now = localNow();
  for (const unit of availableUnits as any[]) {
    db.prepare('UPDATE units SET status = ?, current_call_id = ?, last_status_change = ? WHERE id = ?')
      .run('dispatched', panic.call_id, now, unit.id);
    unitIds.push(unit.id);
    broadcastUnitUpdate({ action: 'unit_status_changed', unit: { ...unit, status: 'dispatched', current_call_id: panic.call_id } });
  }

  if (unitIds.length > 0) {
    db.prepare('UPDATE panic_alerts SET responder_unit_ids = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(unitIds), now, panicId);
    console.log(`[Panic] Auto-dispatched ${unitIds.length} units for panic #${panicId}: [${unitIds.join(', ')}]`);
  }
}

async function emailSupervisors(panicId: number, panic: any): Promise<void> {
  try {
    const { sendEmail } = await import('../../utils/emailSender');
    const db = getDb();
    const supervisors = db.prepare(
      "SELECT email, full_name FROM users WHERE role IN ('admin', 'supervisor', 'manager') AND email IS NOT NULL"
    ).all() as any[];

    const user = db.prepare('SELECT full_name, badge_number FROM users WHERE id = ?').get(panic.user_id) as any;

    for (const sup of supervisors) {
      if (!sup.email) continue;
      // Panic escalation runs from a server-side timer (no req in scope) —
      // send from admin mailbox (user 1). Per Phase 4 per-user Graph design.
      await sendEmail(1, {
        to: sup.email,
        subject: `EMERGENCY: Unacknowledged Panic Alert - ${user?.full_name || 'Unknown Officer'}`,
        html: `<h2 style="color:red;">Panic Alert - Unacknowledged</h2>
          <p><strong>Officer:</strong> ${user?.full_name || 'Unknown'} (Badge: ${user?.badge_number || 'N/A'})</p>
          <p><strong>Location:</strong> ${panic.location_address || 'Unknown'}</p>
          <p><strong>GPS:</strong> ${panic.latitude ?? 'N/A'}, ${panic.longitude ?? 'N/A'}</p>
          <p><strong>Time:</strong> ${panic.created_at}</p>
          <p><strong>Message:</strong> ${panic.message || 'None'}</p>
          <p>This alert has not been acknowledged after 90 seconds. Immediate action required.</p>`,
      }).catch((err: any) => console.error('[Panic] Failed to email supervisor:', sup.email, err));
    }
  } catch (err) {
    console.error('[Panic] Failed to email supervisors for panic escalation:', err);
  }
}

// ── POST /api/dispatch/panic — Emergency PANIC button ──
// Broadcasts audible alert to all connected users, creates dispatch call + panic_alerts record
router.post('/panic', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { latitude, longitude, message, trigger_method } = req.body;

    // Validate panic input
    if (message !== undefined && message !== null) {
      if (typeof message !== 'string' || message.length > 500) {
        res.status(400).json({ error: 'Message must be a string of 500 characters or less', code: 'INVALID_MESSAGE' });
        return;
      }
    }
    if (latitude != null && (isNaN(Number(latitude)) || Math.abs(Number(latitude)) > 90)) {
      res.status(400).json({ error: 'Invalid latitude', code: 'INVALID_LATITUDE' });
      return;
    }
    if (longitude != null && (isNaN(Number(longitude)) || Math.abs(Number(longitude)) > 180)) {
      res.status(400).json({ error: 'Invalid longitude', code: 'INVALID_LONGITUDE' });
      return;
    }

    const user = db.prepare('SELECT id, full_name, badge_number, role FROM users WHERE id = ?')
      .get(req.user!.userId) as any;

    if (!user) {
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      return;
    }

    const now = localNow();

    // ── Reverse-geocode officer GPS -> address (with fallback) ──
    // Must happen BEFORE the transaction since it's async
    let locationAddress = latitude != null && longitude != null && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
      ? `GPS: ${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`
      : 'Unknown location';

    if (latitude != null && longitude != null) {
      try {
        const addr = await reverseGeocodeAddress(Number(latitude), Number(longitude));
        if (addr) locationAddress = addr;
      } catch (geoErr) { console.error('[Panic] Reverse geocode failed, using GPS fallback:', geoErr instanceof Error ? geoErr.message : geoErr); }
    }

    // ── All DB writes in a single transaction for atomicity ──
    const callNumber = generateCallNumber(db);
    const description = `PANIC ALARM — Officer ${user.full_name} (Badge: ${user.badge_number || 'N/A'}) triggered emergency alert.${message ? ' Message: ' + message : ''}`;

    const panicTx = db.transaction(() => {
      // Log the panic alert to activity log
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'panic_alert', 'user', ?, ?, ?)
      `).run(
        user.id,
        user.id,
        `PANIC ALERT triggered by ${user.full_name} (${user.badge_number || 'N/A'})${message ? ': ' + message : ''}`,
        req.ip || 'unknown'
      );

      // Auto-create "Officer Assist — Panic Alarm" dispatch call
      const callResult = db.prepare(`
        INSERT INTO calls_for_service (
          call_number, incident_type, priority, status,
          caller_name, location_address, latitude, longitude,
          description, source, dispatcher_id,
          weapons_involved, created_at, dispatched_at
        ) VALUES (?, 'officer_assist', 'P1', 'dispatched',
          ?, ?, ?, ?,
          ?, 'panic', ?,
          'unknown', ?, ?)
      `).run(
        callNumber,
        user.full_name,
        locationAddress,
        latitude ?? null,
        longitude ?? null,
        description,
        user.id,
        now,
        now,
      );

      const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?')
        .get(callResult.lastInsertRowid) as any;
      if (!call) throw new Error('Failed to retrieve auto-created panic call');

      // Auto-assign officer's unit to the call
      const unit = db.prepare('SELECT id, call_sign FROM units WHERE officer_id = ?')
        .get(user.id) as any;

      if (unit) {
        db.prepare('UPDATE units SET status = ?, current_call_id = ?, last_status_change = ? WHERE id = ?')
          .run('dispatched', call.id, now, unit.id);

        const unitIds = JSON.stringify([unit.id]);
        db.prepare('UPDATE calls_for_service SET assigned_unit_ids = ? WHERE id = ?')
          .run(unitIds, call.id);
      }

      // Insert panic_alerts record
      const panicResult = db.prepare(`
        INSERT INTO panic_alerts (
          user_id, call_id, trigger_method, message,
          latitude, longitude, location_address,
          status, escalation_level, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)
      `).run(
        user.id,
        call.id,
        trigger_method || 'ui_button',
        message || null,
        latitude ?? null,
        longitude ?? null,
        locationAddress,
        now,
        now,
      );

      // Log call creation
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'call_created', 'call', ?, ?, ?)
      `).run(user.id, call.id, `PANIC auto-created ${callNumber}: officer_assist`, req.ip || 'unknown');

      return { call, unit, panicId: Number(panicResult.lastInsertRowid) };
    });

    const { call, unit, panicId } = panicTx();

    // ── Broadcasts happen AFTER transaction commits ──
    if (unit) {
      broadcastUnitUpdate({ action: 'unit_status_changed', unit: { ...unit, status: 'dispatched', current_call_id: call.id } });
    }

    broadcastPanic({
      panic_id: panicId,
      user_id: user.id,
      user_name: user.full_name,
      badge_number: user.badge_number,
      role: user.role,
      message: message || null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      triggered_at: now,
      call_number: callNumber,
      call_id: call.id,
      location_address: locationAddress,
      unit_call_sign: unit?.call_sign || null,
    });

    const enrichedCall = db.prepare(`
      SELECT c.*, u.full_name as dispatcher_name
      FROM calls_for_service c
      LEFT JOIN users u ON c.dispatcher_id = u.id
      WHERE c.id = ?
    `).get(call.id);

    // Find nearest units (sync)
    let nearestUnits: any[] = [];
    try {
      const panicCall = enrichedCall || call;
      if (panicCall.latitude && panicCall.longitude) {
        nearestUnits = findNearestUnits(panicCall.latitude, panicCall.longitude, 3);
      }
    } catch { /* non-critical */ }

    broadcastDispatchUpdate({ action: 'call_created', call: enrichedCall || call, nearestUnits });

    // Async threat context enrichment for panic call
    buildThreatContext({
      locationAddress: (enrichedCall || call).location_address,
      latitude: (enrichedCall || call).latitude,
      longitude: (enrichedCall || call).longitude,
      callId: call.id,
    }).then((ctx) => {
      if (ctx.briefingSummary) {
        broadcastDispatchUpdate({
          action: 'call_created',
          call: enrichedCall || call,
          threatContext: {
            threatLevel: ctx.threatLevel,
            briefingSummary: ctx.briefingSummary,
            premiseHistoryCount: ctx.premiseHistory.totalCalls,
            activeWarrantCount: ctx.activeWarrants.length,
          },
          nearestUnits,
        });
      }
    }).catch(() => { /* non-critical */ });

    auditLog(req, 'panic_activated', 'call', call.id, `PANIC alert by ${user.full_name} (${user.badge_number || 'N/A'}) — call ${callNumber} created`);

    // Start escalation timer (Task 3) — fires Level 1/2/3 if panic remains unacknowledged
    startEscalationTimer(panicId);

    res.json({
      success: true,
      message: 'Panic alert sent — dispatch call created',
      call_number: callNumber,
      call_id: call.id,
      panic_id: panicId,
    });
  } catch (error: any) {
    console.error('[Dispatch] panic alert error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'PANIC_ERROR' });
  }
});

// ── POST /api/dispatch/panic/:id/acknowledge — Acknowledge a panic alert ──
router.post('/panic/:id/acknowledge', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const panicId = Number(req.params.id);
    if (isNaN(panicId)) {
      res.status(400).json({ error: 'Invalid panic ID', code: 'INVALID_ID' });
      return;
    }

    const panic = db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
    if (!panic) {
      res.status(404).json({ error: 'Panic alert not found', code: 'NOT_FOUND' });
      return;
    }

    if (panic.status !== 'active') {
      res.status(409).json({ error: `Panic alert is already ${panic.status}`, code: 'INVALID_STATUS' });
      return;
    }

    const now = localNow();
    db.prepare(`
      UPDATE panic_alerts SET status = 'acknowledged', acknowledged_at = ?, acknowledged_by = ?, updated_at = ?
      WHERE id = ?
    `).run(now, req.user!.userId, now, panicId);

    cancelEscalationTimer(panicId);

    auditLog(req, 'panic_acknowledged', 'panic_alerts', panicId, `Panic #${panicId} acknowledged`);

    broadcastPanic({
      type: 'panic_acknowledged',
      data: { panic_id: panicId, acknowledged_by: req.user!.userId, acknowledged_at: now },
    });

    res.json({ success: true, message: 'Panic alert acknowledged' });
  } catch (error: any) {
    console.error('[Panic] acknowledge error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'PANIC_ACK_ERROR' });
  }
});

// ── POST /api/dispatch/panic/:id/resolve — Resolve a panic alert ──
router.post('/panic/:id/resolve', requireRole('admin', 'supervisor', 'manager'), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const panicId = Number(req.params.id);
    if (isNaN(panicId)) {
      res.status(400).json({ error: 'Invalid panic ID', code: 'INVALID_ID' });
      return;
    }

    const { resolution_notes } = req.body;
    if (!resolution_notes || typeof resolution_notes !== 'string' || resolution_notes.trim().length < 10) {
      res.status(400).json({ error: 'Resolution notes are required (minimum 10 characters)', code: 'INVALID_NOTES' });
      return;
    }

    const panic = db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
    if (!panic) {
      res.status(404).json({ error: 'Panic alert not found', code: 'NOT_FOUND' });
      return;
    }

    if (panic.status === 'resolved' || panic.status === 'cancelled' || panic.status === 'false_alarm') {
      res.status(409).json({ error: `Panic alert is already ${panic.status}`, code: 'INVALID_STATUS' });
      return;
    }

    const now = localNow();
    db.prepare(`
      UPDATE panic_alerts SET status = 'resolved', resolved_at = ?, resolved_by = ?, resolution_notes = ?, updated_at = ?
      WHERE id = ?
    `).run(now, req.user!.userId, resolution_notes.trim(), now, panicId);

    cancelEscalationTimer(panicId);

    auditLog(req, 'panic_resolved', 'panic_alerts', panicId, `Panic #${panicId} resolved: ${resolution_notes.trim().substring(0, 100)}`);

    broadcastPanic({
      type: 'panic_resolved',
      data: { panic_id: panicId, resolved_by: req.user!.userId, resolved_at: now },
    });

    res.json({ success: true, message: 'Panic alert resolved' });
  } catch (error: any) {
    console.error('[Panic] resolve error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'PANIC_RESOLVE_ERROR' });
  }
});

// ── POST /api/dispatch/panic/:id/cancel — Officer cancels own panic (within 30 seconds) ──
router.post('/panic/:id/cancel', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const panicId = Number(req.params.id);
    if (isNaN(panicId)) {
      res.status(400).json({ error: 'Invalid panic ID', code: 'INVALID_ID' });
      return;
    }

    const panic = db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
    if (!panic) {
      res.status(404).json({ error: 'Panic alert not found', code: 'NOT_FOUND' });
      return;
    }

    // Only the triggering officer can cancel
    if (panic.user_id !== req.user!.userId) {
      res.status(403).json({ error: 'Only the triggering officer can cancel their own panic alert', code: 'FORBIDDEN' });
      return;
    }

    if (panic.status !== 'active') {
      res.status(409).json({ error: `Panic alert is already ${panic.status} and cannot be cancelled`, code: 'INVALID_STATUS' });
      return;
    }

    // Must be within 30 seconds of creation
    const createdAt = new Date(panic.created_at).getTime();
    const nowMs = Date.now();
    if (nowMs - createdAt > 30_000) {
      res.status(409).json({ error: 'Panic alert can only be cancelled within 30 seconds of activation', code: 'CANCEL_WINDOW_EXPIRED' });
      return;
    }

    const now = localNow();
    db.prepare(`
      UPDATE panic_alerts SET status = 'cancelled', updated_at = ?
      WHERE id = ?
    `).run(now, panicId);

    cancelEscalationTimer(panicId);

    auditLog(req, 'panic_cancelled', 'panic_alerts', panicId, `Panic #${panicId} cancelled by triggering officer`);

    broadcastPanic({
      type: 'panic_cancelled',
      data: { panic_id: panicId, cancelled_by: req.user!.userId, cancelled_at: now },
    });

    res.json({ success: true, message: 'Panic alert cancelled' });
  } catch (error: any) {
    console.error('[Panic] cancel error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'PANIC_CANCEL_ERROR' });
  }
});

// ── POST /api/dispatch/panic/:id/false-alarm — Supervisor marks as false alarm ──
router.post('/panic/:id/false-alarm', requireRole('admin', 'supervisor', 'manager'), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const panicId = Number(req.params.id);
    if (isNaN(panicId)) {
      res.status(400).json({ error: 'Invalid panic ID', code: 'INVALID_ID' });
      return;
    }

    const { resolution_notes } = req.body;
    if (!resolution_notes || typeof resolution_notes !== 'string' || resolution_notes.trim().length < 10) {
      res.status(400).json({ error: 'Resolution notes are required (minimum 10 characters)', code: 'INVALID_NOTES' });
      return;
    }

    const panic = db.prepare('SELECT * FROM panic_alerts WHERE id = ?').get(panicId) as any;
    if (!panic) {
      res.status(404).json({ error: 'Panic alert not found', code: 'NOT_FOUND' });
      return;
    }

    if (panic.status === 'resolved' || panic.status === 'cancelled' || panic.status === 'false_alarm') {
      res.status(409).json({ error: `Panic alert is already ${panic.status}`, code: 'INVALID_STATUS' });
      return;
    }

    const now = localNow();
    db.prepare(`
      UPDATE panic_alerts SET status = 'false_alarm', resolution_notes = ?, resolved_by = ?, resolved_at = ?, updated_at = ?
      WHERE id = ?
    `).run(resolution_notes.trim(), req.user!.userId, now, now, panicId);

    cancelEscalationTimer(panicId);

    auditLog(req, 'panic_false_alarm', 'panic_alerts', panicId, `Panic #${panicId} marked false alarm: ${resolution_notes.trim().substring(0, 100)}`);

    broadcastPanic({
      type: 'panic_false_alarm',
      data: { panic_id: panicId, resolved_by: req.user!.userId, resolved_at: now },
    });

    res.json({ success: true, message: 'Panic alert marked as false alarm' });
  } catch (error: any) {
    console.error('[Panic] false-alarm error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'PANIC_FALSE_ALARM_ERROR' });
  }
});

// ── GET /api/dispatch/panic/active — All active/acknowledged panics ──
router.get('/panic/active', requireRole('admin', 'supervisor', 'manager', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const panics = db.prepare(`
      SELECT pa.*,
        u.full_name as officer_name, u.badge_number as officer_badge,
        ack.full_name as acknowledged_by_name
      FROM panic_alerts pa
      LEFT JOIN users u ON pa.user_id = u.id
      LEFT JOIN users ack ON pa.acknowledged_by = ack.id
      WHERE pa.status IN ('active', 'acknowledged')
      ORDER BY pa.created_at DESC
    `).all();

    res.json(panics);
  } catch (error: any) {
    console.error('[Panic] active list error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'PANIC_ACTIVE_ERROR' });
  }
});

// ── GET /api/dispatch/panic/history — Historical panic log ──
router.get('/panic/history', requireRole('admin', 'supervisor', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.max(Number(req.query.limit) || 25, 1);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const total = (db.prepare('SELECT COUNT(*) as count FROM panic_alerts').get() as any)?.count || 0;

    const data = db.prepare(`
      SELECT pa.*,
        u.full_name as officer_name, u.badge_number as officer_badge,
        ack.full_name as acknowledged_by_name,
        res.full_name as resolved_by_name
      FROM panic_alerts pa
      LEFT JOIN users u ON pa.user_id = u.id
      LEFT JOIN users ack ON pa.acknowledged_by = ack.id
      LEFT JOIN users res ON pa.resolved_by = res.id
      ORDER BY pa.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    res.json({ data, total, limit, offset });
  } catch (error: any) {
    console.error('[Panic] history error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'PANIC_HISTORY_ERROR' });
  }
});

// ── GET /api/dispatch/panic/:id/audio — Stream recorded panic audio (Task 4) ──
router.get('/panic/:id/audio', requireRole('admin', 'supervisor', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const panicId = parseInt(req.params.id as string);
    if (isNaN(panicId)) {
      res.status(400).json({ error: 'Invalid panic ID', code: 'INVALID_ID' });
      return;
    }

    const panic = db.prepare('SELECT audio_file_id FROM panic_alerts WHERE id = ?').get(panicId) as any;
    if (!panic?.audio_file_id) {
      res.status(404).json({ error: 'No audio recorded for this panic' });
      return;
    }

    const attachment = db.prepare('SELECT * FROM attachments WHERE file_id = ?').get(panic.audio_file_id) as any;
    if (!attachment) {
      res.status(404).json({ error: 'Audio attachment not found' });
      return;
    }

    const filePath = attachment.file_path;
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Audio file not found on disk' });
      return;
    }

    res.setHeader('Content-Type', attachment.mime_type || 'audio/webm');
    res.setHeader('Content-Length', attachment.file_size);
    res.setHeader('Content-Disposition', `inline; filename="${attachment.original_name}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (error: any) {
    console.error('[Panic] audio stream error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error', code: 'PANIC_AUDIO_ERROR' });
  }
});

export default router;
