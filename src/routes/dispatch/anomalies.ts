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
        ORDER BY created_at DESC
        LIMIT 200`,
      hours,
    );
    return c.json(rows);
  } catch (err) {
    // Table-missing or query error → empty list so the banner degrades
    // to "no alerts" rather than throwing.
    console.error('[dispatch] anomaly-alerts list error', err);
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
    console.error('[dispatch] anomaly acknowledge error', err);
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
//   - overdue_onscene : status onscene, onscene_at >3h ago (MEDIUM).

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
  const overdue = await query<{ id: number; call_number: string; beat_id: number | null }>(
    db,
    `SELECT c.id, c.call_number, c.beat_id
       FROM calls_for_service c
      WHERE c.status = 'onscene'
        AND c.onscene_at IS NOT NULL
        AND c.onscene_at <= datetime('now', '-3 hours')
      LIMIT 100`,
  );
  for (const c of overdue) {
    candidates.push({
      dedup_key: `overdue_onscene:${c.id}`,
      alert_type: 'overdue_onscene',
      severity: 'medium',
      title: `Call ${c.call_number} on-scene >3 h`,
      details: `Unit has been on-scene for call ${c.call_number} over 3 hours without clearing — confirm officer status.`,
      zone_beat: c.beat_id != null ? String(c.beat_id) : null,
    });
  }

  // Rule 3 — responding unit with a STALE GPS fix (GPS-fed officer safety).
  // A unit actively assigned to a call but whose last position is >10 min old
  // (or never reported) can't be located by dispatch — surface it so someone
  // confirms the officer. Ties live GPS freshness into the dispatch alert feed.
  const staleResponders = await query<{ id: number; call_sign: string; call_number: string | null; gps_updated_at: string | null; beat_id: number | null }>(
    db,
    `SELECT u.id, u.call_sign, c.call_number, u.gps_updated_at, c.beat_id
       FROM units u
       JOIN calls_for_service c ON c.id = u.current_call_id
      WHERE u.current_call_id IS NOT NULL
        AND u.status IN ('dispatched', 'enroute', 'en_route', 'onscene')
        AND (u.gps_updated_at IS NULL OR u.gps_updated_at <= datetime('now', '-10 minutes'))
      LIMIT 100`,
  );
  for (const u of staleResponders) {
    const lastFix = u.gps_updated_at ? `last fix ${u.gps_updated_at} UTC` : 'no GPS ever reported';
    candidates.push({
      dedup_key: `gps_stale_unit:${u.id}`,
      alert_type: 'gps_stale_unit',
      severity: 'high',
      title: `Unit ${u.call_sign} GPS stale while responding`,
      details: `Unit ${u.call_sign} is assigned to call ${u.call_number ?? '?'} but its GPS is stale (${lastFix}). Dispatch cannot confirm the unit's location — verify officer status.`,
      zone_beat: u.beat_id != null ? String(u.beat_id) : null,
    });
  }

  for (const a of candidates) await upsertActiveAlert(db, a);

  // Auto-resolve: acknowledge active alerts of these types whose
  // condition no longer holds (not in this run's candidate set).
  const liveKeys = new Set(candidates.map((a) => a.dedup_key));
  const active = await query<{ id: number; dedup_key: string }>(
    db,
    `SELECT id, dedup_key FROM anomaly_alerts
      WHERE acknowledged_at IS NULL
        AND alert_type IN ('unassigned_call', 'overdue_onscene', 'gps_stale_unit')`,
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
