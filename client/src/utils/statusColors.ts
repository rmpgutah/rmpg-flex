// ============================================================
// RMPG Flex — Consolidated Status Color Tokens
// ============================================================
// Single source of truth for all status-related colors.
// Provides both Tailwind class strings (for badges/UI) and
// hex values (for maps, inline styles, canvas).
// ============================================================

import type { UnitStatus, CallStatus, CallPriority, IncidentStatus } from '../types';

// ── Unit Status ─────────────────────────────────────────────

export const UNIT_STATUS_HEX: Record<UnitStatus, string> = {
  available: '#22c55e',
  dispatched: '#f59e0b',
  enroute: '#888888',
  onscene: '#a855f7',
  busy: '#ef4444',
  off_duty: '#6b7280',
  out_of_service: '#991b1b',
};

export const UNIT_STATUS_CLASSES: Record<UnitStatus, string> = {
  available: 'bg-green-900/50 text-green-400 border border-green-700/50',
  dispatched: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  enroute: 'bg-brand-900/50 text-brand-400 border border-brand-700/50',
  onscene: 'bg-purple-900/50 text-purple-400 border border-purple-700/50',
  busy: 'bg-red-900/50 text-red-400 border border-red-700/50',
  off_duty: 'bg-rmpg-700/50 text-rmpg-400 border border-rmpg-600/50',
  out_of_service: 'bg-red-950/50 text-red-300 border border-red-800/50',
};

export const UNIT_STATUS_LABELS: Record<UnitStatus, string> = {
  available: 'Available',
  dispatched: 'Dispatched',
  enroute: 'En Route',
  onscene: 'On Scene',
  busy: 'Busy',
  off_duty: 'Off Duty',
  out_of_service: 'Out of Service',
};

export const UNIT_STATUS_ABBREV: Record<UnitStatus, string> = {
  available: 'AVL',
  dispatched: 'DSP',
  enroute: 'ENR',
  onscene: 'ONS',
  busy: 'BSY',
  off_duty: 'OFD',
  out_of_service: 'OOS',
};

// ── Call Priority ───────────────────────────────────────────

// Priority palette is an ORDINAL heat ramp (urgent→routine), generated in OKLCH
// against the map's FIXED navy land (#22405f) — see
// docs/superpowers/specs/2026-07-25-reports-chart-palette-design.md.
// Every step clears 3:1 on that land; the previous values did not (P1 measured
// 2.21, P4 2.01). P3/P4 stay WARM rather than reusing the unit-status grays
// (#888888 enroute / off_duty) — a gray dot was ambiguous between a
// low-priority call and an en-route/off-duty unit.
// MUST stay raw 6-digit hex: mapMarkers.ts builds `${color}22` / `99` / `b3`,
// and `var(--x)22` is invalid CSS that fails silently.
// The themed equivalent for charts is --chart-pri-* in theme-palettes.css.
export const PRIORITY_HEX: Record<string, string> = {
  P1: '#ffbeb2',
  P2: '#fc9c6e',
  P3: '#c29673',
  P4: '#968778',
};

/** Ink for any badge filled with a PRIORITY_HEX color (map markers, mini-map
 *  priority badges, etc). The fills are light (they must clear 3:1 against the
 *  navy map land), so the label/border needs dark ink: with white ink the fill
 *  would need luminance <= 0.183 for 4.5:1 text AND >= 0.245 for 3:1 vs land,
 *  which is unsatisfiable. Measured >= 5.27:1 on every PRIORITY_HEX step. */
export const CALL_MARKER_INK = '#0d1520';

/** Look up a priority color tolerantly. `calls_for_service.priority` is DB-
 *  constrained to 'P1'..'P4' (migrations/0001_initial.sql) and the dispatch
 *  queue route passes it through verbatim, so live values are that shape and
 *  a plain 'P1'-keyed lookup does hit. But call sites in this tree disagree
 *  about the shape regardless — the map test fixture uses a bare '1', and
 *  useAutoPanToP1.ts compares against '1' too — so this helper accepts both
 *  rather than trusting either. Unknown input returns the most recessive step. */
export function priorityHex(priority: string | number | null | undefined): string {
  const n = Number(String(priority ?? '').trim().replace(/^p/i, ''));
  return Number.isInteger(n) && n >= 1 && n <= 4 ? PRIORITY_HEX[`P${n}`] : PRIORITY_HEX.P4;
}

/** Render a priority as a "P1".."P4" label, tolerating both live shapes.
 *
 *  Callers used to hand-build this as `` `P${call.priority}` ``, which is
 *  correct for the bare '1' the map test fixture uses and WRONG for the 'P1'
 *  that `calls_for_service.priority` actually stores — producing a call marker
 *  reading "PP1" on the live map. Shares priorityHex's normalization so the
 *  label and the fill can never disagree about the input shape again.
 *  Unrecognized input falls back to the most recessive step, matching
 *  priorityHex. */
export function priorityLabel(priority: string | number | null | undefined): string {
  const n = Number(String(priority ?? '').trim().replace(/^p/i, ''));
  return Number.isInteger(n) && n >= 1 && n <= 4 ? `P${n}` : 'P4';
}

export const PRIORITY_CLASSES: Record<CallPriority, string> = {
  P1: 'bg-red-900/50 text-red-400 border border-red-700/50',
  P2: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  P3: 'bg-brand-900/50 text-brand-400 border border-brand-700/50',
  P4: 'bg-rmpg-700/50 text-rmpg-300 border border-rmpg-600/50',
};

export const PRIORITY_LABELS: Record<CallPriority, string> = {
  P1: 'P1 - EMER',
  P2: 'P2 - URG',
  P3: 'P3 - RTN',
  P4: 'P4 - SCHED',
};

// ── Call Status ─────────────────────────────────────────────

export const CALL_STATUS_CLASSES: Record<CallStatus, string> = {
  pending: 'bg-yellow-900/50 text-yellow-300 border border-yellow-600/60',
  dispatched: 'bg-surface-sunken/50 text-rmpg-300 border border-rmpg-600/60',
  enroute: 'bg-surface-sunken/50 text-rmpg-300 border border-rmpg-600/60',
  onscene: 'bg-red-900/50 text-red-300 border border-red-600/60',
  cleared: 'bg-green-900/50 text-green-300 border border-green-600/60',
  closed: 'bg-rmpg-700/50 text-rmpg-400 border border-rmpg-600/50',
  cancelled: 'bg-rmpg-700/50 text-rmpg-400 border border-rmpg-600/50',
  archived: 'bg-slate-800/50 text-slate-500 border border-slate-700/50',
  on_hold: 'bg-amber-900/50 text-amber-300 border border-amber-600/60 animate-pulse',
};

export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  pending: 'Pending',
  dispatched: 'Dispatched',
  enroute: 'En Route',
  onscene: 'On Scene',
  cleared: 'Cleared',
  closed: 'Closed',
  cancelled: 'Cancelled',
  archived: 'Archived',
  on_hold: 'HELD',
};

// ── Incident Status ─────────────────────────────────────────

export const INCIDENT_STATUS_CLASSES: Record<IncidentStatus, string> = {
  draft: 'bg-rmpg-700/50 text-rmpg-300 border border-rmpg-600/50',
  submitted: 'bg-brand-900/50 text-brand-400 border border-brand-700/50',
  under_review: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  approved: 'bg-green-900/50 text-green-400 border border-green-700/50',
  returned: 'bg-red-900/50 text-red-400 border border-red-700/50',
};

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  returned: 'Returned',
};
