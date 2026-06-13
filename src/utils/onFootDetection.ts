// ============================================================
// RMPG Flex — on-foot detection engine (pure functions)
// ============================================================
// Classifies iOS CoreMotion activity attached to GPS breadcrumbs and
// debounces state transitions so a stoplight (stationary) or a single
// noisy ping never flips a unit. The stateful runner that applies
// transitions to D1 lives in this file too (runOnFootTransition) but
// only the pure functions are unit-tested.

export type FootState = 'on_foot' | 'in_vehicle' | 'unknown';
export type Transition = 'ON_FOOT' | 'BACK_IN_VEHICLE';

export interface ActivityPoint {
  activity?: string | null;
  activity_confidence?: string | null;
}

/** Points required in the SAME state before a transition fires (~20 s at
 *  the apps' ping cadence). */
export const DEBOUNCE_POINTS = 2;

export function classifyActivity(p: ActivityPoint): FootState {
  const conf = (p.activity_confidence || '').toLowerCase();
  if (conf !== 'medium' && conf !== 'high') return 'unknown';
  const a = (p.activity || '').toLowerCase();
  if (a === 'walking' || a === 'running') return 'on_foot';
  if (a === 'automotive') return 'in_vehicle';
  return 'unknown'; // stationary (could be standing OR stopped car), cycling, unknown
}

/**
 * Debounced transition decision. `recent` = the most recent points,
 * chronological order not required (every one must agree anyway).
 */
export function detectTransition(prev: 'on_foot' | 'in_vehicle', recent: ActivityPoint[]): Transition | null {
  if (recent.length < DEBOUNCE_POINTS) return null;
  const states = recent.slice(-DEBOUNCE_POINTS).map(classifyActivity);
  if (states.every((s) => s === 'on_foot') && prev !== 'on_foot') return 'ON_FOOT';
  if (states.every((s) => s === 'in_vehicle') && prev !== 'in_vehicle') return 'BACK_IN_VEHICLE';
  return null;
}
