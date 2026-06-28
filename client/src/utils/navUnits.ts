// ============================================================
// RMPG Flex — Navigation Unit Formatters
// Distance & speed conversions for the imperial / metric toggle.
// Pure functions — no React, no DOM, no localStorage. Callers feed
// the chosen `units` from prefs. Speed color bands track the gold/
// amber/red Spillman palette (zero blue).
// ============================================================

export type NavUnits = 'imperial' | 'metric';

const MS_TO_MPH = 2.236936; // metres/sec → miles/hour
const MS_TO_KMH = 3.6; // metres/sec → km/hour
const M_TO_FT = 3.280839895;
const M_TO_MI = 1 / 1609.344;
const M_TO_KM = 1 / 1000;

/** Convert a metres/second speed to the display unit's numeric value. */
export function msToSpeed(ms: number, units: NavUnits): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return units === 'metric' ? ms * MS_TO_KMH : ms * MS_TO_MPH;
}

/** metres → miles. */
export function metersToMiles(m: number): number {
  return (Number.isFinite(m) ? m : 0) * M_TO_MI;
}

/** metres → kilometres. */
export function metersToKm(m: number): number {
  return (Number.isFinite(m) ? m : 0) * M_TO_KM;
}

/**
 * Format an already-converted speed value with its unit label.
 * e.g. formatSpeed(58,'imperial') -> '58 mph', (93,'metric') -> '93 km/h'.
 */
export function formatSpeed(value: number, units: NavUnits): string {
  const v = Number.isFinite(value) ? Math.round(value) : 0;
  return units === 'metric' ? `${v} km/h` : `${v} mph`;
}

/**
 * Short-range distance for under ~0.1 mi / ~160 m — emits ft or m.
 * Rounds feet to the nearest 10 ft; metres to the nearest 5 m.
 */
export function formatDistanceShort(meters: number, units: NavUnits): string {
  const m = Number.isFinite(meters) && meters > 0 ? meters : 0;
  if (units === 'metric') {
    const rounded = m < 100 ? Math.round(m / 5) * 5 : Math.round(m / 10) * 10;
    return `${rounded} m`;
  }
  const ft = m * M_TO_FT;
  const rounded = ft < 100 ? Math.round(ft / 10) * 10 : Math.round(ft / 50) * 50;
  return `${rounded} ft`;
}

/**
 * Long-range distance — emits mi or km with adaptive precision
 * (1 decimal under 10 units, whole numbers above).
 */
export function formatDistanceLong(meters: number, units: NavUnits): string {
  const m = Number.isFinite(meters) && meters > 0 ? meters : 0;
  if (units === 'metric') {
    const km = metersToKm(m);
    return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
  }
  const mi = metersToMiles(m);
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

/**
 * Format an elevation given in FEET into the display unit.
 * Imperial keeps feet; metric converts to metres.
 */
export function formatElevation(ft: number, units: NavUnits): string {
  const f = Number.isFinite(ft) ? ft : 0;
  if (units === 'metric') {
    const m = f / M_TO_FT;
    return `${Math.round(m)} m`;
  }
  return `${Math.round(f)} ft`;
}

/**
 * Speed → Spillman color band. Thresholds are unit-correct:
 * residential/safe = gold, arterial = amber, highway/over = red.
 *   imperial (mph): <=35 gold, <=65 amber, else red
 *   metric  (km/h): <=56 gold, <=105 amber, else red
 */
export function speedColor(value: number, units: NavUnits): string {
  const GOLD = '#d4a017';
  const AMBER = '#c47f17';
  const RED = '#b3261e';
  const v = Number.isFinite(value) ? value : 0;
  const lowMax = units === 'metric' ? 56 : 35;
  const midMax = units === 'metric' ? 105 : 65;
  if (v <= lowMax) return GOLD;
  if (v <= midMax) return AMBER;
  return RED;
}
