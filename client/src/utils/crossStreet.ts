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

/** Strip a leading house number so "123 Main St" compares as "main st". */
function routeOnly(street: string): string {
  return normalizeStreet(street.replace(/^\s*\d+\s+/, ''));
}

/**
 * Choose the cross street to auto-fill, given the address's own street and the
 * roads found near the point (nearest first, from `fetchNearbyRoads`).
 *
 * ── DESIGN DECISION (RMPG dispatch convention) ───────────────────────────
 * What belongs in the "Cross Street" field?
 *   • Default below — the single nearest road whose name differs from the
 *     address street (the classic "nearest cross street").
 *   • Alternative — join the two nearest distinct cross streets with " & " to
 *     express the bounding block, e.g. "S 200 E & E 300 S".
 * The selection/formatting rule lives entirely in this function; tune it to
 * match how your dispatchers read a cross street on the run.
 */
export function deriveCrossStreet(
  primaryStreet: string,
  nearbyRoads: NearbyRoad[],
): string {
  const primary = routeOnly(primaryStreet);
  const crosses = nearbyRoads.filter((r) => normalizeStreet(r.name) !== primary);
  // Default: nearest single cross street.
  return crosses[0]?.name || '';
}
