// ============================================================
// RMPG Flex — Fleet analytics vehicle-scope helpers
//
// GET /api/fleet/analytics serves two audiences: the fleet-wide
// dashboard (no ?vehicle_id) and the per-vehicle Analytics tab
// (?vehicle_id=N). Before this module the per-vehicle tab rendered
// fleet aggregates under per-vehicle labels.
//
// These helpers are pure so they can be unit-tested without D1 or
// Miniflare — the same split used by src/utils/fleetViz.ts.
//
// SECURITY: vehicle_id is user input, so it is always emitted as a
// `?` bind, never interpolated. parseVehicleScope is the only gate;
// anything it cannot prove is a positive integer becomes null
// (fleet-wide), which is the safe default rather than an error.
// ============================================================

export type AnalyticsScope = 'vehicle' | 'fleet';

/**
 * Blocks that describe a FLEET and carry no meaning for one vehicle
 * (a single vehicle's "status breakdown" is just its status). When
 * scoped, the route returns these zeroed and names them here so the
 * client can hide the cards instead of drawing an empty chart that
 * reads as "no data".
 */
export const FLEET_ONLY_BLOCKS = [
  'mileage_distribution',
  'status_breakdown',
  'utilization',
  'service_compliance',
  'cost_per_mile_ranking',
  'fuel_economy_ranking',
] as const;

/**
 * Parse a `?vehicle_id=` query value into a positive integer id.
 * Returns null for anything else — absent, empty, non-numeric,
 * zero, negative, fractional, or non-finite.
 */
export function parseVehicleScope(raw: string | undefined | null): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/** `AND <column> = ?` when scoped; '' when fleet-wide. */
export function scopeAnd(column: string, vehicleId: number | null): string {
  return vehicleId == null ? '' : `AND ${column} = ?`;
}

/**
 * Bind arguments to append after the query's existing binds — one per
 * scopeAnd() call in that query. Empty when fleet-wide, so spreading
 * it into a query() call is a no-op.
 */
export function scopeBinds(vehicleId: number | null, times = 1): number[] {
  if (vehicleId == null) return [];
  return Array.from({ length: times }, () => vehicleId);
}
