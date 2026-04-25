// ============================================================
// RMPG Flex — Critical Alert Escalation & Stack Reminder
// ============================================================
// Spillman-style behavior: critical alerts that go unacknowledged
// keep nagging the dispatcher. Implementation has two parts:
//
//  1. Per-alert repeat — when a critical alert (panic, gps_lost,
//     pursuit_speed) fires, it's tracked in a Map. Every 30s the
//     scheduler re-fires the original tone (no voice — too noisy
//     to repeat verbally) until the dispatcher acknowledges it.
//
//  2. Stack reminder — every 60s if 2+ critical alerts remain
//     unacknowledged, emit a soft `stack_pip` background nag.
//     Quiet enough not to mask voice traffic, present enough to
//     remind the operator something needs eyes on it.
//
// Acknowledgment is currently driven by:
//   • Explicit `acknowledgeAlert(key)` call from a UI button
//   • A 5-minute hard ceiling (we never nag forever — at some
//     point the dispatcher has clearly chosen to ignore it).
//
// All escalation respects the per-category mute prefs and the
// global `rmpg-sound` toggle. Muting an alert category also
// suppresses its repeat behavior.
// ============================================================

import { playToneAsync, type ToneType } from './dispatchTones';
import { isAlertSoundEnabled, type AlertCategory } from './alertSoundPrefs';

interface PendingAlert {
  key: string;             // unique per event (e.g. "gps:gap:critical:S19")
  tone: ToneType;          // tone to repeat
  category: AlertCategory; // for mute lookup
  firstFiredAt: number;    // ms epoch
  lastRepeatAt: number;    // ms epoch
  repeatCount: number;
}

const REPEAT_INTERVAL_MS = 30_000;   // 30s between re-fires
const HARD_CEILING_MS = 5 * 60_000;  // 5 min — auto-clear after this
const STACK_REMINDER_INTERVAL_MS = 60_000;
const STACK_THRESHOLD = 2;           // 2+ unack'd alerts triggers stack pip

const pending = new Map<string, PendingAlert>();
let lastStackPipAt = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Register a critical alert for escalation. Idempotent — re-registering
 * the same key just refreshes the existing entry's lastRepeatAt so we
 * don't double-fire when a single event broadcasts multiple times.
 */
export function trackCriticalAlert(key: string, tone: ToneType, category: AlertCategory): void {
  const existing = pending.get(key);
  const now = Date.now();
  if (existing) {
    existing.lastRepeatAt = now;
    return;
  }
  pending.set(key, {
    key, tone, category,
    firstFiredAt: now,
    lastRepeatAt: now,
    repeatCount: 0,
  });
  ensureSchedulerRunning();
}

/**
 * Acknowledge an alert — stops it from repeating. Called from UI
 * "ACK" buttons. Returns true if the alert was actually pending.
 */
export function acknowledgeAlert(key: string): boolean {
  return pending.delete(key);
}

/** Clear all pending alerts (e.g. on logout / shift change). */
export function acknowledgeAllAlerts(): void {
  pending.clear();
}

/** How many alerts are currently unacknowledged. */
export function pendingAlertCount(): number {
  return pending.size;
}

/** Snapshot of pending alerts for UI display. */
export function listPendingAlerts(): Array<{ key: string; firstFiredAt: number; repeatCount: number; category: AlertCategory }> {
  return Array.from(pending.values()).map(a => ({
    key: a.key,
    firstFiredAt: a.firstFiredAt,
    repeatCount: a.repeatCount,
    category: a.category,
  }));
}

function ensureSchedulerRunning(): void {
  if (timer) return;
  // Tick every 5s — fine resolution for the 30s/60s decisions while
  // staying cheap. Stops itself when the pending map empties.
  timer = setInterval(tick, 5_000);
}

function tick(): void {
  const now = Date.now();

  // Per-alert repeat + hard-ceiling cleanup.
  for (const a of Array.from(pending.values())) {
    // Hard ceiling — give up after 5 min of no acknowledgment.
    if (now - a.firstFiredAt >= HARD_CEILING_MS) {
      pending.delete(a.key);
      continue;
    }
    if (now - a.lastRepeatAt >= REPEAT_INTERVAL_MS) {
      // Skip re-fire if the category was muted between events.
      if (isAlertSoundEnabled(a.category)) {
        // Best-effort; tone may fail if AudioContext is closed.
        playToneAsync(a.tone).catch(() => { /* ignore */ });
      }
      a.lastRepeatAt = now;
      a.repeatCount += 1;
    }
  }

  // Stack reminder pip — only if 2+ alerts pending and 60s elapsed
  // since last pip. Decoupled from per-alert repeat cadence so the
  // two don't beat against each other.
  if (pending.size >= STACK_THRESHOLD && now - lastStackPipAt >= STACK_REMINDER_INTERVAL_MS) {
    if (isAlertSoundEnabled('panic') || pending.size >= 3) {
      // Stack pip honors the panic-category mute (most likely critical
      // alert in stack), unless we've got 3+ which warrants the nag
      // regardless. Logic intentionally biased toward audible.
      playToneAsync('stack_pip').catch(() => { /* ignore */ });
    }
    lastStackPipAt = now;
  }

  // Stop the scheduler when the queue empties — saves a wake every
  // 5s for the 99% of session time when nothing is pending.
  if (pending.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Build a stable dedup key for an alert event. */
export function alertKey(eventType: string, severity: string | undefined, unit: string | undefined): string {
  return `${eventType}:${severity || 'na'}:${unit || 'na'}`;
}
