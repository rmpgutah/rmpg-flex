/**
 * Call Aging Monitor — 72-Hour Overdue Enforcement
 *
 * Server-side background monitor that checks for dispatch calls still in
 * active status (pending, dispatched, enroute, onscene, on_hold) for
 * longer than configured thresholds. Sends progressive notifications:
 *
 *   - 48 hours:  warning  → dispatchers + supervisors
 *   - 72 hours:  overdue  → dispatchers + supervisors + admin
 *
 * PSO calls are excluded — they have their own 72-hour re-dispatch monitor
 * in psoMonitor.ts which enforces a different rule (re-dispatch after clearing).
 *
 * Uses `calls_for_service.overdue_notified` column to avoid duplicate alerts:
 *   NULL  → no notification sent yet
 *   '48h' → 48-hour warning sent
 *   '72h' → 72-hour overdue alert sent
 *
 * When a call's status transitions (e.g. cleared, closed), the column resets
 * naturally because the call drops out of the active-status query.
 */
import { getDb } from '../models/database';
import { createNotificationForRoles } from '../routes/notifications';
import { broadcastDispatchUpdate } from './websocket';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

const HOURS_48_MS = 48 * 60 * 60 * 1000;
const HOURS_72_MS = 72 * 60 * 60 * 1000;

/** Human-readable status labels */
const STATUS_LABEL: Record<string, string> = {
  pending: 'pending',
  dispatched: 'dispatched',
  enroute: 'en route',
  onscene: 'on scene',
  on_hold: 'on hold',
};

/**
 * Scan all active calls and send overdue notifications as needed.
 */
function checkAgingCalls(): void {
  try {
    const db = getDb();
    const now = Date.now();

    // Find calls in active statuses that have been open for a while.
    // Exclude PSO calls (handled by psoMonitor) and cancelled/archived calls.
    const activeCalls = db.prepare(`
      SELECT id, call_number, incident_type, priority, status,
             location_address, created_at, overdue_notified,
             responding_officer
      FROM calls_for_service
      WHERE status IN ('pending', 'dispatched', 'enroute', 'onscene', 'on_hold')
        AND incident_type != 'pso_client_request'
        AND created_at IS NOT NULL
    `).all() as any[];

    let warnings = 0;
    let overdues = 0;

    for (const call of activeCalls) {
      const createdMs = new Date(call.created_at).getTime();
      if (isNaN(createdMs)) continue;

      const elapsed = now - createdMs;
      const notified = call.overdue_notified || '';
      const statusText = STATUS_LABEL[call.status] || call.status;
      const location = call.location_address || 'unknown location';

      // ── 72-hour overdue — critical notification ──
      if (elapsed >= HOURS_72_MS && notified !== '72h') {
        createNotificationForRoles(
          ['admin', 'manager', 'supervisor', 'dispatcher'],
          'dispatch',
          `OVERDUE: ${call.call_number} — 72+ hours ${statusText}`,
          `Call ${call.call_number} (${call.incident_type}) at ${location} has been ${statusText} for over 72 hours. ` +
          `Priority: ${call.priority}. ${call.responding_officer ? `Officer: ${call.responding_officer}` : 'No officer assigned.'} ` +
          `Review and clear or escalate immediately.`,
          'call',
          call.id,
          'critical',
          'call_72hr_overdue',
        );

        db.prepare('UPDATE calls_for_service SET overdue_notified = ? WHERE id = ?')
          .run('72h', call.id);

        broadcastDispatchUpdate({
          action: 'call_overdue',
          callId: call.id,
          call_number: call.call_number,
          level: 'overdue',
          hours: Math.floor(elapsed / (60 * 60 * 1000)),
        });

        overdues++;
        console.log(`[Call Aging] 72hr OVERDUE — ${call.call_number} (${statusText} since ${call.created_at})`);
      }
      // ── 48-hour warning ──
      else if (elapsed >= HOURS_48_MS && !notified) {
        createNotificationForRoles(
          ['admin', 'manager', 'supervisor', 'dispatcher'],
          'dispatch',
          `Aging Call: ${call.call_number} — 48+ hours ${statusText}`,
          `Call ${call.call_number} (${call.incident_type}) at ${location} has been ${statusText} for 48+ hours. ` +
          `Priority: ${call.priority}. Approaching 72-hour overdue threshold.`,
          'call',
          call.id,
          'high',
          'call_48hr_warning',
        );

        db.prepare('UPDATE calls_for_service SET overdue_notified = ? WHERE id = ?')
          .run('48h', call.id);

        warnings++;
        console.log(`[Call Aging] 48hr warning — ${call.call_number} (${statusText} since ${call.created_at})`);
      }
    }

    if (warnings > 0 || overdues > 0) {
      console.log(`[Call Aging] Scan complete: ${warnings} warning(s), ${overdues} overdue(s) out of ${activeCalls.length} active calls`);
    }
  } catch (err: any) {
    console.error('[Call Aging] Check failed:', err.message);
  }
}

/** Start the call aging monitor (runs every 30 minutes by default) */
export function startCallAgingMonitor(intervalMs: number = 30 * 60 * 1000): void {
  if (intervalHandle) return;
  console.log(`[Call Aging] Starting 72-hour overdue monitor — every ${intervalMs / 60_000}min`);
  // Initial check after 3 minutes (let DB init + PSO monitor run first)
  setTimeout(checkAgingCalls, 3 * 60 * 1000);
  intervalHandle = setInterval(checkAgingCalls, intervalMs);
  intervalHandle.unref();
}

/** Stop the call aging monitor */
export function stopCallAgingMonitor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[Call Aging] Stopped');
  }
}
