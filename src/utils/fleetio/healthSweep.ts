// ============================================================
// Fleet.io Health Sweep
// ============================================================
// Runs once per */30 cron tick (src/index.ts), alongside applyOutbound.
// Same "proactively notify instead of dashboard-nobody-checks" pattern as
// certExpirationSweep.ts / fleetMaintenanceSweep.ts — see
// docs/superpowers/specs/2026-07-23-fleetio-reliability-observability-design.md.
//
// Two independent jobs:
//   1. Dead-letter notify: any outbound event with status='failed' (all
//      maxAttempts() retries exhausted) that hasn't yet fired its
//      one-time fleetio_event_dead_lettered notification (tracked via
//      the dead_letter_notified_at column, migration 0202) gets notified
//      exactly once, then marked so it's never re-notified.
//   2. Stuck-queue notify: if the queue is unhealthy (see
//      isFleetioQueueUnhealthy in sync.ts) and the last queue-unhealthy
//      alert was more than 2h ago (or never fired), fires
//      fleetio_queue_unhealthy once and records the new alert timestamp
//      in fleetio_sync_state (a generic key/value table, migration 0133).
// Both route through evaluateNotificationRules — the two seeded default
// rules live in migrations/0203_fleetio_health_alert_rules.sql.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst, execute } from '../db';
import { evaluateNotificationRules } from '../../routes/notificationEngine';
import { getQueueHealth, isFleetioQueueUnhealthy, shouldFireUnhealthyAlert } from './sync';

interface DeadLetterCandidate {
  id: number;
  direction: string;
  event_id: string;
  resource: string;
  action: string;
  error: string | null;
}

const UNHEALTHY_ALERT_STATE_KEY = 'fleetio_unhealthy_alert_at';
const DEAD_LETTER_SWEEP_LIMIT = 50;

export interface FleetioHealthSweepResult {
  deadLetterNotified: number;
  queueUnhealthy: boolean;
  queueAlertFired: boolean;
  failedTotal: number;
}

export async function sweepFleetioHealth(
  db: D1Database,
  env?: { ALERT_HUB?: DurableObjectNamespace },
  now?: () => Date,
): Promise<FleetioHealthSweepResult> {
  const nowDate = now ? now() : new Date();
  const nowMs = nowDate.getTime();

  // ── 1. Dead-letter notify (once per event) ──
  // Both directions. This was `direction = 'outbound'` only, which was correct
  // while inbound events could never reach 'failed' — applyInbound returned
  // early on an apply error and left the row 'pending' forever. Now that it
  // records failures (markInboundFailure), an exhausted INBOUND event is a real
  // dead letter and means remote changes are being dropped on the floor; it
  // needs the same one-time notification an outbound one gets.
  const candidates = await query<DeadLetterCandidate>(
    db,
    `SELECT id, direction, event_id, resource, action, error
     FROM fleetio_events
     WHERE status = 'failed' AND dead_letter_notified_at IS NULL
     ORDER BY id ASC
     LIMIT ?`,
    DEAD_LETTER_SWEEP_LIMIT,
  );
  let deadLetterNotified = 0;
  for (const ev of candidates) {
    await evaluateNotificationRules(db, 'fleetio_event_dead_lettered', {
      title: 'Fleet.io sync: event permanently failed',
      message: `${ev.direction} ${ev.resource}/${ev.action} (event ${ev.event_id}) failed after exhausting all retry attempts: ${ev.error ?? '(no error message)'}`,
      priority: 'high',
      entity_type: 'fleetio_event',
      entity_id: ev.id,
    }, env);
    await execute(db, `UPDATE fleetio_events SET dead_letter_notified_at = datetime('now') WHERE id = ?`, ev.id);
    deadLetterNotified++;
  }

  // ── 2. Stuck-queue notify (cooldown-gated) ──
  const health = await getQueueHealth(db);
  const queueUnhealthy = isFleetioQueueUnhealthy(health, nowMs);
  let queueAlertFired = false;
  if (queueUnhealthy) {
    const lastAlertRow = await queryFirst<{ value: string }>(
      db, `SELECT value FROM fleetio_sync_state WHERE key = ?`, UNHEALTHY_ALERT_STATE_KEY,
    );
    if (shouldFireUnhealthyAlert(lastAlertRow?.value ?? null, nowMs)) {
      await evaluateNotificationRules(db, 'fleetio_queue_unhealthy', {
        title: 'Fleet.io sync queue unhealthy',
        message: `${health.failedTotal} failed event(s)${health.oldestPendingCreatedAt ? `; oldest pending event queued since ${health.oldestPendingCreatedAt}` : ''}.`,
        priority: 'high',
        entity_type: 'fleetio_queue',
      }, env);
      await execute(
        db,
        `INSERT INTO fleetio_sync_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        UNHEALTHY_ALERT_STATE_KEY, nowDate.toISOString(),
      );
      queueAlertFired = true;
    }
  }

  return { deadLetterNotified, queueUnhealthy, queueAlertFired, failedTotal: health.failedTotal };
}
