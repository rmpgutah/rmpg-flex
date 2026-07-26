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
 * Only a plain run of ASCII decimal digits with no leading zero is accepted
 * as an id. This deliberately excludes hex ('0x2A'), scientific notation
 * ('1e2'), signs, decimals, and — WHITESPACE POLICY — leading/trailing
 * whitespace: `Number(' 42 ')` silently trims and would accept a padded
 * value, but a query-string value with embedded whitespace is not a value
 * we should be lenient about, so it is rejected rather than trimmed.
 *
 * The leading `[1-9]` also rejects the single digit '0' outright, so the
 * `n <= 0` check in parseVehicleScope is unreachable for any input that
 * reaches it — kept only as belt-and-braces should this pattern ever be
 * loosened. `Number.isSafeInteger` is NOT redundant: an arbitrarily long
 * digit run ('9' * 24) satisfies this pattern and becomes 1e24, so that
 * check is the sole gate against binding a value outside 2^53.
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
 * Column identifiers accepted by VehicleScope.and(): a plain snake_case identifier,
 * optionally qualified with a single table alias (e.g. 'fv.id' for joined
 * queries). Anything else — spaces, quotes, semicolons, parentheses,
 * comment markers, multiple dots, empty string — throws rather than being
 * spliced into SQL text.
 */
const SCOPE_COLUMN_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/;

/** `AND <column> = ?` when scoped; '' when fleet-wide. */
function scopeAnd(column: string, vehicleId: number | null): string {
  if (!SCOPE_COLUMN_PATTERN.test(column)) {
    throw new Error(`fleetAnalyticsScope: invalid column identifier '${column}'`);
  }
  return vehicleId == null ? '' : `AND ${column} = ?`;
}

/**
 * A single query's vehicle scope: SQL fragments and their binds, accumulated
 * together so the two cannot drift apart.
 *
 * The predecessor API was a `scopeAnd(column, id)` / `scopeBinds(id, times)`
 * pair where `times` had to be kept equal, by hand, to the number of
 * scopeAnd() calls in the same query. Nothing enforced that: adding a second
 * predicate without bumping `times` left a `?` with no bind, which D1 reports
 * as a bind-count error at best and — if some other bind happens to slot into
 * the gap — silently returns the wrong rows. Here `binds()` is derived from
 * the `and()` calls that actually happened, so there is no second number to
 * keep in sync.
 */
export interface VehicleScope {
  /** `AND <column> = ?` when scoped ('' when fleet-wide), reserving a bind. */
  and(column: string): string;
  /** One bind per scoped `and()` call on THIS builder; [] when fleet-wide. */
  binds(): number[];
}

/**
 * Build a scope for ONE query. Use it as:
 *
 *     const scope = vehicleScope(vehicleId);
 *     await query(db, `SELECT … WHERE 1=1 ${scope.and('vehicle_id')}`, ...scope.binds());
 *
 * The ordering this relies on is guaranteed, not incidental: JS evaluates
 * call arguments left to right, so every `and()` inside the template literal
 * runs before the `...scope.binds()` argument is evaluated.
 *
 * A builder is single-use. `binds()` seals it, and any later `and()` or a
 * second `binds()` throws rather than quietly emitting a fragment nobody
 * binds or replaying one query's binds into the next. Give each query its
 * own builder — that is the unit the invariant is defined over.
 */
export function vehicleScope(vehicleId: number | null): VehicleScope {
  let reserved = 0;
  let sealed = false;

  return {
    and(column: string): string {
      if (sealed) {
        throw new Error(
          `fleetAnalyticsScope: and('${column}') called after binds() — `
          + 'this fragment would go unbound. Use one vehicleScope() per query.',
        );
      }
      const fragment = scopeAnd(column, vehicleId);
      if (fragment !== '') reserved += 1;
      return fragment;
    },
    binds(): number[] {
      if (sealed) {
        throw new Error(
          'fleetAnalyticsScope: binds() called twice on one vehicleScope() — '
          + 'reusing a builder across queries misaligns the bind list. Build a new one.',
        );
      }
      sealed = true;
      return vehicleId == null ? [] : Array.from({ length: reserved }, () => vehicleId);
    },
  };
}
