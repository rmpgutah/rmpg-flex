// ============================================================
// Dispatcher Brain — Safety Rules (Upgrades 81-90)
//
// Officer-safety spoken warnings triggered off call_created /
// call_updated events. Cooldown keyed on call_number so repeated
// edits of the same call don't re-trigger the same warning.
// ============================================================

import type { DispatcherRule } from './types';

function pickCall(payload: any): any {
  if (!payload) return {};
  return payload.call ?? payload;
}

function callNumber(payload: any): string {
  return String(pickCall(payload).call_number ?? 'global');
}

const FIVE_MIN = 5 * 60_000;
const TEN_MIN  = 10 * 60_000;

export const SAFETY_RULES: DispatcherRule[] = [
  // ─── 81: Weapons staging ─────────────────────────────────
  {
    id: 'weapons-staging',
    trigger: 'event',
    eventTypes: ['call_created', 'call_updated'],
    match: (ctx) => !!pickCall(ctx.event?.payload).weapons_involved,
    severity: 'major',
    cooldownMs: FIVE_MIN,
    entityKey: (ctx) => callNumber(ctx.event?.payload),
    compose: () => 'Weapons reported — stage and wait for backup.',
  },

  // ─── 82: Pursuit protocol ───────────────────────────────
  {
    id: 'pursuit-protocol',
    trigger: 'event',
    eventTypes: ['call_created', 'call_updated'],
    match: (ctx) => {
      const t = String(pickCall(ctx.event?.payload).incident_type ?? '').toLowerCase();
      return t.includes('pursuit');
    },
    severity: 'major',
    cooldownMs: FIVE_MIN,
    entityKey: (ctx) => callNumber(ctx.event?.payload),
    compose: () => 'Pursuit initiated — supervisor authorization required.',
  },

  // ─── 83: Hazmat standoff ────────────────────────────────
  {
    id: 'hazmat-standoff',
    trigger: 'event',
    eventTypes: ['call_created'],
    match: (ctx) => !!pickCall(ctx.event?.payload).hazmat,
    severity: 'major',
    cooldownMs: TEN_MIN,
    entityKey: (ctx) => callNumber(ctx.event?.payload),
    compose: () => 'Hazmat incident — establish perimeter, await HazMat team.',
  },

  // ─── 84: Juvenile protocol ──────────────────────────────
  {
    id: 'juvenile-protocol',
    trigger: 'event',
    eventTypes: ['call_created', 'call_updated'],
    match: (ctx) => !!pickCall(ctx.event?.payload).juvenile_involved,
    severity: 'moderate',
    cooldownMs: FIVE_MIN,
    entityKey: (ctx) => callNumber(ctx.event?.payload),
    compose: () => 'Juvenile involved — guardian contact required.',
  },

  // ─── 85: High-priority single unit ──────────────────────
  {
    id: 'high-priority-single-unit',
    trigger: 'event',
    eventTypes: ['call_created'],
    match: (ctx) => {
      const c = pickCall(ctx.event?.payload);
      if (c.priority !== 'P1') return false;
      let count = 0;
      if (Array.isArray(c.assigned_units)) {
        count = c.assigned_units.length;
      } else if (typeof c.assigned_units === 'string') {
        try { const p = JSON.parse(c.assigned_units); count = Array.isArray(p) ? p.length : 0; } catch { count = 0; }
      }
      return count < 2;
    },
    severity: 'major',
    cooldownMs: FIVE_MIN,
    entityKey: (ctx) => callNumber(ctx.event?.payload),
    compose: () => 'Priority one with single unit — assign backup immediately.',
  },

  // ─── 86: Traffic stop safety ────────────────────────────
  {
    id: 'traffic-stop-safety',
    trigger: 'event',
    eventTypes: ['call_created'],
    match: (ctx) => {
      const t = String(pickCall(ctx.event?.payload).incident_type ?? '').toLowerCase();
      return t === 'traffic_stop';
    },
    severity: 'moderate',
    cooldownMs: FIVE_MIN,
    entityKey: (ctx) => callNumber(ctx.event?.payload),
    compose: () => 'Traffic stop — approach driver side with caution.',
  },

  // ─── 87: Barricade perimeter ────────────────────────────
  {
    id: 'barricade-perimeter',
    trigger: 'event',
    eventTypes: ['call_created'],
    match: (ctx) => {
      const t = String(pickCall(ctx.event?.payload).incident_type ?? '').toLowerCase();
      return t.includes('barricade') || t.includes('hostage');
    },
    severity: 'major',
    cooldownMs: TEN_MIN,
    entityKey: (ctx) => callNumber(ctx.event?.payload),
    compose: () => 'Barricade situation — inner and outer perimeter, request negotiator.',
  },

  // ─── 88: Medical staging ────────────────────────────────
  {
    id: 'medical-staging',
    trigger: 'event',
    eventTypes: ['call_created'],
    match: (ctx) => {
      const c = pickCall(ctx.event?.payload);
      if (c.injuries_reported) return true;
      const t = String(c.incident_type ?? '').toLowerCase();
      return t === 'medical_emergency';
    },
    severity: 'moderate',
    cooldownMs: FIVE_MIN,
    entityKey: (ctx) => callNumber(ctx.event?.payload),
    compose: () => 'Medical staging required — confirm EMS en route.',
  },

  // ─── 89: Gang territory ────────────────────────────────
  {
    id: 'gang-territory',
    trigger: 'event',
    eventTypes: ['call_created', 'call_updated'],
    match: (ctx) => !!pickCall(ctx.event?.payload).gang_related,
    severity: 'major',
    cooldownMs: FIVE_MIN,
    entityKey: (ctx) => callNumber(ctx.event?.payload),
    compose: () => 'Gang activity — plain clothes advisory, no solo contact.',
  },

  // ─── 90: Repeat offender ───────────────────────────────
  {
    id: 'repeat-offender',
    trigger: 'event',
    eventTypes: ['call_updated'],
    match: (ctx) => !!pickCall(ctx.event?.payload).officer_safety_caution,
    severity: 'moderate',
    cooldownMs: TEN_MIN,
    entityKey: (ctx) => callNumber(ctx.event?.payload),
    compose: () => 'Officer safety flag — review premise history.',
  },
];
