// ============================================================
// RMPG Flex — Cross-Street Derivation
// ============================================================
// CAD dispatchers need the nearest intersecting street auto-filled when an
// address is geocoded. Mapbox Geocoding (and Nominatim) return the address's
// OWN street but never a cross street, so we query the Mapbox Streets `road`
// layer around the point and pick the nearest road whose name differs from
// the address street.
//
// This calls the Mapbox Tilequery API directly from the browser using the
// same public token AddressAutocomplete already uses — so it does NOT depend
// on any server `/mapbox/*` proxy endpoint being live.

import { getMapboxAccessToken } from './mapboxApiKey';

export interface NearbyRoad {
  name: string;
  /** Straight-line distance from the query point, in meters. */
  distance: number;
}

/**
 * Query the Mapbox Streets v8 `road` layer around a point and return the
 * distinct named roads, nearest first. Returns `[]` on any failure (no token,
 * network error, malformed response) so callers can treat it as best-effort.
 */
export async function fetchNearbyRoads(
  lng: number,
  lat: number,
  radiusMeters = 60,
): Promise<NearbyRoad[]> {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
  const token = await getMapboxAccessToken().catch(() => '');
  if (!token) return [];

  // dedupe=false so we see every road segment hit; we collapse by name below
  // (Tilequery's own dedupe is per-geometry, not per-name).
  const url =
    `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/` +
    `${lng},${lat}.json?radius=${radiusMeters}&limit=50&dedupe=false&layers=road&access_token=${token}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const features: any[] = data.features || [];

    // Collapse to the nearest hit per distinct road name.
    const nearestByName = new Map<string, number>();
    for (const f of features) {
      const name = String(f.properties?.name || '').trim();
      const dist = f.properties?.tilequery?.distance;
      if (!name || typeof dist !== 'number') continue;
      const prev = nearestByName.get(name);
      if (prev == null || dist < prev) nearestByName.set(name, dist);
    }

    return Array.from(nearestByName, ([name, distance]) => ({ name, distance }))
      .sort((a, b) => a.distance - b.distance);
  } catch {
    return [];
  }
}

/** Loosely normalize a street name for comparison (case/punctuation/spacing). */
export function normalizeStreet(s: string): string {
  return s.toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
}

// Canonicalize directionals + common street-type suffixes so the address's
// own street matches its road-network name even when the spelling differs
// (e.g. "South … Drive" from the geocoder vs "Terra Sol Dr" from Tilequery).
const WORD_CANON: Record<string, string> = {
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
  street: 'st', avenue: 'ave', drive: 'dr', road: 'rd', lane: 'ln',
  boulevard: 'blvd', court: 'ct', place: 'pl', circle: 'cir', square: 'sq',
  parkway: 'pkwy', highway: 'hwy', terrace: 'ter', trail: 'trl',
};

/**
 * Reduce a street name to a canonical token Set: map each word through
 * WORD_CANON. When `stripHouseNumber` is set (only true for the address's own
 * street, which always arrives house-number-first), drop a single leading
 * integer. Candidate road names keep their leading number, because for SLC
 * grid streets ("300 South", "200 East") the number IS the street's identity.
 */
function streetTokens(name: string, stripHouseNumber: boolean): Set<string> {
  let cleaned = normalizeStreet(name);
  if (stripHouseNumber) cleaned = cleaned.replace(/^\d+\s+/, '');
  const toks = cleaned.split(' ').filter(Boolean).map((t) => WORD_CANON[t] ?? t);
  return new Set(toks);
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

/**
 * True when a candidate `roadName` (from the road network) refers to the same
 * street as the address's `primaryStreet`. Asymmetric on purpose: only the
 * primary has a house number to strip. Uses token-subset containment (either
 * side's canonical tokens nest inside the other's) rather than equality, so it
 * absorbs directional prefixes and Drive/Dr-style suffix drift — "Terra Sol Dr"
 * IS the same as "3533 South Terra Sol Drive" (excluded), while "300 South" is
 * NOT the same as "150 W Main St" (survives as a cross street).
 */
export function isSameStreet(roadName: string, primaryStreet: string): boolean {
  const road = streetTokens(roadName, false);
  const primary = streetTokens(primaryStreet, true);
  return isSubset(road, primary) || isSubset(primary, road);
}

/**
 * Choose the cross street to auto-fill, given the address's own street and the
 * roads found near the point (nearest first, from `fetchNearbyRoads`).
 *
 * ── DESIGN DECISION (RMPG dispatch convention) ───────────────────────────
 * What belongs in the "Cross Street" field?
 *   • Default below — the single nearest road that is NOT the address's own
 *     street (the classic "nearest cross street").
 *   • Alternative — join the two nearest distinct cross streets with " & " to
 *     express the bounding block, e.g. "S 200 E & E 300 S".
 * The selection/formatting rule lives entirely in this function; tune it to
 * match how your dispatchers read a cross street on the run.
 */
export function deriveCrossStreet(
  primaryStreet: string,
  nearbyRoads: NearbyRoad[],
): string {
  const crosses = nearbyRoads.filter((r) => !isSameStreet(r.name, primaryStreet));
  // Default: nearest single cross street.
  return crosses[0]?.name || '';
}
