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
 * Ambiguity resolves to unattributed rather than picking one. Guessing here
 * would attribute a driving event to a named person on no evidence, which is
 * the failure mode this whole feature is built to avoid.
 *
 * ⚠️ Ambiguity is counted in DISTINCT OFFICERS, not raw rows. `fleet_assignments`
 * routinely holds several overlapping rows for the SAME officer on the same
 * unit (a re-assignment that never closed the prior row, a Fleet.io inbound
 * upsert landing beside a manual one). Counting rows made those resolve to
 * `unattributed`, silently deleting real events from a real driver's record —
 * even though every candidate row named the same person, so there was no
 * ambiguity to refuse. The cost path in rollup.ts already deduped via a Set of
 * distinct officer ids; this is the same rule, applied to events.
 */
export function resolveAttribution(
  stampedOfficerId: number | null,
  eventMs: number | null,
  windows: readonly AssignmentWindow[],
): AttributionResult {
  // `!= null` (not a truthiness check): officer id 0 is a valid id and must
  // not fall through to window inference.
  if (stampedOfficerId != null) {
    return { officerId: stampedOfficerId, source: 'recorded' };
  }
  if (eventMs == null || !Number.isFinite(eventMs)) return UNATTRIBUTED;

  const officers = new Set<number>();
  for (const w of windows) {
    if (eventMs >= w.startMs && (w.endMs == null || eventMs < w.endMs)) {
      officers.add(w.officerId);
    }
  }
  if (officers.size !== 1) return UNATTRIBUTED;
  return { officerId: [...officers][0], source: 'inferred' };
}
