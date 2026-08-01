// Time-correct attribution of a driving event to an officer.
//
// This exists because src/routes/drivingEvents.ts attributes via
// units.officer_id — the officer in the vehicle NOW. That is correct for a
// live console and wrong for any historical aggregate: it credits every past
// event to whoever happens to be driving today.
//
// Pure by design. No D1. See spec 2026-08-01-driver-performance-design.md.

export type AttributionSource = 'recorded' | 'inferred' | 'unattributed';

export interface AssignmentWindow {
  officerId: number;
  startMs: number;
  /** null means still open (extends to now). */
  endMs: number | null;
}

export interface AttributionResult {
  officerId: number | null;
  source: AttributionSource;
}

const UNATTRIBUTED: AttributionResult = { officerId: null, source: 'unattributed' };

/**
 * Resolution order: stamped -> assignment covering the timestamp -> unattributed.
 *
 * Windows are half-open [start, end): an event exactly at a window's end
 * belongs to the next assignment, so a handover instant cannot match twice.
 *
 * Ambiguity (two windows covering the same instant) resolves to unattributed
 * rather than picking one. Guessing here would attribute a driving event to a
 * named person on no evidence, which is the failure mode this whole feature
 * is built to avoid.
 */
export function resolveAttribution(
  stampedOfficerId: number | null,
  eventMs: number | null,
  windows: readonly AssignmentWindow[],
): AttributionResult {
  if (stampedOfficerId != null) {
    return { officerId: stampedOfficerId, source: 'recorded' };
  }
  if (eventMs == null || !Number.isFinite(eventMs)) return UNATTRIBUTED;

  const matches = windows.filter(
    (w) => eventMs >= w.startMs && (w.endMs == null || eventMs < w.endMs),
  );
  if (matches.length !== 1) return UNATTRIBUTED;
  return { officerId: matches[0].officerId, source: 'inferred' };
}
