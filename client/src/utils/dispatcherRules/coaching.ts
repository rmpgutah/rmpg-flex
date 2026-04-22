// ============================================================
// Dispatcher Brain — Coaching Rules (Phase 3)
//
// Proactive spoken guidance triggered off call_created /
// call_updated events (and, later in this phase, a 30s timer
// loop). These rules speak at 'high' severity so they preempt
// low-severity event chatter when an officer is about to walk
// into a DV / felony / MH scene.
//
// Cooldown is keyed on call_number so the same call updating
// three times in a minute does not re-speak the same warning.
// ============================================================

import type { DispatcherRule } from './types';

function pickCall(payload: any): any {
  if (!payload) return {};
  return payload.call ?? payload;
}

function callNumber(payload: any): string {
  return String(pickCall(payload).call_number ?? 'global');
}

function assignedCount(payload: any): number {
  const c = pickCall(payload);
  if (Array.isArray(c.assigned_units)) return c.assigned_units.length;
  if (typeof c.assigned_units === 'string') {
    try {
      const parsed = JSON.parse(c.assigned_units);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch { return 0; }
  }
  return 0;
}

// 5 and 10 minute cooldowns keyed on call_number so repeated edits
// of the same call don't re-trigger the same warning.
const FIVE_MIN = 5 * 60_000;
const TEN_MIN  = 10 * 60_000;

export const COACHING_RULES: DispatcherRule[] = [
  // ─── DV approach warning ─────────────────────────────────
  {
    id: 'dv-approach-warning',
    trigger: 'event',
    eventTypes: ['call_created', 'call_updated'],
    match: (ctx) => !!pickCall(ctx.event?.payload).domestic_violence,
    severity: 'moderate',
    cooldownMs: FIVE_MIN,
    entityKey: (ctx) => callNumber(ctx.event?.payload),
    compose: () => 'Approach with caution — domestic, weapons history on location.',
  },

  // ─── Felony backup suggest ───────────────────────────────
  {
    id: 'felony-backup-suggest',
    trigger: 'event',
    eventTypes: ['call_created', 'call_updated'],
    match: (ctx) => {
      const p = ctx.event?.payload;
      return !!pickCall(p).felony_in_progress && assignedCount(p) < 2;
    },
    severity: 'moderate',
    cooldownMs: FIVE_MIN,
    entityKey: (ctx) => callNumber(ctx.event?.payload),
    compose: () => 'Felony in progress, recommend second unit.',
  },

  // ─── Mental health protocol ──────────────────────────────
  {
    id: 'mental-health-protocol',
    trigger: 'event',
    eventTypes: ['call_created', 'call_updated'],
    match: (ctx) => !!pickCall(ctx.event?.payload).mental_health_crisis,
    severity: 'moderate',
    cooldownMs: TEN_MIN,
    entityKey: (ctx) => callNumber(ctx.event?.payload),
    compose: () => 'Mental health crisis — CIT response preferred, non-lethal staging.',
  },

  // ─── Geofence breach (Phase 3 event) ─────────────────────
  // Fired when a unit's GPS position crosses out of its assigned beat.
  // Server-side emitter comes next in Task 3.3.
  {
    id: 'geofence-breach',
    trigger: 'event',
    eventTypes: ['unit_outside_beat'],
    match: (ctx) => !!ctx.event?.payload?.call_sign,
    severity: 'minor',
    cooldownMs: 3 * 60_000,
    entityKey: (ctx) => String(ctx.event?.payload?.call_sign ?? 'global'),
    compose: (ctx) => {
      const p = ctx.event!.payload;
      const beat = p.beat ?? 'unknown';
      return `${p.call_sign} is outside assigned beat ${beat}.`;
    },
  },

  // ─── Overdue status check (timer-driven) ─────────────────
  // Fires when this workstation's officer has been 'on scene' for
  // 8+ minutes without any outbound status update. Populated by
  // Task 3.2's timer loop via BrainContext.currentUserOnSceneAt.
  {
    id: 'overdue-status-check',
    trigger: 'timer',
    match: (ctx) => {
      if (!ctx.currentUserOnSceneAt || !ctx.currentUserCallSign) return false;
      const minsOnScene = (Date.now() - ctx.currentUserOnSceneAt) / 60_000;
      return minsOnScene >= 8;
    },
    severity: 'moderate',
    cooldownMs: FIVE_MIN,
    entityKey: (ctx) => ctx.currentUserCallSign ?? 'me',
    compose: (ctx) => {
      const mins = Math.floor((Date.now() - (ctx.currentUserOnSceneAt ?? Date.now())) / 60_000);
      return `${ctx.currentUserCallSign ?? 'Unit'}, status check, ${mins} minutes on scene.`;
    },
  },
];
