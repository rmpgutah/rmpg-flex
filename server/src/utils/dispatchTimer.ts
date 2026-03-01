// ============================================================
// RMPG Flex — Dispatch Response Timer
// Monitors active dispatch calls for response time compliance.
// Alerts dispatchers and supervisors when calls exceed threshold:
//   P1 (Emergency): 3 minutes without dispatch
//   P2 (Urgent):    5 minutes without dispatch
//   P3 (Routine):  15 minutes without dispatch
//   P4 (Low):      30 minutes without dispatch
// Also monitors on-scene time (officer hasn't arrived) and
// stale calls (dispatched but no status update for 30+ min).
// Broadcasts alerts via WebSocket to all dispatch clients.
// ============================================================

import { getDb } from '../models/database';
import { broadcastDispatchUpdate } from './websocket';
import { createNotification } from '../routes/notifications';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

// Maximum minutes before alerting, by priority
const DISPATCH_THRESHOLDS: Record<string, number> = {
  P1: 3,
  P2: 5,
  P3: 15,
  P4: 30,
};

// Maximum minutes for dispatched → enroute/onscene (officer response)
const ENROUTE_THRESHOLD = 15;

// Track which calls we've already alerted about (prevents spam)
const alertedCalls = new Map<string, number>(); // callId-alertType → timestamp

export function startDispatchTimer(intervalMs: number = 60 * 1000): void {
  if (intervalHandle) return;

  console.log(`[Dispatch Timer] Starting — checking every ${intervalMs / 1000}s`);

  intervalHandle = setInterval(() => {
    try {
      checkDispatchTimers();
    } catch (err) {
      console.error('[Dispatch Timer] Error:', err);
    }
  }, intervalMs);

  // Run once after 15s
  setTimeout(() => {
    try { checkDispatchTimers(); } catch (err) {
      console.error('[Dispatch Timer] Initial check error:', err);
    }
  }, 15_000);
}

export function stopDispatchTimer(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[Dispatch Timer] Stopped');
  }
}

function minutesAgo(dateStr: string): number {
  const then = new Date(dateStr.replace(' ', 'T'));
  return (Date.now() - then.getTime()) / 60000;
}

function shouldAlert(callId: number, alertType: string, cooldownMinutes: number = 5): boolean {
  const key = `${callId}-${alertType}`;
  const lastAlert = alertedCalls.get(key);
  if (lastAlert && (Date.now() - lastAlert) < cooldownMinutes * 60000) return false;
  alertedCalls.set(key, Date.now());
  return true;
}

function checkDispatchTimers(): void {
  const db = getDb();

  // ── 1. Pending calls without dispatch (no units assigned) ──
  try {
    const pendingCalls = db.prepare(`
      SELECT c.id, c.call_number, c.priority, c.incident_type, c.location_address,
             c.created_at, c.property_id
      FROM calls_for_service c
      WHERE c.status = 'pending'
        AND c.archived_at IS NULL
      ORDER BY c.priority ASC, c.created_at ASC
    `).all() as any[];

    for (const call of pendingCalls) {
      const age = minutesAgo(call.created_at);
      const threshold = DISPATCH_THRESHOLDS[call.priority] || 15;

      if (age >= threshold && shouldAlert(call.id, 'pending_overdue')) {
        const msg = `⏰ ${call.call_number} (${call.priority}) — PENDING ${Math.round(age)}min without dispatch: ${call.incident_type} at ${call.location_address || 'unknown'}`;
        console.log(`[Dispatch Timer] ${msg}`);

        broadcastDispatchUpdate({
          action: 'dispatch_alert',
          alert_type: 'pending_overdue',
          call_id: call.id,
          call_number: call.call_number,
          priority: call.priority,
          minutes_pending: Math.round(age),
          threshold_minutes: threshold,
          message: msg,
        });

        // Notify supervisors
        const supervisors = db.prepare(
          `SELECT id FROM users WHERE role IN ('admin', 'manager', 'supervisor') AND status = 'active'`
        ).all() as any[];
        for (const sup of supervisors) {
          try {
            createNotification(
              sup.id, 'dispatch', `Overdue: ${call.call_number}`,
              msg, 'call', call.id,
              call.priority === 'P1' ? 'critical' : 'high',
            );
          } catch { /* non-fatal */ }
        }
      }
    }
  } catch (err: any) {
    console.error('[Dispatch Timer] Pending check error:', err.message);
  }

  // ── 2. Dispatched calls with no enroute/onscene update ─────
  try {
    const dispatchedCalls = db.prepare(`
      SELECT c.id, c.call_number, c.priority, c.incident_type, c.location_address,
             c.dispatched_at
      FROM calls_for_service c
      WHERE c.status = 'dispatched'
        AND c.dispatched_at IS NOT NULL
        AND c.archived_at IS NULL
    `).all() as any[];

    for (const call of dispatchedCalls) {
      const sinceDept = minutesAgo(call.dispatched_at);

      if (sinceDept >= ENROUTE_THRESHOLD && shouldAlert(call.id, 'no_enroute', 10)) {
        const msg = `⚠ ${call.call_number} — Dispatched ${Math.round(sinceDept)}min ago, no en route/on scene update`;
        console.log(`[Dispatch Timer] ${msg}`);

        broadcastDispatchUpdate({
          action: 'dispatch_alert',
          alert_type: 'no_enroute',
          call_id: call.id,
          call_number: call.call_number,
          priority: call.priority,
          minutes_since_dispatch: Math.round(sinceDept),
          message: msg,
        });
      }
    }
  } catch (err: any) {
    console.error('[Dispatch Timer] Enroute check error:', err.message);
  }

  // Clean up old entries from alertedCalls (>1 hour old)
  const hourAgo = Date.now() - 3600000;
  for (const [key, ts] of alertedCalls) {
    if (ts < hourAgo) alertedCalls.delete(key);
  }
}
