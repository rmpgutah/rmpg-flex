// ============================================================
// RMPG Flex — Speed-limit parsing (single source of truth)
// ============================================================
// Consolidates two near-identical parsers that previously lived in
// client/src/hooks/useSpeedLimit.ts and
// client/src/pages/navigation/hud/useSpeedLimit.ts.
//
// Two input shapes are handled:
//   1. A raw OSM `maxspeed` tag value ("35 mph", "50 km/h", 35).
//   2. One entry of Mapbox Directions' `annotation.maxspeed` array,
//      which is an object rather than a scalar.
// Both normalize to whole mph, or null when no usable speed exists.
// ============================================================

const KMH_TO_MPH = 0.621371;

/** One entry of Mapbox Directions' `annotation.maxspeed` array. */
export interface MaxspeedAnnotationEntry {
  speed?: number;
  unit?: 'km/h' | 'mph';
  /** Mapbox sets this when it has no posted limit for the segment. */
  unknown?: boolean;
  /** Mapbox sets this where the limit is unlimited (e.g. a German autobahn). */
  none?: boolean;
}

/**
 * Parse an OSM-style `maxspeed` tag into whole mph.
 * Accepts 35 | "35" | "35 mph" | "50 km/h" | "50 kph".
 * Returns null for non-numeric OSM values ("none", "signals", "walk"),
 * for nullish/non-scalar input, and for non-positive speeds.
 */
export function parseMaxspeedMph(raw: unknown): number | null {
  if (raw == null) return null;

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return Math.round(raw);
  }

  if (typeof raw !== 'string') return null;

  const s = raw.trim().toLowerCase();
  const m = s.match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;

  const val = parseFloat(m[1]);
  if (!Number.isFinite(val) || val <= 0) return null;

  // "km/h", "kmh" and "kph" all appear in real OSM data.
  if (s.includes('km') || s.includes('kph')) return Math.round(val * KMH_TO_MPH);
  return Math.round(val);
}

/**
 * Decode one entry of Mapbox's `annotation.maxspeed` array into mph.
 *
 * Per the Directions API reference, `speed` and `unit` are returned together,
 * and `unknown`/`none` are returned INSTEAD of them — never alongside. Both of
 * those mean "no posted limit to show", so both decode to null.
 */
export function decodeMaxspeedAnnotation(entry: unknown): number | null {
  if (entry == null || typeof entry !== 'object') return null;
  const e = entry as MaxspeedAnnotationEntry;
  if (e.unknown === true || e.none === true) return null;
  if (typeof e.speed !== 'number' || !Number.isFinite(e.speed)) return null;
  // `unit` is documented as always present alongside `speed`. Its absence means
  // a shape we don't recognise, and guessing the unit could double a limit.
  if (e.unit !== 'mph' && e.unit !== 'km/h') return null;
  if (e.speed <= 0) return null;
  return e.unit === 'km/h' ? Math.round(e.speed * KMH_TO_MPH) : Math.round(e.speed);
}
