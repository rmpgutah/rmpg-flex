/**
 * Officer Welfare Monitor
 *
 * In-memory tracking of officers on high-priority calls.
 * Auto-triggers welfare checks if they go silent with a
 * 3-stage escalation protocol.
 */

import { broadcastDispatchUpdate, sendToUser } from './websocket';

// ─── Types ──────────────────────────────────────────────────

interface WelfareWatch {
  userId: number;
  callSign: string;
  callId: number;
  callNumber: string;
  startedAt: number;    // Date.now() timestamp
  lastActivity: number; // Date.now() timestamp
  priority: number;
  checksSent: number;   // 0 = none, 1 = prompt sent, 2 = supervisor notified, 3 = all-units
  escalated: boolean;
}

export interface WelfareAlert {
  type: 'prompt' | 'supervisor' | 'all_units';
  userId: number;
  callSign: string;
  callNumber: string;
  message: string;
}

// ─── Timing Constants ───────────────────────────────────────

const INITIAL_CHECK_MS  = 15 * 60 * 1000; // 15 min — first prompt
const FOLLOWUP_CHECK_MS =  2 * 60 * 1000; // 2 min after first — supervisor
const ESCALATION_MS     =  5 * 60 * 1000; // 5 min after first — all units

// ─── State ──────────────────────────────────────────────────

const watches: Map<number, WelfareWatch> = new Map();

// ─── Exports ────────────────────────────────────────────────

/**
 * Start monitoring an officer on a high-priority call.
 * Only monitors Priority 1 and Priority 2 calls.
 */
export function startWelfareWatch(
  userId: number,
  callSign: string,
  callId: number,
  callNumber: string,
  priority: number,
): void {
  // Only monitor P1 and P2 calls
  if (priority > 2) return;

  const now = Date.now();
  watches.set(userId, {
    userId,
    callSign,
    callId,
    callNumber,
    startedAt: now,
    lastActivity: now,
    priority,
    checksSent: 0,
    escalated: false,
  });
}

/**
 * Record officer activity — resets the welfare timer.
 * Should be called on every voice command, status update, or GPS ping.
 */
export function recordOfficerActivity(userId: number): void {
  const watch = watches.get(userId);
  if (watch) {
    watch.lastActivity = Date.now();
    // If activity received after a prompt but before escalation, reset checks
    if (watch.checksSent > 0 && !watch.escalated) {
      watch.checksSent = 0;
    }
  }
}

/**
 * Remove officer from welfare tracking (officer cleared scene).
 */
export function clearWelfareWatch(userId: number): void {
  watches.delete(userId);
}

/**
 * Check all welfare watches and return any triggered alerts.
 * Should be called every 30 seconds by a setInterval.
 *
 * Escalation stages:
 *  Stage 1: 15 min silent  -> prompt officer "Are you code 4?"
 *  Stage 2: +2 min         -> notify supervisor
 *  Stage 3: +5 min         -> all-units broadcast
 */
export function checkWelfareWatches(): WelfareAlert[] {
  const now = Date.now();
  const alerts: WelfareAlert[] = [];

  for (const [userId, watch] of watches) {
    const silentMs = now - watch.lastActivity;

    // Stage 3: All-units emergency (15 + 5 = 20 min silent)
    if (silentMs >= INITIAL_CHECK_MS + ESCALATION_MS && watch.checksSent < 3) {
      watch.checksSent = 3;
      watch.escalated = true;

      const message = `WELFARE EMERGENCY: ${watch.callSign} has been unresponsive for ${Math.round(silentMs / 60000)} minutes on call ${watch.callNumber}. All units respond.`;

      alerts.push({
        type: 'all_units',
        userId,
        callSign: watch.callSign,
        callNumber: watch.callNumber,
        message,
      });

      broadcastDispatchUpdate({
        action: 'welfare_emergency',
        userId,
        callSign: watch.callSign,
        callId: watch.callId,
        callNumber: watch.callNumber,
        message,
        silentMinutes: Math.round(silentMs / 60000),
      });
    }
    // Stage 2: Supervisor notification (15 + 2 = 17 min silent)
    else if (silentMs >= INITIAL_CHECK_MS + FOLLOWUP_CHECK_MS && watch.checksSent < 2) {
      watch.checksSent = 2;

      const message = `WELFARE ALERT: ${watch.callSign} has not responded to welfare check on call ${watch.callNumber}. Supervisor notification sent.`;

      alerts.push({
        type: 'supervisor',
        userId,
        callSign: watch.callSign,
        callNumber: watch.callNumber,
        message,
      });

      broadcastDispatchUpdate({
        action: 'welfare_alert',
        userId,
        callSign: watch.callSign,
        callId: watch.callId,
        callNumber: watch.callNumber,
        message,
        silentMinutes: Math.round(silentMs / 60000),
      });
    }
    // Stage 1: Prompt officer (15 min silent)
    else if (silentMs >= INITIAL_CHECK_MS && watch.checksSent < 1) {
      watch.checksSent = 1;

      const message = `Welfare check: ${watch.callSign}, are you code 4 on call ${watch.callNumber}?`;

      alerts.push({
        type: 'prompt',
        userId,
        callSign: watch.callSign,
        callNumber: watch.callNumber,
        message,
      });

      // Send directly to the officer
      sendToUser(userId, 'welfare_check', {
        action: 'welfare_prompt',
        callSign: watch.callSign,
        callId: watch.callId,
        callNumber: watch.callNumber,
        message,
      });
    }
  }

  return alerts;
}

/**
 * Officer responded code 4 — resets welfare timer.
 * Returns a confirmation message string, or null if the user
 * has no active welfare watch.
 */
export function acknowledgeWelfareCheck(userId: number): string | null {
  const watch = watches.get(userId);
  if (!watch) return null;

  watch.lastActivity = Date.now();
  watch.checksSent = 0;
  watch.escalated = false;

  return `${watch.callSign} is code 4 on call ${watch.callNumber}. Welfare check cleared.`;
}

/**
 * Returns the number of officers currently being monitored.
 */
export function getActiveWatchCount(): number {
  return watches.size;
}
