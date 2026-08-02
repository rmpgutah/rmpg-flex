// ============================================================
// RMPG Flex — Dispatch nav-guidance lifecycle + speed readout
// ============================================================
// Turn-by-turn guidance on the dispatch map runs for exactly one window:
// it begins when the unit goes EN ROUTE and ends when it arrives ON SCENE.
//
// Extracted as a shared predicate because DispatchMiniMap previously read
// call.status in two independent places -- once to gate voice, once (not at
// all) for the banner -- which is how the two drifted apart.
// ============================================================

/** Statuses during which turn-by-turn guidance is shown and spoken. */
const NAV_ACTIVE_STATUSES = new Set(['enroute']);

/**
 * Whether nav guidance (banner + voice) should run for this call status.
 * Begins at 'enroute', ends at 'onscene'.
 */
export function isNavGuidanceActive(status: string | null | undefined): boolean {
  if (!status) return false;
  return NAV_ACTIVE_STATUSES.has(status);
}

/**
 * Oldest GPS fix whose speed may still be compared against a live posted limit.
 * Beyond this the unit may have stopped or turned onto another road, and the
 * pairing would render a confident-looking reading that is not true.
 */
export const SPEED_FIX_MAX_AGE_MS = 30_000;

const MPS_TO_MPH = 2.236936;

export interface SpeedComparisonArgs {
  /** Ground speed of the last fix, m/s (units.gps_speed). */
  gpsSpeedMps: number | null | undefined;
  /** ISO timestamp of that fix (units.gps_updated_at). */
  gpsUpdatedAt: string | null | undefined;
  /** Posted limit for the current route segment, mph. */
  postedLimitMph: number | null | undefined;
  nowMs: number;
}

export interface SpeedComparison {
  speedMph: number;
  limitMph: number;
}

/**
 * Pair the unit's current speed with the posted limit, or null when the pairing
 * would not be trustworthy.
 *
 * DISPLAY ONLY. This is deliberately not persisted anywhere: a stored record of
 * officer speed exceedances carries legal and HR consequences that a mapping
 * feature must not create as a side effect.
 */
export function speedComparison(args: SpeedComparisonArgs): SpeedComparison | null {
  const { gpsSpeedMps, gpsUpdatedAt, postedLimitMph, nowMs } = args;

  if (typeof postedLimitMph !== 'number' || !Number.isFinite(postedLimitMph)) return null;
  if (typeof gpsSpeedMps !== 'number' || !Number.isFinite(gpsSpeedMps) || gpsSpeedMps < 0) return null;
  if (!gpsUpdatedAt) return null;

  const fixMs = Date.parse(gpsUpdatedAt);
  // An unparseable timestamp is indistinguishable from a missing one; assuming
  // "fresh" would defeat the staleness guard entirely.
  if (!Number.isFinite(fixMs)) return null;
  if (nowMs - fixMs > SPEED_FIX_MAX_AGE_MS) return null;

  return {
    speedMph: Math.round(gpsSpeedMps * MPS_TO_MPH),
    limitMph: Math.round(postedLimitMph),
  };
}
