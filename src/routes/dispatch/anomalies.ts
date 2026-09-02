// Dispatch anomaly alerts — read + acknowledge surface for the
// AnomalyAlertBanner. The detection pass that POPULATES anomaly_alerts
// runs in the Worker's scheduled() cron (see src/index.ts); this router
// only exposes the stored alerts and lets a dispatcher acknowledge them.
//
// Mounted at /api/dispatch, owns /anomaly-alerts + /anomaly-alerts/:id/
// acknowledge. Routed there via rmpg-api-proxy.

import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { log } from '../../utils/logger';
import { requireRole } from '../../middleware/auth';

const READ_ROLES = ['admin', 'manager', 'supervisor', 'dispatcher'] as const;

const anomalies = new Hono<Env>();

// GET /api/dispatch/anomaly-alerts?hours=4 — active (unacknowledged)
// alerts in the window, newest first. Shape matches the client's
// AnomalyAlert interface 1:1 (no transform).
anomalies.get('/anomaly-alerts', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const hoursRaw = parseInt(c.req.query('hours') || '4', 10);
    const hours = Math.min(168, Math.max(1, Number.isFinite(hoursRaw) ? hoursRaw : 4));
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT id, alert_type, severity, title, details, zone_beat,
              acknowledged_by, acknowledged_at, created_at
         FROM anomaly_alerts
        WHERE created_at >= datetime('now', '-' || ? || ' hours')
         AND acknowledged_at IS NULL
        ORDER BY created_at DESC
        LIMIT 200`,
      hours,
    );
    return c.json(rows);
  } catch (err) {
    // Table-missing or query error → empty list so the banner degrades
    // to "no alerts" rather than throwing.
    log.error('[dispatch] anomaly-alerts list error', {}, err);
    return c.json([]);
  }
});

// POST /api/dispatch/anomaly-alerts/:id/acknowledge — dispatcher clears
// an alert. Acknowledged rows drop out of the active dedup index so the
// same condition can re-alert later.
anomalies.post('/anomaly-alerts/:id/acknowledge', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid alert id', code: 'INVALID_ID' }, 400);

    const alert = await queryFirst<{ id: number }>(db, 'SELECT id FROM anomaly_alerts WHERE id = ?', id);
    if (!alert) return c.json({ error: 'Alert not found', code: 'ALERT_NOT_FOUND' }, 404);

    await execute(
      db,
      "UPDATE anomaly_alerts SET acknowledged_by = ?, acknowledged_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      userId ?? null,
      id,
    );
    return c.json({ success: true, id });
  } catch (err) {
    log.error('[dispatch] anomaly acknowledge error', {}, err);
    return c.json({ error: 'Failed to acknowledge alert', code: 'ANOMALY_ACK_ERR' }, 500);
  }
});

export default anomalies;

// ============================================================
// Detection pass — runs in the Worker scheduled() cron.
// ============================================================
// Each rule finds currently-anomalous calls, upserts an active alert
// keyed on dedup_key (SELECT-then-write; partial-index ON CONFLICT is
// finicky in D1), and the auto-resolve step acknowledges any active
// alert of these types whose condition no longer holds — so the banner
// self-heals instead of accumulating stale rows.
//
// Rules use only columns that exist on live D1:
//   - unassigned_call : status pending/dispatched, aged >20min, no unit
//                       has current_call_id pointing at it (HIGH).
//   - overdue_onscene : status onscene; PSO types >25 min (HIGH), others >3h (MEDIUM).

interface AnomalyCandidate {
  dedup_key: string;
  alert_type: string;
  severity: string;
  title: string;
  details: string;
  zone_beat: string | null;
}

async function upsertActiveAlert(db: D1Database, a: AnomalyCandidate): Promise<void> {
  const existing = await queryFirst<{ id: number }>(
    db, 'SELECT id FROM anomaly_alerts WHERE dedup_key = ? AND acknowledged_at IS NULL', a.dedup_key);
  if (existing) {
    await execute(db,
      "UPDATE anomaly_alerts SET details = ?, severity = ?, title = ?, zone_beat = ?, updated_at = datetime('now') WHERE id = ?",
      a.details, a.severity, a.title, a.zone_beat, existing.id);
  } else {
    await execute(db,
      `INSERT INTO anomaly_alerts (alert_type, severity, title, details, zone_beat, dedup_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      a.alert_type, a.severity, a.title, a.details, a.zone_beat, a.dedup_key);
  }
}

export async function detectDispatchAnomalies(db: D1Database): Promise<{ raised: number; resolved: number }> {
  const candidates: AnomalyCandidate[] = [];

  // Rule 1 — unassigned overdue calls.
  const unassigned = await query<{ id: number; call_number: string; beat_id: number | null; priority: string | null }>(
    db,
    `SELECT c.id, c.call_number, c.beat_id, c.priority
       FROM calls_for_service c
      WHERE c.status IN ('pending', 'dispatched')
        AND COALESCE(c.dispatched_at, c.created_at) <= datetime('now', '-20 minutes')
        AND NOT EXISTS (SELECT 1 FROM units u WHERE u.current_call_id = c.id)
      LIMIT 100`,
  );
  for (const c of unassigned) {
    candidates.push({
      dedup_key: `unassigned_call:${c.id}`,
      alert_type: 'unassigned_call',
      severity: c.priority === 'P1' ? 'critical' : 'high',
      title: `Call ${c.call_number} unassigned >20 min`,
      details: `Call ${c.call_number} (priority ${c.priority ?? '?'}) has had no unit assigned for over 20 minutes.`,
      zone_beat: c.beat_id != null ? String(c.beat_id) : null,
    });
  }

  // Rule 2 — calls on-scene far past a reasonable duration.
  // PSO paper service is planned at ~18–22 min on site; 3 hours is a patrol
  // welfare check, not a serve. Flag PSO visits after 25 minutes so Dispatch
  // can bounce the unit to the next client request instead of waiting for 3h.
  const overdue = await query<{ id: number; call_number: string; beat_id: number | null; incident_type: string | null }>(
    db,
    `SELECT c.id, c.call_number, c.beat_id, c.incident_type
       FROM calls_for_service c
      WHERE c.status = 'onscene'
        AND c.onscene_at IS NOT NULL
        AND (
          (
            c.incident_type IN ('pso_client_request', 'process_service', 'civil_paper_service')
            AND c.onscene_at <= datetime('now', '-25 minutes')
          )
          OR (
            c.incident_type NOT IN ('pso_client_request', 'process_service', 'civil_paper_service')
            AND c.onscene_at <= datetime('now', '-3 hours')
          )
        )
      LIMIT 100`,
  );
  for (const c of overdue) {
    const isPso = ['pso_client_request', 'process_service', 'civil_paper_service'].includes(String(c.incident_type || ''));
    candidates.push({
      dedup_key: `overdue_onscene:${c.id}`,
      alert_type: 'overdue_onscene',
      severity: isPso ? 'high' : 'medium',
      title: isPso
        ? `PSO ${c.call_number} on-scene >25 min`
        : `Call ${c.call_number} on-scene >3 h`,
      details: isPso
        ? `Process-server visit ${c.call_number} has been on-scene over 25 minutes — log the attempt and roll to the next stop.`
        : `Unit has been on-scene for call ${c.call_number} over 3 hours without clearing — confirm officer status.`,
      zone_beat: c.beat_id != null ? String(c.beat_id) : null,
    });
  }

  // Rule 3 — Priority auto-reassessment: escalate aging calls
  let escalated = 0;
  // Only escalate calls that haven't been escalated in the last 2 hours.
  // Without this guard a long-running P3 call would be re-escalated to P2 on
  // every cron tick after 60 min, and a re-lowered priority would immediately
  // bounce back up on the next run.
  const agingCalls = await query<{ id: number; call_number: string; priority: string; created_at: string }>(
    db,
    `SELECT id, call_number, priority, created_at FROM calls_for_service
      WHERE status IN ('pending', 'dispatched')
        AND priority IN ('P2', 'P3')
        AND created_at <= datetime('now', CASE WHEN priority = 'P2' THEN '-30 minutes' ELSE '-60 minutes' END)
        AND (updated_at IS NULL OR updated_at <= datetime('now', '-2 hours'))
      LIMIT 50`,
  );
  for (const call of agingCalls) {
    const newPriority = call.priority === 'P2' ? 'P1' : 'P2';
    await execute(db,
      `UPDATE calls_for_service SET priority = ?, updated_at = datetime('now') WHERE id = ? AND priority = ?`,
      newPriority, call.id, call.priority);
    candidates.push({
      dedup_key: `priority_escalated:${call.id}`,
      alert_type: 'priority_escalated',
      severity: 'high',
      title: `${call.call_number} escalated to ${newPriority}`,
      details: `Call ${call.call_number} auto-escalated from ${call.priority} to ${newPriority} after aging past SLA.`,
      zone_beat: null,
    });
    escalated++;
  }

  // Rule 4 — BOLO auto-expiry
  const expiredBolos = await query<{ id: number; bolo_number: string }>(
    db,
    `SELECT id, bolo_number FROM bolos
      WHERE status = 'active' AND expires_at <= datetime('now')
      LIMIT 50`,
  );
  for (const b of expiredBolos) {
    // bolos has no updated_at; expired_at is the column that records this.
    await execute(db, `UPDATE bolos SET status = 'expired', expired_at = datetime('now') WHERE id = ?`, b.id);
    candidates.push({
      dedup_key: `bolo_expired:${b.id}`,
      alert_type: 'bolo_expired',
      severity: 'low',
      title: `BOLO ${b.bolo_number} expired`,
      details: `BOLO ${b.bolo_number} has passed its expiration date and was auto-set to expired.`,
      zone_beat: null,
    });
  }

  // Rule 5 — Repeat address alert escalation (5+ calls in 30 days)
  const hotAddresses = await query<{ location_address: string; call_count: number }>(
    db,
    `SELECT location_address, COUNT(*) AS call_count FROM calls_for_service
      WHERE created_at >= datetime('now', '-30 days')
        AND location_address IS NOT NULL AND location_address != ''
      GROUP BY location_address
      HAVING COUNT(*) >= 5
      ORDER BY call_count DESC
      LIMIT 20`,
  );
  for (const addr of hotAddresses) {
    const existing = await queryFirst<{ id: number }>(
      db, "SELECT id FROM premise_alerts WHERE address = ? AND alert_type = 'hotspot' AND active = 1", addr.location_address,
    ).catch(() => null);
    if (!existing) {
      await execute(db,
        `INSERT INTO premise_alerts (address, alert_type, alert_level, title, description, active, flags, created_at)
         VALUES (?, 'hotspot', 'warning', ?, ?, 1, '["repeat_address"]', datetime('now'))`,
        addr.location_address,
        `High-call address: ${addr.location_address}`,
        `This address has generated ${addr.call_count} calls in the last 30 days. Automatic hotspot flag.`,
      );
      candidates.push({
        dedup_key: `hotspot:${addr.location_address}`,
        alert_type: 'repeat_address_hotspot',
        severity: 'medium',
        title: `Hotspot address flagged`,
        details: `${addr.location_address} — ${addr.call_count} calls in 30 days. Premise alert auto-created.`,
        zone_beat: null,
      });
    }
  }

  for (const a of candidates) await upsertActiveAlert(db, a);

  // Auto-resolve alerts whose condition no longer holds
  const liveKeys = new Set(candidates.map((a) => a.dedup_key));
  const active = await query<{ id: number; dedup_key: string }>(
    db,
    `SELECT id, dedup_key FROM anomaly_alerts
      WHERE acknowledged_at IS NULL
        AND alert_type IN ('unassigned_call', 'overdue_onscene', 'priority_escalated', 'repeat_address_hotspot', 'bolo_expired')`,
  );
  let resolved = 0;
  for (const row of active) {
    if (!liveKeys.has(row.dedup_key)) {
      await execute(db,
        "UPDATE anomaly_alerts SET acknowledged_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        row.id);
      resolved++;
    }
  }

  return { raised: candidates.length, resolved };
}
