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
}

export const THRESHOLDS: ThresholdConfig = {
  pending: {
    P1: 60,     // 1 minute — emergency
    P2: 180,    // 3 minutes — urgent
    P3: 300,    // 5 minutes — routine
    P4: 600,    // 10 minutes — scheduled
  },
  dispatched: 180,  // 3 minutes
  onscene: 2700,    // 45 minutes
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
 *   normal:   < 60% of threshold
 *   warning:  60-90% of threshold
 *   critical: 90-100% of threshold
 *   overdue:  > 100% of threshold
 */
export function getTimerSeverity(elapsed: number, threshold: number): TimerSeverity {
  if (threshold === Infinity) return 'normal';
  const ratio = elapsed / threshold;
  if (ratio >= 1.0) return 'overdue';
  if (ratio >= 0.9) return 'critical';
  if (ratio >= 0.6) return 'warning';
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

export function getTimerState(call: CallForService): TimerState {
  const status = call.status;
  const label = STATUS_LABELS[status] || status.toUpperCase().slice(0, 4);
  const elapsed = getStatusElapsed(call);
  const threshold = getThreshold(call);
  const severity = getTimerSeverity(elapsed, threshold);

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
