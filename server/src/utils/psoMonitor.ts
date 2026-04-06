/**
 * PSO Monitor — 72-Hour Re-Dispatch Enforcement
 *
 * Checks for PSO (Private Security Officer) calls that have been cleared/closed
 * but not yet re-dispatched. Sends notifications at:
 *   - 48 hours: warning to dispatchers (approaching deadline)
 *   - 72 hours: critical alert (overdue — must re-dispatch or close out)
 *
 * Uses a column `pso_72hr_notified_at` on calls_for_service to avoid duplicate
 * notifications. The monitor runs every 30 minutes.
 */
import { getDb } from '../models/database';
import { createNotificationForRoles } from '../routes/notifications';
import { broadcastDispatchUpdate } from './websocket';
import { localNow } from './timeUtils';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

const HOURS_48_MS = 48 * 60 * 60 * 1000;
const HOURS_72_MS = 72 * 60 * 60 * 1000;

/** Check all PSO calls for 72-hour re-dispatch compliance */
function checkPsoCalls(): void {
  try {
    const db = getDb();
    const now = Date.now();

    // Find PSO calls that are cleared/closed but NOT re-dispatched yet.
    // A re-dispatched call gets set back to 'pending', so these are only
    // calls still sitting in a terminal status.
    const psoCalls = db.prepare(`
      SELECT id, call_number, pso_attempt_number, status, location,
             cleared_at, closed_at, pso_72hr_notified, pso_requestor_name
      FROM calls_for_service
      WHERE incident_type = 'pso_client_request'
        AND status IN ('cleared', 'closed')
        AND (cleared_at IS NOT NULL OR closed_at IS NOT NULL)
    `).all() as any[];

    for (const call of psoCalls) {
      // Use the most recent terminal timestamp
      const terminalTime = call.closed_at || call.cleared_at;
      if (!terminalTime) continue;

      const terminalMs = new Date(terminalTime).getTime();
      if (isNaN(terminalMs)) continue;

      const elapsed = now - terminalMs;
      const notified = call.pso_72hr_notified || '';

      // 72-hour overdue — critical notification
      if (elapsed >= HOURS_72_MS && notified !== '72h') {
        const attempt = call.pso_attempt_number || 1;
        createNotificationForRoles(
          ['admin', 'manager', 'supervisor', 'dispatcher'],
          'dispatch',
          `PSO OVERDUE: ${call.call_number} — 72hr deadline passed`,
          `PSO call ${call.call_number} (Visit #${attempt}) at ${call.location || 'unknown location'} has been ${call.status} for over 72 hours without re-dispatch. ${call.pso_requestor_name ? `Requestor: ${call.pso_requestor_name}` : ''}`,
          'call',
          call.id,
          'critical',
          'pso_72hr_overdue',
        );

        db.prepare('UPDATE calls_for_service SET pso_72hr_notified = ? WHERE id = ?')
          .run('72h', call.id);

        // Broadcast so dispatch board updates the overdue indicator in real-time
        broadcastDispatchUpdate({
          action: 'pso_72hr_alert',
          callId: call.id,
          call_number: call.call_number,
          level: 'overdue',
        });

        console.log(`[PSO Monitor] 72hr OVERDUE alert — ${call.call_number}`);
      }
      // 48-hour warning
      else if (elapsed >= HOURS_48_MS && !notified) {
        const attempt = call.pso_attempt_number || 1;
        createNotificationForRoles(
          ['admin', 'manager', 'supervisor', 'dispatcher'],
          'dispatch',
          `PSO Warning: ${call.call_number} — 24hrs until deadline`,
          `PSO call ${call.call_number} (Visit #${attempt}) at ${call.location || 'unknown location'} has been ${call.status} for 48+ hours. Re-dispatch within 24 hours to meet the 72-hour requirement. ${call.pso_requestor_name ? `Requestor: ${call.pso_requestor_name}` : ''}`,
          'call',
          call.id,
          'high',
          'pso_48hr_warning',
        );

        db.prepare('UPDATE calls_for_service SET pso_72hr_notified = ? WHERE id = ?')
          .run('48h', call.id);

        console.log(`[PSO Monitor] 48hr warning — ${call.call_number}`);
      }
    }
  } catch (err: any) {
    console.error('[PSO Monitor] Check failed:', err.message);
  }
}

/** Start the PSO 72-hour monitor (runs every 30 minutes) */
export function startPsoMonitor(intervalMs: number = 30 * 60 * 1000): void {
  if (intervalHandle) return;
  console.log(`[PSO Monitor] Starting 72-hour re-dispatch monitor — every ${intervalMs / 60_000}min`);
  // Run an initial check after 2 minutes (let DB init finish)
  setTimeout(checkPsoCalls, 2 * 60 * 1000);
  intervalHandle = setInterval(checkPsoCalls, intervalMs);
  intervalHandle.unref();
}

/** Stop the PSO monitor */
export function stopPsoMonitor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[PSO Monitor] Stopped');
  }
}
