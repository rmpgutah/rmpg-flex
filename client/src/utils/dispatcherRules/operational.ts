// ============================================================
// Dispatcher Brain — Operational Rules (Upgrades 91-95)
//
// Timer-driven rules that monitor system-wide operational state
// via BrainContext fields (activeCallCount, availableUnitCount,
// heldCalls, shiftEndTime, lastEventAt). These fire on the 30s
// timer loop, not on individual call events.
// ============================================================

import type { DispatcherRule } from './types';

const FIVE_MIN    = 5 * 60_000;
const TEN_MIN     = 10 * 60_000;
const FIFTEEN_MIN = 15 * 60_000;

export const OPERATIONAL_RULES: DispatcherRule[] = [
  // ─── 91: Shift end reminder ─────────────────────────────
  {
    id: 'shift-end-reminder',
    trigger: 'timer',
    match: (ctx) => {
      if (!ctx.shiftEndTime) return false;
      const end = new Date(ctx.shiftEndTime).getTime();
      if (isNaN(end)) return false;
      const minutesLeft = (end - Date.now()) / 60_000;
      return minutesLeft > 0 && minutesLeft <= 30;
    },
    severity: 'minor',
    cooldownMs: FIFTEEN_MIN,
    compose: () => 'Shift ending in 30 minutes — begin handoff.',
  },

  // ─── 92: Coverage gap ──────────────────────────────────
  {
    id: 'coverage-gap',
    trigger: 'timer',
    match: (ctx) => ctx.availableUnitCount === 0,
    severity: 'major',
    cooldownMs: FIVE_MIN,
    compose: () => 'No available units — all units assigned.',
  },

  // ─── 93: High call volume ──────────────────────────────
  {
    id: 'high-call-volume',
    trigger: 'timer',
    match: (ctx) => (ctx.activeCallCount ?? 0) > 10,
    severity: 'moderate',
    cooldownMs: TEN_MIN,
    compose: (ctx) => {
      const n = ctx.activeCallCount ?? 0;
      return `High call volume — ${n} active calls, consider mutual aid.`;
    },
  },

  // ─── 94: Long hold warning ─────────────────────────────
  {
    id: 'long-hold-warning',
    trigger: 'timer',
    match: (ctx) => {
      if (!ctx.heldCalls || ctx.heldCalls.length === 0) return false;
      const threshold = 15 * 60_000;
      return ctx.heldCalls.some((h) => Date.now() - h.held_since > threshold);
    },
    severity: 'moderate',
    cooldownMs: FIVE_MIN,
    entityKey: (ctx) => {
      const threshold = 15 * 60_000;
      const overdue = (ctx.heldCalls ?? []).find((h) => Date.now() - h.held_since > threshold);
      return overdue?.call_number ?? 'global';
    },
    compose: (ctx) => {
      const threshold = 15 * 60_000;
      const overdue = (ctx.heldCalls ?? []).find((h) => Date.now() - h.held_since > threshold);
      return `Call ${overdue?.call_number ?? 'unknown'} on hold exceeding 15 minutes.`;
    },
  },

  // ─── 95: Radio silence ─────────────────────────────────
  {
    id: 'radio-silence',
    trigger: 'timer',
    match: (ctx) => {
      if (ctx.lastEventAt == null) return false;
      return (Date.now() - ctx.lastEventAt) > 10 * 60_000;
    },
    severity: 'minor',
    cooldownMs: TEN_MIN,
    compose: (ctx) => {
      const mins = Math.floor((Date.now() - (ctx.lastEventAt ?? Date.now())) / 60_000);
      return `Radio check — no activity for ${mins} minutes.`;
    },
  },

  // ─── 96: Handoff reminder ──────────────────────────────
  {
    id: 'handoff-reminder',
    trigger: 'timer',
    match: (ctx) => {
      if (!ctx.shiftEndTime) return false;
      const end = new Date(ctx.shiftEndTime).getTime();
      if (isNaN(end)) return false;
      const minutesLeft = (end - Date.now()) / 60_000;
      return minutesLeft > 0 && minutesLeft <= 15;
    },
    severity: 'moderate',
    cooldownMs: FIFTEEN_MIN,
    compose: (ctx) => {
      const end = new Date(ctx.shiftEndTime!).getTime();
      const minutesLeft = Math.round((end - Date.now()) / 60_000);
      return `Shift ends in ${minutesLeft} minutes. Initiate handoff if not already started.`;
    },
  },

  // ─── 97: Mutual aid threshold ──────────────────────────
  {
    id: 'mutual-aid-threshold',
    trigger: 'timer',
    match: (ctx) => {
      const calls = ctx.activeCallCount ?? 0;
      const units = ctx.availableUnitCount ?? 0;
      const ratio = units > 0 ? calls / units : Infinity;
      return ratio >= 3 && calls >= 5;
    },
    severity: 'major',
    cooldownMs: TEN_MIN,
    compose: (ctx) => {
      const calls = ctx.activeCallCount ?? 0;
      const units = ctx.availableUnitCount ?? 0;
      return `Unit-to-call ratio critical: ${calls} active calls, only ${units} available units. Consider requesting mutual aid.`;
    },
  },

  // ─── 98: Narrative completeness ────────────────────────
  {
    id: 'narrative-completeness',
    trigger: 'event',
    eventTypes: ['call_updated'],
    match: (ctx) => {
      if (!ctx.event || ctx.event.type !== 'call_updated') return false;
      const data = ctx.event.payload;
      if (data?.status !== 'cleared') return false;
      const desc = data?.description;
      return !desc || desc.trim().length <= 20;
    },
    severity: 'minor',
    cooldownMs: FIVE_MIN,
    entityKey: (ctx) => ctx.event?.payload?.call_number ?? 'global',
    compose: (ctx) => {
      const callNum = ctx.event?.payload?.call_number ?? 'unknown';
      return `Call ${callNum} cleared without detailed narrative. Consider adding narrative for records.`;
    },
  },
];
