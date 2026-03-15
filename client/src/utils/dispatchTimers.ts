// ============================================================
// RMPG Flex — Dispatch Timer Utilities
// Status-aware elapsed time tracking with configurable
// thresholds for dispatch alarm management. Mirrors Spillman
// Flex timer bars that show time-in-status for every active call.
// ============================================================

import type { CallForService, CallPriority, CallStatus } from '../types';

// ── Status Labels (short codes for timer display) ──────────

export const STATUS_LABELS: Partial<Record<CallStatus, string>> = {
  pending:    'PEND',
  dispatched: 'DISP',
  enroute:    'ENR',
  onscene:    'ONS',
  cleared:    'CLR',
  on_hold:    'HELD',
};

// ── Threshold Configuration (seconds) ──────────────────────
// How long a call can remain in a status before triggering an alarm.

interface ThresholdConfig {
  pending: Record<CallPriority, number>;
  dispatched: number;   // unit dispatched but not enroute
  onscene: number;      // unit onscene too long
  absoluteOverdue: number; // hard 72-hour wall — any active call exceeding this is overdue
}

export const THRESHOLDS: ThresholdConfig = {
  pending: {
    P1: 60,     // 1 minute — emergency
    P2: 14400,  // 4 hours — urgent / PSO Priority One requests
    P3: 300,    // 5 minutes — routine
    P4: 86400,  // 24 hours — scheduled / PSO (warning 8h, critical 16h, overdue 24h)
  },
  dispatched: 180,  // 3 minutes
  onscene: 2700,    // 45 minutes
  absoluteOverdue: 259200, // 72 hours — hard overdue threshold for ANY active call
};

// ── Timer Severity Levels ──────────────────────────────────

export type TimerSeverity = 'normal' | 'warning' | 'critical' | 'overdue';

/**
 * Get seconds elapsed in the call's CURRENT status.
 * Uses the most relevant timestamp for the current status.
 */
export function getStatusElapsed(call: CallForService): number {
  const now = Date.now();
  let refTime: string;

  // On-hold calls: timer freezes — return 0 elapsed
  if (call.status === 'on_hold') return 0;

  switch (call.status) {
    case 'pending':
      refTime = call.created_at;
      break;
    case 'dispatched':
      refTime = call.dispatched_at || call.created_at;
      break;
    case 'enroute':
      refTime = call.enroute_at || call.dispatched_at || call.created_at;
      break;
    case 'onscene':
      refTime = call.onscene_at || call.enroute_at || call.created_at;
      break;
    case 'cleared':
      refTime = call.cleared_at || call.onscene_at || call.created_at;
      break;
    default:
      refTime = call.created_at;
  }

  if (!refTime) return 0;
  const elapsed = Math.floor((now - new Date(refTime).getTime()) / 1000);
  return Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
}

/**
 * Get the threshold (in seconds) for the call's current status + priority.
 * Returns Infinity for statuses that don't have thresholds (enroute, cleared, closed).
 */
export function getThreshold(call: CallForService): number {
  switch (call.status) {
    case 'pending':
      return THRESHOLDS.pending[call.priority as CallPriority] || THRESHOLDS.pending.P3;
    case 'dispatched':
      return THRESHOLDS.dispatched;
    case 'onscene':
      return THRESHOLDS.onscene;
    case 'on_hold':
      return Infinity; // no alarm while held
    default:
      return Infinity;
  }
}

/**
 * Determine the severity level based on elapsed time vs threshold.
 *   normal:   < 1/3 of threshold
 *   warning:  1/3 – 2/3 of threshold  (P4: 24h yellow)
 *   critical: 2/3 – 100% of threshold (P4: 48h red)
 *   overdue:  > 100% of threshold     (P4: 72h+ overdue)
 */
export function getTimerSeverity(elapsed: number, threshold: number): TimerSeverity {
  if (threshold === Infinity) return 'normal';
  const ratio = elapsed / threshold;
  if (ratio >= 1.0) return 'overdue';
  if (ratio >= 2 / 3) return 'critical';
  if (ratio >= 1 / 3) return 'warning';
  return 'normal';
}

/**
 * Format seconds into M:SS display string.
 * For times > 1 hour, shows H:MM:SS.
 */
export function formatTimer(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';

  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Get the progress ratio (0-1) for the timer bar.
 * Capped at 1.0 visually but tracks overdue state.
 */
export function getTimerProgress(elapsed: number, threshold: number): number {
  if (threshold === Infinity || threshold <= 0) return 0;
  return Math.min(elapsed / threshold, 1.0);
}

/**
 * Get the color for a timer severity level.
 */
export function getTimerColor(severity: TimerSeverity): string {
  switch (severity) {
    case 'normal':   return '#4ade80'; // green
    case 'warning':  return '#f59e0b'; // amber
    case 'critical': return '#ef4444'; // red
    case 'overdue':  return '#ef4444'; // red (with pulsing in CSS)
  }
}

/**
 * Check if a call is in an active (timer-worthy) status.
 */
export function isActiveStatus(status: CallStatus): boolean {
  return ['pending', 'dispatched', 'enroute', 'onscene', 'on_hold'].includes(status);
}

/**
 * Full timer state for a call — used by CallCard and DispatchPage.
 */
export interface TimerState {
  label: string;
  elapsed: number;
  formatted: string;
  threshold: number;
  progress: number;
  severity: TimerSeverity;
  color: string;
  isOverdue: boolean;
}

/**
 * Get the absolute elapsed time since call creation (for 72-hour overdue check).
 */
export function getCallAge(call: CallForService): number {
  if (!call.created_at) return 0;
  const elapsed = Math.floor((Date.now() - new Date(call.created_at).getTime()) / 1000);
  return Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
}

export function getTimerState(call: CallForService): TimerState {
  const status = call.status;
  const label = STATUS_LABELS[status] || status.toUpperCase().slice(0, 4);
  const elapsed = getStatusElapsed(call);
  const threshold = getThreshold(call);
  let severity = getTimerSeverity(elapsed, threshold);

  // ── 72-hour absolute overdue enforcement ──
  // Even if the per-status threshold is Infinity (e.g. enroute),
  // any active call open for 72+ hours is forced to overdue.
  if (isActiveStatus(call.status) && severity !== 'overdue') {
    const callAge = getCallAge(call);
    if (callAge >= THRESHOLDS.absoluteOverdue) {
      severity = 'overdue';
    } else if (callAge >= THRESHOLDS.absoluteOverdue * 2 / 3) {
      // 48+ hours → at least critical
      if (severity === 'normal' || severity === 'warning') severity = 'critical';
    }
  }

  return {
    label,
    elapsed,
    formatted: formatTimer(elapsed),
    threshold,
    progress: getTimerProgress(elapsed, threshold),
    severity,
    color: getTimerColor(severity),
    isOverdue: severity === 'overdue',
  };
}
