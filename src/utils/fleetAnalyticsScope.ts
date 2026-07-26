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
  'oldest_vehicle_year',
] as const;

/**
 * Only a plain run of ASCII decimal digits with no leading zero (or the
 * single digit '0', rejected separately below) is accepted as an id.
 * This deliberately excludes hex ('0x2A'), scientific notation ('1e2'),
 * signs, decimals, and — WHITESPACE POLICY — leading/trailing whitespace:
 * `Number(' 42 ')` silently trims and would accept a padded value, but
 * a query-string value with embedded whitespace is not a value we should
 * be lenient about, so it is rejected rather than trimmed.
 */
const VEHICLE_ID_PATTERN = /^[1-9][0-9]*$/;

/**
 * Parse a `?vehicle_id=` query value into a positive integer id.
 * Returns null for anything else — absent, empty, non-numeric,
 * zero, negative, fractional, non-finite, hex/exponential forms,
 * whitespace-padded strings, or values outside the safe-integer range.
 */
export function parseVehicleScope(raw: string | undefined | null): number | null {
  if (raw == null || raw === '') return null;
  if (!VEHICLE_ID_PATTERN.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Column identifiers accepted by scopeAnd: a plain snake_case identifier,
 * optionally qualified with a single table alias (e.g. 'fv.id' for joined
 * queries). Anything else — spaces, quotes, semicolons, parentheses,
 * comment markers, multiple dots, empty string — throws rather than being
 * spliced into SQL text.
 */
const SCOPE_COLUMN_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/;

/** `AND <column> = ?` when scoped; '' when fleet-wide. */
export function scopeAnd(column: string, vehicleId: number | null): string {
  if (!SCOPE_COLUMN_PATTERN.test(column)) {
    throw new Error(`fleetAnalyticsScope.scopeAnd: invalid column identifier '${column}'`);
  }
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
