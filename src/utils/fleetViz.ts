// ============================================================
// RMPG Flex — Fleet visualization helpers (Fleet.io PR 7–9 backend)
// ============================================================
// Pure helpers shared by every /api/fleet-viz/* endpoint:
//   * Date-window parsing (?period=7d|30d|90d|ytd|all|custom + ?from/to)
//   * Cost-per-mile math
//   * MPG math (full-tank-anchored, partial-fillup-aware per PR 3 schema)
//   * Anomaly z-score
//
// No I/O. Routes in src/routes/fleetViz.ts compose these with D1.
// ============================================================

export type Period = '7d' | '30d' | '90d' | 'ytd' | '1y' | 'all';

const PERIOD_TO_DAYS: Record<Exclude<Period, 'all' | 'ytd'>, number> = {
  '7d': 7, '30d': 30, '90d': 90, '1y': 365,
};

export interface DateWindow {
  /** SQL fragment to append to a WHERE clause — e.g. ` AND fuel_date >= date('now', '-30 days')` */
  whereClause: string;
  /** Human label for the UI badge. */
  label: string;
  /** ISO 'YYYY-MM-DD' boundary, for client side. Null when window is all-time. */
  fromIso: string | null;
}

/**
 * Build a SQL-safe date window from a `period` query string.
 * The column name is interpolated — caller MUST pass a hard-coded
 * identifier (never user-supplied) so this can't be a SQL-injection sink.
 */
export function buildDateWindow(period: string | undefined, column: string): DateWindow {
  // Hardened against identifier injection: require column to match the
  // standard snake_case shape. Crash if a caller gets clever.
  if (!/^[a-z][a-z0-9_]*$/.test(column)) {
    throw new Error(`fleetViz.buildDateWindow: invalid column identifier '${column}'`);
  }
  const p = (period ?? '30d').toLowerCase();
  if (p === 'all') return { whereClause: '', label: 'All time', fromIso: null };
  if (p === 'ytd') {
    return {
      whereClause: ` AND ${column} >= date('now','start of year')`,
      label: 'Year to date',
      fromIso: null, // route handler can resolve via SQL if it wants
    };
  }
  const days = PERIOD_TO_DAYS[p as keyof typeof PERIOD_TO_DAYS];
  if (!days) {
    // Default to 30d on unknown input rather than reject — the UI's
    // period picker is just a chip set.
    return { whereClause: ` AND ${column} >= date('now','-30 days')`, label: 'Last 30 days', fromIso: null };
  }
  return { whereClause: ` AND ${column} >= date('now','-${days} days')`, label: `Last ${days} days`, fromIso: null };
}

// ─── Cost-per-mile ─────────────────────────────────────────

export interface CostInputs {
  fuel_cost: number;
  maintenance_cost: number;
  parts_cost: number;
  miles_driven: number;
}

export interface CostBreakdown {
  fuel: number;
  maintenance: number;
  parts: number;
  total: number;
  cost_per_mile: number | null;
}

export function computeCostBreakdown(input: CostInputs): CostBreakdown {
  const fuel = round2(input.fuel_cost);
  const maintenance = round2(input.maintenance_cost);
  const parts = round2(input.parts_cost);
  const total = round2(fuel + maintenance + parts);
  const miles = input.miles_driven;
  const cpm = miles > 0 ? round4(total / miles) : null;
  return { fuel, maintenance, parts, total, cost_per_mile: cpm };
}

// ─── MPG math ──────────────────────────────────────────────

export interface FuelEntry {
  id: number;
  fuel_date: string;
  gallons: number | null;
  odometer: number | null;
  is_full_tank: number | null;
  is_partial_fillup: number | null;
}

export interface MpgPoint {
  /** The fuel entry that closed an interval. */
  closing_entry_id: number;
  /** Miles between the prior close and this close. */
  miles: number;
  /** Gallons consumed in this interval. */
  gallons: number;
  /** Computed MPG (miles / gallons). */
  mpg: number;
  /** ISO date of the closing entry. */
  date: string;
}

/**
 * Compute MPG points from a fuel log ordered ASC by fuel_date.
 *
 * Algorithm (Fleet.io parity):
 *   - Walk entries in order.
 *   - On every is_full_tank=1 entry that closes a tank started by a prior
 *     is_full_tank=1, compute miles = current.odometer - prior_full.odometer,
 *     gallons = sum of all gallons since the prior full (inclusive of the
 *     current full), mpg = miles / gallons.
 *   - is_partial_fillup=1 entries contribute their gallons but DON'T close
 *     an interval (Fleet.io's "splash fill" rule).
 *
 * Returns [] when there aren't ≥ 2 full-tank entries with valid odometer
 * + gallons — silent on bad input rather than throwing.
 */
export function computeMpgPoints(entries: FuelEntry[]): MpgPoint[] {
  const out: MpgPoint[] = [];
  let priorFull: FuelEntry | null = null;
  let gallonsSincePriorFull = 0;
  for (const e of entries) {
    const full = e.is_full_tank === 1;
    const partial = e.is_partial_fillup === 1;
    const gallons = typeof e.gallons === 'number' ? e.gallons : 0;
    // splash / partial contributes to gallons but doesn't close the interval
    if (!full) {
      gallonsSincePriorFull += gallons;
      continue;
    }
    // It's a full-tank entry. If we have a prior full + valid odo, close.
    if (priorFull && typeof priorFull.odometer === 'number' && typeof e.odometer === 'number') {
      const miles = e.odometer - priorFull.odometer;
      const usedGallons = gallonsSincePriorFull + gallons;
      if (miles > 0 && usedGallons > 0) {
        out.push({
          closing_entry_id: e.id,
          miles,
          gallons: round2(usedGallons),
          mpg: round2(miles / usedGallons),
          date: e.fuel_date,
        });
      }
    }
    // Reset the interval; this full-tank starts the next one.
    priorFull = e;
    gallonsSincePriorFull = 0;
  }
  return out;
}

// ─── Anomaly z-score ───────────────────────────────────────

/**
 * Compute mean + std-dev of a numeric series; return an anomaly score for
 * each input as (value - mean) / std. Used by the fuel anomaly heatmap
 * (V6) — entries with |z| > 2 are flagged.
 *
 * Returns [] when the series has < 2 elements or std == 0.
 */
export function zScores(values: number[]): number[] {
  if (values.length < 2) return [];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sqdiffs = values.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  const std = Math.sqrt(sqdiffs / values.length);
  if (std === 0) return values.map(() => 0);
  return values.map((v) => round2((v - mean) / std));
}

// ─── Helpers ───────────────────────────────────────────────

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }
